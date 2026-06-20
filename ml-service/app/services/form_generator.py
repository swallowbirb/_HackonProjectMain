"""
Gemini Pass 1 — Form Generator + cache (Task 2.5, Requirements 3 & 11)

Composes the Pass-1 prompt (base + category + template), calls Gemini invoke_json,
validates the Form_Schema shape, and caches results keyed by
hash(productId + normalized_reason) — falling back to hash(category + reason) when
there is no catalog product. On Gemini failure: serve cache if present, else a
generic default schema.

v3.44 changes:
  * Cache key handles the no-productId case (improvement #8).
  * Generic + AI schemas carry `expected_subject` on photo fields, a `schemaVersion`,
    and a clamped field count (improvements #2, #9).
  * `generic_default_schema` is the single source of the fallback shape; the backend
    no longer keeps its own copy (improvement #6).

Form_Schema v3 (dynamic-stepper-evidence-grading) — shape contract:

  This bump introduces a structured, multi-step, aspect-based Form_Schema. The
  change is strictly ADDITIVE and backward-compatible: a legacy flat `fields[]`-only
  schema (v2 and earlier) remains a valid input and is treated as a single implicit
  step of plain photo fields. The new `steps[]` and per-field `aspects[]` layers are
  optional; consumers that don't understand them keep working off `fields[]`.

  Field `aspects[]` — each photo/video field declares one or more aspects describing
  exactly what the evidence must capture (Req 1.1). Aspect shape:

    {
      "id":               str,    # stable identifier for the aspect within the field
      "kind":             str,    # one of ASPECT_KINDS: angle | region | label | functional
      "verifiability":    str,    # one of ASPECT_VERIFIABILITIES: photo | ocr | none
      "importance":       str,    # one of ASPECT_IMPORTANCES: critical | standard | minor
      "detail_level":     str,    # one of ASPECT_DETAIL_LEVELS: high | normal
      "expected_subject": str,    # plain-language description of what to show
      "required_views":   [str],  # explicit views/regions that make the aspect complete
      "validation_criteria": str  # acceptance test the inspector enforces
    }

    - kind=angle|region populate `required_views` with the specific views/regions
      that make the field complete (Req 1.2).
    - verifiability=none marks a claim a camera cannot confirm (internal/functional/
      odor/intermittent); such aspects are routed to human review, not photo-graded.
    - detail_level=high marks texture/defect aspects that must not be downscaled or
      montaged.

  `steps[]` — an ordered list layered on top of `fields[]`; each step groups only the
  fields it needs and is presented as a single screen in the stepper (Req 6.1).
  Step shape:

    {
      "id":      str,        # stable identifier for the step
      "title":   str,        # short human-readable step name (stepper label)
      "purpose": str,        # one-line explanation of what this step is for
      "fields":  [<field>]   # the fields belonging to this step
    }

  Each photo/video field MAY also carry a `capture_mode` of `video | photo | text`
  (Capture_Mode) selecting the evidence method. `schemaVersion` is stamped 3 on every
  generated schema.

  NOTE: the `_normalize_schema` backfill/clamp/step-assembly logic that enforces this
  shape lands in task 1.2; this revision only defines the shape (constants + docs) and
  bumps the version constant.
"""
import copy
import json
import logging
import re
from typing import Optional, List

from app.config import settings
from app.services import prompt_loader
from app.services.gemini import gemini_service, GeminiError, GeminiJSONError
from app.services.ttl_cache import TTLCache, cache_key
from app.services.image_utils import try_fetch_image_bytes

logger = logging.getLogger("ml-service.form_generator")

# Module-scoped cache so it survives across requests within the process.
_pass1_cache = TTLCache(settings.grade_cache_ttl_seconds)

# Pass-1 form cache — enabled to conserve Gemini RPD quota during demos/judging.
# Identical product+reason combos reuse the cached schema (TTL = GRADE_CACHE_TTL_SECONDS).
_PASS1_CACHE_ENABLED = True

# Form_Schema contract version — bumped when the schema shape changes so the
# frontend / Evidence_Bundle can reason about compatibility (improvement #9).
# v3: structured steps[] + per-field aspects[] + capture_mode (additive; legacy
# flat fields[]-only schemas remain valid input).
SCHEMA_VERSION = 3

# Hard cap on photo fields so a hallucinated 30-field form can't wreck the UX (Req / improvement #9).
MAX_PHOTO_FIELDS = 8

