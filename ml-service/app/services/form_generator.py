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
"""
import json
import logging
from typing import Optional, List

from app.config import settings
from app.services import prompt_loader
from app.services.gemini import gemini_service, GeminiError, GeminiJSONError
from app.services.ttl_cache import TTLCache, cache_key
from app.services.image_utils import try_fetch_image_bytes

logger = logging.getLogger("ml-service.form_generator")

# Module-scoped cache so it survives across requests within the process.
_pass1_cache = TTLCache(settings.grade_cache_ttl_seconds)

# Form_Schema contract version — bumped when the schema shape changes so the
# frontend / Evidence_Bundle can reason about compatibility (improvement #9).
SCHEMA_VERSION = 2

# Hard cap on photo fields so a hallucinated 30-field form can't wreck the UX (Req / improvement #9).
MAX_PHOTO_FIELDS = 8

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
    if not isinstance(fields, list) or len(fields) == 0:
        return False
    for f in fields:
        if not isinstance(f, dict):
            return False
        if "id" not in f or "type" not in f:
            return False
    return True


def _normalize_schema(schema: dict, category: Optional[str]) -> dict:
    """Clamp field counts, backfill expected_subject, stamp version (improvements #2/#9)."""
    fields = schema.get("fields") or []

    # Clamp photo fields to MAX_PHOTO_FIELDS; keep all non-photo fields (text/select/bool).
    photo_fields = [f for f in fields if f.get("type") == "photo"]
    other_fields = [f for f in fields if f.get("type") != "photo"]
    if len(photo_fields) > MAX_PHOTO_FIELDS:
        photo_fields = photo_fields[:MAX_PHOTO_FIELDS]
    kept = photo_fields + other_fields

    # Backfill a sane expected_subject + validation_criteria for any photo field the
    # model left bare, so per-upload inspection always has an acceptance test.
    for f in kept:
        if f.get("type") == "photo":
            if not (f.get("expected_subject") or "").strip():
                f["expected_subject"] = f.get("label") or "the item"
            if not (f.get("validation_criteria") or "").strip():
                f["validation_criteria"] = (
                    f"Must clearly show {f['expected_subject']}.")

    schema["fields"] = kept
    schema.setdefault("category", category or "generic")
    schema["schemaVersion"] = SCHEMA_VERSION
    return schema


def get_cached_schema(product_id: Optional[str], reason: str,
                      category: Optional[str] = None) -> Optional[dict]:
    """Return a cached Form_Schema if present and unexpired, else None."""
    return _pass1_cache.get(cache_key(product_id, reason, category))


# How many catalog reference photos to attach to the Pass-1 prompt. The catalog
# images (what the product looks like new) are the highest-signal context for
# tailoring the form, so they get the larger share of the image budget.
MAX_LISTING_IMAGES = 4
MAX_CLARIFYING_IMAGES = 2


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
    trace=None,
) -> dict:
    """
    Generate (or serve from cache) a Form_Schema.

    Returns:
      { "schema": <Form_Schema>, "status": <STATUS_*>, "cached": bool, "key": <str> }
    """
    key = cache_key(product_id, reason, category)

    # Cache hit -> skip Gemini entirely (Req 3.3, 12.3).
    cached = _pass1_cache.get(key)
    if cached is not None:
        if trace is not None:
            trace.success("pass1", "PASS1_CACHE",
                          f"⚡ Pass 1 cache HIT (key={key[:12]}…) — skipping Gemini entirely", cache_key=key)
        return {"schema": cached, "status": STATUS_CACHE, "cached": True, "key": key}

    if trace is not None:
        trace.info("pass1", "PASS1_START",
                   f"📝 Pass 1 form generation: cache MISS (key={key[:12]}…), composing prompt for "
                   f"category={category or 'unknown'}", cache_key=key, category=category)

    # Compose the Pass-1 prompt.
    template = prompt_loader.load_template("pass1_form_generation.txt")

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
                + "\n".join(hints_lines)
            )

    body = template.format(
        reason=reason,
        category=category or "unknown",
        listing_data=json.dumps(listing_data or {}, ensure_ascii=False),
        image_hints_section=hints_text,
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
        schema = await gemini_service.invoke_json(prompt, images=images or None, max_tokens=1500,
                                                   trace=trace, phase="pass1", label="Pass 1 form generator")
        if not _is_valid_form_schema(schema):
            raise GeminiJSONError("Form schema failed shape validation")
        schema = _normalize_schema(schema, category)
        schema["generated"] = True
        _pass1_cache.set(key, schema)
        if trace is not None:
            field_count = len(schema.get("fields", []))
            photo_count = sum(1 for f in schema["fields"] if f.get("type") == "photo")
            trace.success("pass1", "PASS1_COMPLETE",
                          f"✅ Pass 1 generated a tailored {field_count}-field evidence form "
                          f"({photo_count} photo field(s), cached for reuse)",
                          field_count=field_count, photo_count=photo_count, status=STATUS_AI)
        return {"schema": schema, "status": STATUS_AI, "cached": False, "key": key}

    except (GeminiError, GeminiJSONError) as exc:
        logger.warning("Pass-1 Gemini failed (%s); applying fallback", exc)
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