# --- Form_Schema v3 aspect/step vocabulary (dynamic-stepper-evidence-grading) -----
# Allowed values for each structured Aspect attribute. These document the contract
# and serve as the source of truth for the task 1.2 normalization/backfill logic.
ASPECT_KINDS = ("angle", "region", "label", "functional")
ASPECT_VERIFIABILITIES = ("photo", "ocr", "none")
ASPECT_IMPORTANCES = ("critical", "standard", "minor")
ASPECT_DETAIL_LEVELS = ("high", "normal")

# Evidence capture methods a field may declare (Capture_Mode).
CAPTURE_MODES = ("video", "photo", "text")

# Safe defaults used to backfill any missing Aspect attribute so the inspector always
# has a complete, valid aspect to enforce (Req 1.3). Applied by `_normalize_schema`
# in task 1.2; defined here alongside the shape contract.
DEFAULT_ASPECT_KIND = "region"
DEFAULT_ASPECT_VERIFIABILITY = "photo"
DEFAULT_ASPECT_IMPORTANCE = "standard"
DEFAULT_ASPECT_DETAIL_LEVEL = "normal"
DEFAULT_CAPTURE_MODE = "photo"

# Unambiguous "this field wants a video" wording. Used as a fallback when the model
# describes a video in the label/guidance but forgets to set type/capture_mode=video
# (Gemini is inconsistent about the structured field). Kept tight — only fires on
# clear video language so ordinary photo fields are never upgraded.
_VIDEO_INTENT_RE = re.compile(
    r"\b(videos?|footage|panning|pan over|pan across|pan around)\b", re.IGNORECASE
)

# Status strings surfaced to the backend / progressive-form layer.
STATUS_AI = "ai"
STATUS_CACHE = "cache"
STATUS_FALLBACK_CACHE = "cache_degraded"
STATUS_FALLBACK_GENERIC = "generic_default"


def _generic_default_schema(category: Optional[str]) -> dict:
    """Generic fallback Form_Schema used when Gemini is unavailable (Req 11.4).

    Photo fields carry `expected_subject` so per-photo validation still works on
    the fallback form (improvement #2).
    """
    return {
        "title": "Item Condition Evidence",
        "fields": [
            {"id": "front_photo", "label": "Front view", "type": "photo", "required": True,
             "guidance": "Clear, well-lit photo of the front of the item.",
             "expected_subject": "the front of the item"},
            {"id": "back_photo", "label": "Back view", "type": "photo", "required": True,
             "guidance": "Clear photo of the back of the item.",
             "expected_subject": "the back of the item"},
            {"id": "defect_photo", "label": "Close-up of any damage", "type": "photo",
             "required": False, "guidance": "Close-up of any defect, wear, or damage.",
             "expected_subject": "a close-up of damage or wear on the item"},
            {"id": "label_photo", "label": "Brand / serial label", "type": "photo",
             "required": False, "guidance": "Photo of the brand label or serial number.",
             "expected_subject": "the brand label or serial number"},
            {"id": "condition_notes", "label": "Condition notes", "type": "text",
             "required": False, "guidance": "Describe the condition or reason in your own words."},
        ],
        "photo_guidance": [
            "Use good lighting and a plain background.",
            "Hold the camera steady to avoid blur.",
        ],
        "category": category or "generic",
        "schemaVersion": SCHEMA_VERSION,
        "generated": False,
    }


def _is_valid_form_schema(obj) -> bool:
    if not isinstance(obj, dict):
        return False
    fields = obj.get("fields")
    # Accept steps-first schemas under "steps" OR the common model alias "formSchema".
    if not isinstance(fields, list) or len(fields) == 0:
        step_list = obj.get("steps") or obj.get("formSchema")
        if isinstance(step_list, list) and step_list:
            fields = [f for s in step_list if isinstance(s, dict)
                      for f in (s.get("fields") or []) if isinstance(f, dict)]
    if not fields:
        return False
    for f in fields:
        if not isinstance(f, dict):
            return False
        if "id" not in f:
            return False
        # Accept fields that declare capture_mode even when "type" is absent —
        # _normalize_schema will backfill "type" from capture_mode before processing.
        if "type" not in f and "capture_mode" not in f:
            return False
    return True


# Field types that require captured media (photo or video) and therefore carry
# structured aspects + a Capture_Mode. Text/select/bool fields are non-media.
_MEDIA_FIELD_TYPES = ("photo", "video")


def _normalize_subject(text) -> str:
    """Canonicalize an expected_subject for comparison: lowercase, trim, collapse
    internal whitespace. Used as the de-duplication key component (Req 6.2)."""
    return " ".join(str(text or "").lower().split())


def _coerce_enum(value, allowed: tuple, default: str) -> str:
    """Return `value` when it is one of `allowed`, else the safe `default` (Req 1.3)."""
    return value if value in allowed else default


def _slugify(text: str) -> str:
    """Stable, deterministic id from a step hint/title."""
    slug = re.sub(r"[^a-z0-9]+", "_", str(text or "").lower()).strip("_")
    return slug or "step"


def _backfill_aspect(raw, field: dict, idx: int) -> dict:
    """Return a complete, valid Aspect, backfilling any missing/invalid attribute
    with the documented safe defaults (Req 1.3).

    expected_subject falls back to the field's expected_subject, then its label;
    required_views falls back to [expected_subject]; validation_criteria is
    synthesized from the expected_subject when absent.
    """
    aspect = dict(raw) if isinstance(raw, dict) else {}

    field_subject = (
        (field.get("expected_subject") or "").strip()
        or (field.get("label") or "").strip()
        or "the item"
    )
    subject = aspect.get("expected_subject")
    subject = subject.strip() if isinstance(subject, str) and subject.strip() else field_subject
    aspect["expected_subject"] = subject

    aspect["kind"] = _coerce_enum(aspect.get("kind"), ASPECT_KINDS, DEFAULT_ASPECT_KIND)
    aspect["verifiability"] = _coerce_enum(
        aspect.get("verifiability"), ASPECT_VERIFIABILITIES, DEFAULT_ASPECT_VERIFIABILITY)
    aspect["importance"] = _coerce_enum(
        aspect.get("importance"), ASPECT_IMPORTANCES, DEFAULT_ASPECT_IMPORTANCE)
    aspect["detail_level"] = _coerce_enum(
        aspect.get("detail_level"), ASPECT_DETAIL_LEVELS, DEFAULT_ASPECT_DETAIL_LEVEL)

    raw_views = aspect.get("required_views")
    if isinstance(raw_views, list):
        views = [v.strip() for v in raw_views if isinstance(v, str) and v.strip()]
    else:
        views = []
    aspect["required_views"] = views or [subject]

    vc = aspect.get("validation_criteria")
    if not (isinstance(vc, str) and vc.strip()):
        vc = f"Must clearly show {subject}."
    aspect["validation_criteria"] = vc

    aid = aspect.get("id")
    if not (isinstance(aid, str) and aid.strip()):
        aspect["id"] = f"{field.get('id', 'field')}_aspect_{idx + 1}"

    return aspect


def _backfill_field_aspects(field: dict) -> None:
    """Ensure a media field carries at least one complete aspect (Req 1.1, 1.3)."""
    raw = field.get("aspects")
    raw = raw if isinstance(raw, list) else []
    aspects = [_backfill_aspect(a, field, i) for i, a in enumerate(raw)]
    if not aspects:
        aspects = [_backfill_aspect({}, field, 0)]
    field["aspects"] = aspects


def _resolve_capture_mode(field: dict) -> str:
    """Resolve a field's Capture_Mode (Req 5.1, 5.3).

    Resolution order (video signals win first, so a field that clearly asks for a
    video is NEVER collapsed into a text box):
    - `video` when the model explicitly chose video (capture_mode/type=video) OR the
      field's own wording unambiguously asks for a video. This is checked FIRST so a
      functional/internal video claim (whose aspects are all `verifiability=none`)
      still renders a video uploader instead of a text field.
    - `text` when the model explicitly asked for a written answer.
    - `text` when every aspect is `verifiability=none` (nothing media can prove and
      no video was requested).
    - `photo` otherwise.
    """
    emitted = field.get("capture_mode")
    emitted = emitted if emitted in CAPTURE_MODES else None

    # 1. Explicit video signal — honored before any text collapse so a video request
    #    for a functional/internal claim is preserved (e.g. "record a video showing
    #    the zipper sliding", whose aspects are verifiability=none).
    if emitted == "video" or field.get("type") == "video":
        return "video"

    # Honor explicit video intent in the field's own wording even when the model
    # forgot to set type/capture_mode (e.g. label "Overall Condition Video",
    # guidance "provide a video panning over the jacket"). Only an unambiguous video
    # signal upgrades photo→video, so normal photo fields are unaffected.
    text = " ".join(
        str(field.get(k) or "") for k in ("label", "guidance", "expected_subject")
    )
    if _VIDEO_INTENT_RE.search(text):
        return "video"

    # 2. Explicit written-answer request.
    if emitted == "text":
        return "text"

    # 3. No video requested and nothing a camera can prove -> written answer.
    aspects = field.get("aspects") or []
    if aspects and all(a.get("verifiability") == "none" for a in aspects):
        return "text"

    return DEFAULT_CAPTURE_MODE


def _assemble_steps(fields: List[dict], schema: dict) -> List[dict]:
    """Group fields into an ordered list of Steps (Req 6.1, 6.6).

    Fields are grouped by an emitted `step` hint, preserving first-seen order. When
    no field carries a step hint, all fields collapse into exactly one implicit step
    (the legacy / fallback shape — Req 6.6).
    """
    groups: dict = {}
    order: list = []
    for f in fields:
        hint = f.get("step")
        key = hint.strip() if isinstance(hint, str) and hint.strip() else None
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(f)

    default_title = (str(schema.get("title") or "").strip() or "Evidence")

    # No hints anywhere -> a single implicit step containing every field.
    if order == [None]:
        return [{
            "id": "main",
            "title": default_title,
            "purpose": str(schema.get("purpose") or ""),
            "fields": groups[None],
        }]

    steps = []
    for i, key in enumerate(order):
        if key is None:
            sid, title = f"step_{i + 1}", default_title
        else:
            sid, title = _slugify(key), key
        steps.append({"id": sid, "title": title, "purpose": "", "fields": groups[key]})
    return steps


def _dedup_step_aspects(steps: List[dict]) -> List[dict]:
    """De-duplicate aspects across all fields/steps by `(kind, normalized
    expected_subject)` so the user is asked for each thing once (Req 6.2).

    A media field whose every aspect is a duplicate of an earlier field's aspect is
    fully redundant and is dropped, which keeps the "every media field has >= 1
    aspect" guarantee intact. Non-media (text) fields are always preserved.
    """
    seen = set()
    for step in steps:
        kept_fields = []
        for f in step.get("fields", []):
            if f.get("type") in _MEDIA_FIELD_TYPES and isinstance(f.get("aspects"), list):
                new_aspects = []
                for a in f["aspects"]:
                    key = (a.get("kind"), _normalize_subject(a.get("expected_subject")))
                    if key in seen:
                        continue
                    seen.add(key)
                    new_aspects.append(a)
                f["aspects"] = new_aspects
                if not new_aspects:
                    # Every aspect was already covered earlier -> drop the field.
                    continue
            kept_fields.append(f)
        step["fields"] = kept_fields
    # Drop any step left empty by de-duplication.
    return [s for s in steps if s.get("fields")]


def _normalize_schema(schema: dict, category: Optional[str]) -> dict:
    """Normalize a Pass-1 Form_Schema into the structured v3 shape.

    Pure and deterministic (operates on a deep copy; no I/O, no randomness) so it is
    safe to target with property-based tests.

    Two input shapes are handled:

      A. Steps-first (v3, preferred) — the model returned ``steps[]`` with nested
         ``fields[]`` and no top-level ``fields[]``. Step structure (id, title, purpose)
         is preserved; fields are normalized in-place within their step.

      B. Flat fields-first (v2 legacy / fallback) — the model returned a top-level
         ``fields[]``. Steps are assembled from an emitted ``step`` hint on each field,
         or a single implicit step when no hints are present.

    Steps performed (both paths):
      1. Clamp the number of photo/video fields to ``MAX_PHOTO_FIELDS`` (Req 1.4).
      2. Backfill every media field with >= 1 complete aspect (Req 1.1, 1.3).
      3. De-duplicate aspects by ``(kind, normalized expected_subject)`` (Req 6.2).
      4. Resolve each media field's ``capture_mode`` (Req 5.1, 5.3).
      5. Stamp ``schemaVersion`` (Req 1.4).
    """
    schema = copy.deepcopy(schema) if isinstance(schema, dict) else {}

    # --- Pre-normalize common model output deviations ---

    # 1. "formSchema" is a frequent alias for "steps" that some model outputs use.
    if "formSchema" in schema and "steps" not in schema and "fields" not in schema:
        raw = schema.pop("formSchema")
        schema["steps"] = raw if isinstance(raw, list) else []

    # 2. Step objects sometimes use "description" instead of "title"/"purpose".
    for s in (schema.get("steps") or []):
        if isinstance(s, dict):
            desc = s.get("description") or ""
            if not s.get("title") and desc:
                s["title"] = desc
            if not s.get("purpose") and desc:
                s["purpose"] = desc

    # 3. Backfill missing "type" from "capture_mode" on any field so the type-based
    #    clamping and aspect-backfill logic below can match _MEDIA_FIELD_TYPES correctly.
    def _infer_type(f: dict) -> None:
        if "type" not in f:
            cm = f.get("capture_mode", "")
            f["type"] = cm if cm in ("photo", "video", "text") else "photo"

    for f in (schema.get("fields") or []):
        if isinstance(f, dict):
            _infer_type(f)
    for s in (schema.get("steps") or []):
        if isinstance(s, dict):
            for f in (s.get("fields") or []):
                if isinstance(f, dict):
                    _infer_type(f)

    # --- Detect input shape ---
    has_steps = (isinstance(schema.get("steps"), list) and
                 any(isinstance(s, dict) and s.get("fields") for s in schema.get("steps", [])))
    has_flat_fields = isinstance(schema.get("fields"), list) and len(schema.get("fields", [])) > 0

    if has_steps and not has_flat_fields:
        # Path A: steps-first schema — normalize in-place, preserving step structure.
        steps_raw = [s for s in schema["steps"] if isinstance(s, dict)]

        # 1. Clamp total photo/video fields across all steps (preserve step order).
        media_count = 0
        for step in steps_raw:
            kept_in_step: List[dict] = []
            for f in (step.get("fields") or []):
                if not isinstance(f, dict):
                    continue
                if f.get("type") in _MEDIA_FIELD_TYPES:
                    if media_count >= MAX_PHOTO_FIELDS:
                        continue
                    media_count += 1
                kept_in_step.append(f)
            step["fields"] = kept_in_step

        # 2. Backfill aspects on all media fields.
        for step in steps_raw:
            for f in step.get("fields", []):
                if f.get("type") in _MEDIA_FIELD_TYPES:
                    if not str(f.get("expected_subject") or "").strip():
                        f["expected_subject"] = str(f.get("label") or "").strip() or "the item"
                    if not str(f.get("validation_criteria") or "").strip():
                        f["validation_criteria"] = f"Must clearly show {f['expected_subject']}."
                    _backfill_field_aspects(f)

        # Build canonical steps list, preserving id/title/purpose from the model.
        steps: List[dict] = []
        for i, s in enumerate(steps_raw):
            sid = str(s.get("id") or "").strip() or f"step_{i + 1}"
            title = str(s.get("title") or "").strip() or f"Step {i + 1}"
            purpose = str(s.get("purpose") or "").strip()
            step_fields = [f for f in s.get("fields", []) if isinstance(f, dict)]
            if step_fields:
                steps.append({"id": sid, "title": title, "purpose": purpose, "fields": step_fields})

    else:
        # Path B: flat fields-first schema (legacy or fallback).
        fields = schema.get("fields") or []

        # 1. Clamp photo/video fields to MAX_PHOTO_FIELDS, preserving original order.
        kept: List[dict] = []
        media_count = 0
        for f in fields:
            if not isinstance(f, dict):
                continue
            if f.get("type") in _MEDIA_FIELD_TYPES:
                if media_count >= MAX_PHOTO_FIELDS:
                    continue
                media_count += 1
            kept.append(f)

        # 2. Backfill aspects + field-level acceptance text on every media field.
        for f in kept:
            if f.get("type") in _MEDIA_FIELD_TYPES:
                if not (str(f.get("expected_subject") or "").strip()):
                    f["expected_subject"] = (str(f.get("label") or "").strip() or "the item")
                if not (str(f.get("validation_criteria") or "").strip()):
                    f["validation_criteria"] = f"Must clearly show {f['expected_subject']}."
                _backfill_field_aspects(f)

        # 3. Assemble steps from field `step` hints (or single implicit step).
        steps = _assemble_steps(kept, schema)

    # 3/4. De-duplicate aspects across steps (drops fully-redundant media fields).
    steps = _dedup_step_aspects(steps)

    # Rebuild the flat field list from the (post-dedup) steps so `fields` and `steps`
    # stay in sync; legacy consumers keep reading `fields[]`.
    flat_fields = [f for step in steps for f in step.get("fields", [])]

    # 4/5. Resolve capture_mode per media field (after dedup, so all-`none` remnants
    #      correctly collapse to text). A text field drops its media requirement.
    for f in flat_fields:
        if f.get("type") in _MEDIA_FIELD_TYPES:
            mode = _resolve_capture_mode(f)
            f["capture_mode"] = mode
            if mode == "text":
                f["type"] = "text"

    schema["fields"] = flat_fields
    schema["steps"] = steps
    schema.setdefault("category", category or "generic")
    schema["schemaVersion"] = SCHEMA_VERSION
    return schema


def get_cached_schema(product_id: Optional[str], reason: str,
                      category: Optional[str] = None) -> Optional[dict]:
    """Return a cached Form_Schema if present and unexpired, else None."""
    if not _PASS1_CACHE_ENABLED:
        return None
    return _pass1_cache.get(cache_key(product_id, reason, category))


# How many catalog reference photos to attach to the Pass-1 prompt. The catalog
# images (what the product looks like new) are the highest-signal context for
# tailoring the form, so they get the larger share of the image budget.
MAX_LISTING_IMAGES = 4
MAX_CLARIFYING_IMAGES = 2


def _render_trust_tier(trust_tier: Optional[str]) -> str:
    """Render the customer trust tier for the Pass-1 prompt, falling back to a
    neutral 'unknown' when absent so behavior is unchanged (Req 6.5, 8.5)."""
    value = str(trust_tier or "").strip()
    return value or "unknown"


def _render_item_value(item_value: Optional[float]) -> str:
    """Render the item value for the Pass-1 prompt, falling back to a neutral
    'unknown' when absent or non-numeric (Req 6.5, 8.5)."""
    if item_value is None:
        return "unknown"
    try:
        return f"{float(item_value):.2f}"
    except (TypeError, ValueError):
        return "unknown"


async def generate_form(
    product_id: Optional[str],
    reason: str,
    category: Optional[str] = None,
    initial_photos: Optional[List[str]] = None,
    listing_image_urls: Optional[List[str]] = None,
    listing_data: Optional[dict] = None,
    image_hints: Optional[List[dict]] = None,
    seller_prompt: Optional[str] = None,
    base_prompt: Optional[str] = None,
    category_prompt: Optional[str] = None,
    trust_tier: Optional[str] = None,
    item_value: Optional[float] = None,
    pass1_template: Optional[str] = None,
    bust_cache: bool = False,
    trace=None,
) -> dict:
    """
    Generate (or serve from cache) a Form_Schema.

    Returns:
      { "schema": <Form_Schema>, "status": <STATUS_*>, "cached": bool, "key": <str> }
    """
    key = cache_key(product_id, reason, category)

    # Cache hit -> skip Gemini entirely (Req 3.3, 12.3).
    # bust_cache=True (dev/testing only) forces a fresh Gemini call even on a hit.
    # _PASS1_CACHE_ENABLED=False disables the read globally (cache currently OFF).
    cached = _pass1_cache.get(key) if _PASS1_CACHE_ENABLED else None
    if cached is not None and not bust_cache:
        if trace is not None:
            trace.success("pass1", "PASS1_CACHE",
                          f"⚡ Pass 1 cache HIT (key={key[:12]}…) — skipping Gemini entirely", cache_key=key)
        return {"schema": cached, "status": STATUS_CACHE, "cached": True, "key": key}
    if cached is not None and bust_cache and trace is not None:
        trace.info("pass1", "PASS1_CACHE_BUST",
                   f"🔄 Pass 1 cache BUSTED (key={key[:12]}…) — forcing fresh Gemini call", cache_key=key)

    if trace is not None:
        trace.info("pass1", "PASS1_START",
                   f"📝 Pass 1 form generation: cache MISS (key={key[:12]}…), composing prompt for "
                   f"category={category or 'unknown'}", cache_key=key, category=category)

    # Compose the Pass-1 prompt (prefer admin-edited override when present, Req 14.2).
    template = prompt_loader.load_template("pass1_form_generation.txt", override=pass1_template)

    # Build the image_hints block so the LLM generates one dedicated field per hint.
    hints_text = ""
    if image_hints:
        hints_lines = []
        for i, h in enumerate(image_hints[:8], 1):  # cap at 8 to not overwhelm
            url = (h.get("url") or "").strip()
            label = (h.get("label") or "").strip()
            hint = (h.get("hint") or "").strip()
            if label or hint:
                heading = label or "Custom check"
                hints_lines.append(
                    f"  {i}. Image: {url or '(attached)'}\n"
                    f"     Field heading: {heading}\n"
                    f"     What to verify: {hint or heading}")
        if hints_lines:
            hints_text = (
                "\n\nSELLER CUSTOM FIELD INSTRUCTIONS:\n"
                "The seller has flagged specific catalog images with instructions. For each entry below,\n"
                "you MUST generate a dedicated photo field in the form targeting that image/area.\n"
                "Use the 'Field heading' as the field label, and the 'What to verify' text as the\n"
                "guidance, expected_subject, and validation_criteria for that field.\n"
                "\n"
                "CRITICAL — the seller's instruction is the COMPLETE and CLOSED scope of this field:\n"
                "  * The field's aspect(s) and their `required_views` MUST contain ONLY the views the\n"
                "    seller's instruction actually names. Derive `required_views` directly from the\n"
                "    'Field heading' / 'What to verify' text — e.g. a heading 'Front and Back Tilted\n"
                "    View' yields required_views EXACTLY [\"front tilted view\", \"back tilted view\"].\n"
                "  * DO NOT expand a seller field into a generic multi-edge or full-perimeter\n"
                "    inspection. NEVER add edges, regions, angles, labels, or close-ups the seller did\n"
                "    not ask for (no 'front edge'/'top edge'/'left edge'/etc. unless the seller's text\n"
                "    literally requests edges). Adding undeclared views will wrongly reject correct\n"
                "    photos.\n"
                "  * label, guidance, expected_subject, and required_views for the seller field MUST\n"
                "    all describe the same narrow scope the seller specified — nothing broader.\n"
                + "\n".join(hints_lines)
            )

    body = template.format(
        reason=reason,
        category=category or "unknown",
        listing_data=json.dumps(listing_data or {}, ensure_ascii=False),
        image_hints_section=hints_text,
        trust_tier=_render_trust_tier(trust_tier),
        item_value=_render_item_value(item_value),
    )
    prompt = prompt_loader.compose(category, body, seller_prompt=seller_prompt,
                                   base_override=base_prompt, category_override=category_prompt)

    # Attach images (multimodal) — best-effort. Catalog reference photos first (they
    # show what the product looks like new, the strongest signal for tailoring the
    # form), then any clarifying photos the user already uploaded.
    images: List[bytes] = []

    catalog_requested = (listing_image_urls or [])[:MAX_LISTING_IMAGES]
    catalog_attached = 0
    for idx, url in enumerate(catalog_requested):
        b = await try_fetch_image_bytes(url, trace=trace, phase="pass1",
                                        label=f"Pass 1 catalog reference photo #{idx + 1}")
        if b is not None:
            images.append(b)
            catalog_attached += 1

    clarifying_requested = (initial_photos or [])[:MAX_CLARIFYING_IMAGES]
    clarifying_attached = 0
    for idx, url in enumerate(clarifying_requested):
        b = await try_fetch_image_bytes(url, trace=trace, phase="pass1",
                                        label=f"Pass 1 clarifying photo #{idx + 1}")
        if b is not None:
            images.append(b)
            clarifying_attached += 1

    if trace is not None and (catalog_requested or clarifying_requested):
        total_req = len(catalog_requested) + len(clarifying_requested)
        total_att = catalog_attached + clarifying_attached
        if total_att < total_req:
            trace.warn("pass1", "PASS1_IMAGES",
                       f"⚠️ Pass 1 attaching {total_att}/{total_req} photo(s) "
                       f"({catalog_attached} catalog ref, {clarifying_attached} clarifying) — "
                       f"{total_req - total_att} failed to fetch (model sees fewer images).",
                       requested=total_req, attached=total_att,
                       catalog_attached=catalog_attached, clarifying_attached=clarifying_attached)
        else:
            trace.info("pass1", "PASS1_IMAGES",
                       f"🖼️ Pass 1 attaching {total_att} photo(s) to the multimodal prompt "
                       f"({catalog_attached} catalog reference, {clarifying_attached} clarifying)",
                       attached=total_att,
                       catalog_attached=catalog_attached, clarifying_attached=clarifying_attached)

    try:
        schema_raw = await gemini_service.invoke_json(prompt, images=images or None, max_tokens=4096,
                                                      trace=trace, phase="pass1", label="Pass 1 form generator")
        if not _is_valid_form_schema(schema_raw):
            raise GeminiJSONError("Form schema failed shape validation")

        # Log which normalization path will be taken before calling _normalize_schema.
        raw_has_steps = (isinstance(schema_raw.get("steps"), list)
                         and bool(schema_raw.get("steps"))
                         and not schema_raw.get("fields"))
        raw_step_count = len(schema_raw.get("steps") or []) if raw_has_steps else 0
        raw_field_count = len(schema_raw.get("fields") or []) if not raw_has_steps else sum(
            len(s.get("fields") or []) for s in (schema_raw.get("steps") or []) if isinstance(s, dict)
        )
        if trace is not None:
            trace.info("pass1", "PASS1_NORMALIZE",
                       f"🗂️ Normalizing schema — model used "
                       f"{'steps-first layout (Path A)' if raw_has_steps else 'flat fields layout (Path B)'}: "
                       f"{raw_step_count or 1} step(s), {raw_field_count} field(s) before clamping/dedup",
                       schema_path="steps_first" if raw_has_steps else "flat_fields",
                       raw_step_count=raw_step_count,
                       raw_field_count=raw_field_count,
                       raw_schema_version=schema_raw.get("schemaVersion"))

        schema = _normalize_schema(schema_raw, category)
        schema["generated"] = True
        _pass1_cache.set(key, schema)

        if trace is not None:
            steps = schema.get("steps") or []
            field_count = len(schema.get("fields") or [])
            photo_count = sum(1 for f in schema.get("fields", []) if f.get("type") in ("photo", "video"))
            text_count = sum(1 for f in schema.get("fields", []) if f.get("type") == "text")
            video_count = sum(1 for f in schema.get("fields", []) if f.get("capture_mode") == "video")
            unverifiable_count = sum(
                1 for f in schema.get("fields", [])
                if any(a.get("verifiability") == "none"
                       for a in (f.get("aspects") or []) if isinstance(a, dict))
            )
            step_summary = [
                {"id": s.get("id"), "title": s.get("title"),
                 "field_count": len(s.get("fields") or [])}
                for s in steps
            ]
            trace.success("pass1", "PASS1_COMPLETE",
                          f"✅ Pass 1 generated a tailored {len(steps)}-step, {field_count}-field form — "
                          f"{photo_count} photo, {video_count} video, {text_count} text field(s)"
                          + (f"; {unverifiable_count} field(s) with verifiability=none (→ human review)"
                             if unverifiable_count else "")
                          + " — cached for reuse",
                          step_count=len(steps),
                          field_count=field_count,
                          photo_field_count=photo_count,
                          video_field_count=video_count,
                          text_field_count=text_count,
                          unverifiable_field_count=unverifiable_count,
                          steps=step_summary,
                          status=STATUS_AI)
        return {"schema": schema, "status": STATUS_AI, "cached": False, "key": key}

    except (GeminiError, GeminiJSONError) as exc:
        logger.warning("Pass-1 Gemini failed (%s); applying fallback", exc)
        if trace is not None:
            trace.error("pass1", "PASS1_MODEL_ERROR",
                        f"❌ Pass 1 model/parse error ({type(exc).__name__}): {exc} — "
                        "checking cache then falling back to generic form",
                        error_type=type(exc).__name__, error_detail=str(exc))
        # Degraded: serve cache if any (shouldn't be, we already checked), else generic.
        fallback_cached = _pass1_cache.get(key)
        if fallback_cached is not None:
            if trace is not None:
                trace.warn("pass1", "PASS1_FALLBACK",
                           f"⚠️ Pass 1 Gemini failed ({type(exc).__name__}); serving cached schema instead",
                           status=STATUS_FALLBACK_CACHE)
            return {"schema": fallback_cached, "status": STATUS_FALLBACK_CACHE,
                    "cached": True, "key": key}
        if trace is not None:
            trace.warn("pass1", "PASS1_FALLBACK",
                       f"⚠️ Pass 1 Gemini failed ({type(exc).__name__}); serving the GENERIC default form. "
                       "The user still gets a usable form, but it is not AI-tailored.",
                       status=STATUS_FALLBACK_GENERIC)
        return {"schema": _generic_default_schema(category), "status": STATUS_FALLBACK_GENERIC,
                "cached": False, "key": key}


def generic_default_schema(category: Optional[str] = None) -> dict:
    """Public accessor for the generic default schema (used by progressive-form fallback)."""
    return _generic_default_schema(category)
