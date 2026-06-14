"""
Evidence Inspector — Pass 1.5 (v2.34 → v2.35)

v2.35: the unit of inspection is ONE FIELD (its photo set), not one photo. The
``inspect_field`` entry point fetches every photo for a field, runs the
deterministic phash/EXIF preflight per photo, then makes ONE multimodal LLM
call to judge whether the photo SET satisfies the field's requirement —
returning a single field-level accept/reject plus per-photo descriptive notes
and any missing views.

The legacy single-photo ``inspect_photo`` is preserved as a thin wrapper that
delegates to ``inspect_field`` with a one-element photo list, so any caller
still on the v2.34 contract keeps working.

Hard rule (unchanged): the inspector DESCRIBES, it never GRADES. There is no
grade/severity/score in any response shape — all grading judgment lives in
Pass 2 (`grade_synthesizer`).

Resilience (unchanged): on LLM unavailability we ACCEPT-WITH-WARNING rather
than hard-block the user.
"""
import asyncio
import json
import logging
from typing import Optional, List, Dict, Any

from app.config import settings
from app.services import prompt_loader, fraud_preflight
from app.services.gemini import gemini_service, GeminiError, GeminiJSONError
from app.services.image_utils import try_fetch_image_bytes

logger = logging.getLogger("ml-service.evidence_inspector")

_CLARITY = {"clear", "blurry", "dark", "cropped"}
_IDENTITY = {"yes", "no", "unknown"}


def _as_str_list(value) -> List[str]:
    if isinstance(value, list):
        return [str(v) for v in value if v is not None and str(v).strip()]
    if value is None:
        return []
    return [str(value)]


def _normalize(raw: Dict[str, Any]) -> Dict[str, Any]:
    """
    Coerce a single-photo LLM output into the legacy v2.34 inspector shape.

    Preserved so the back-compat ``inspect_photo`` path and existing tests that
    exercise the per-photo normalization keep working.
    """
    accepted = bool(raw.get("accepted", True))

    clarity = str(raw.get("clarity", "clear")).strip().lower()
    if clarity not in _CLARITY:
        clarity = "clear"

    identity = str(raw.get("identity_match", "unknown")).strip().lower()
    if identity not in _IDENTITY:
        identity = "unknown"

    reupload_reason = raw.get("reupload_reason")
    reupload_reason = str(reupload_reason).strip() if reupload_reason else None
    if accepted:
        reupload_reason = None
    elif not reupload_reason:
        reupload_reason = ("This photo could not be used as evidence — please re-upload "
                           "a clearer photo of the requested view.")

    ocr = raw.get("ocr_text")
    ocr = str(ocr).strip() if ocr and str(ocr).strip() else None

    return {
        "accepted": accepted,
        "reupload_reason": reupload_reason,
        "clarity": clarity,
        "subject_match": bool(raw.get("subject_match", True)),
        "identity_match": identity,
        "observations": _as_str_list(raw.get("observations")),
        "ocr_text": ocr,
        "condition_signals": _as_str_list(raw.get("condition_signals")),
        "inspector_model": getattr(gemini_service, "_current_model", settings.gemini_model_primary),
        "inspector_status": "ok",
    }


def _normalize_field(raw: Dict[str, Any], photo_urls: List[str]) -> Dict[str, Any]:
    """Coerce field-level LLM output into the strict FieldInspectionResponse shape."""
    accepted = bool(raw.get("accepted", True))

    reupload_reason = raw.get("reupload_reason")
    reupload_reason = str(reupload_reason).strip() if reupload_reason else None
    if accepted:
        reupload_reason = None
    elif not reupload_reason:
        reupload_reason = ("Some required views are missing for this field — "
                           "please upload additional photos.")

    # Per-photo notes: keep only entries that match a real URL we sent; ignore extras.
    raw_notes = raw.get("per_photo") or []
    valid_urls = set(photo_urls)
    per_photo: List[Dict[str, Any]] = []
    seen_urls: set = set()
    for item in raw_notes:
        if not isinstance(item, dict):
            continue
        url = str(item.get("image_url") or "").strip()
        if url and url not in valid_urls:
            # The model echoed an unknown URL — drop it rather than confuse the UI.
            continue
        if url in seen_urls:
            continue
        seen_urls.add(url)
        per_photo.append({
            "image_url": url or None,
            "role": (str(item.get("role")).strip() if item.get("role") else None),
            "usable": (bool(item["usable"]) if "usable" in item and item["usable"] is not None else None),
            "note": (str(item.get("note")).strip() if item.get("note") else None),
        })
    # Backfill empty per_photo entries for any photos the model didn't mention so
    # the UI can still render every uploaded image with a neutral state.
    mentioned = {p["image_url"] for p in per_photo if p["image_url"]}
    for url in photo_urls:
        if url not in mentioned:
            per_photo.append({"image_url": url, "role": None, "usable": None, "note": None})

    # OCR is reported per photo; tolerate either {url: text} dict or a flat list.
    ocr_in = raw.get("ocr_text_per_photo") or {}
    ocr_out: Dict[str, str] = {}
    if isinstance(ocr_in, dict):
        for k, v in ocr_in.items():
            if v and str(v).strip() and str(k) in valid_urls:
                ocr_out[str(k)] = str(v).strip()

    return {
        "accepted": accepted,
        "reupload_reason": reupload_reason,
        "per_photo": per_photo,
        "missing_views": _as_str_list(raw.get("missing_views")),
        "observations": _as_str_list(raw.get("observations")),
        "ocr_text_per_photo": ocr_out,
        "condition_signals": _as_str_list(raw.get("condition_signals")),
        "inspector_model": getattr(gemini_service, "_current_model", settings.gemini_model_primary),
        "inspector_status": "ok",
    }


def _accept_with_warning(reason: str, status: str = "unavailable") -> Dict[str, Any]:
    """Permissive result used when the LLM cannot run — never blocks the user."""
    return {
        "accepted": True,
        "reupload_reason": None,
        "clarity": "clear",
        "subject_match": True,
        "identity_match": "unknown",
        "observations": [],
        "ocr_text": None,
        "condition_signals": [],
        "inspector_model": getattr(gemini_service, "_current_model", settings.gemini_model_primary),
        "inspector_status": status,
        "warning": reason,
    }


def _accept_field_with_warning(reason: str, photo_urls: List[str],
                                 status: str = "unavailable") -> Dict[str, Any]:
    """Field-level accept-with-warning when the LLM cannot run."""
    return {
        "accepted": True,
        "reupload_reason": None,
        "per_photo": [{"image_url": u, "role": None, "usable": None, "note": None} for u in photo_urls],
        "missing_views": [],
        "observations": [],
        "ocr_text_per_photo": {},
        "condition_signals": [],
        "inspector_model": getattr(gemini_service, "_current_model", settings.gemini_model_primary),
        "inspector_status": status,
        "warning": reason,
    }


def _normalize(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Coerce the LLM output into the strict inspector shape (no grading fields)."""
    accepted = bool(raw.get("accepted", True))

    clarity = str(raw.get("clarity", "clear")).strip().lower()
    if clarity not in _CLARITY:
        clarity = "clear"

    identity = str(raw.get("identity_match", "unknown")).strip().lower()
    if identity not in _IDENTITY:
        identity = "unknown"

    reupload_reason = raw.get("reupload_reason")
    reupload_reason = str(reupload_reason).strip() if reupload_reason else None
    # Keep the accepted/reason invariant consistent.
    if accepted:
        reupload_reason = None
    elif not reupload_reason:
        reupload_reason = "This photo could not be used as evidence — please re-upload a clearer photo of the requested view."

    ocr = raw.get("ocr_text")
    ocr = str(ocr).strip() if ocr and str(ocr).strip() else None

    return {
        "accepted": accepted,
        "reupload_reason": reupload_reason,
        "clarity": clarity,
        "subject_match": bool(raw.get("subject_match", True)),
        "identity_match": identity,
        "observations": _as_str_list(raw.get("observations")),
        "ocr_text": ocr,
        "condition_signals": _as_str_list(raw.get("condition_signals")),
        "inspector_model": getattr(gemini_service, "_current_model", settings.gemini_model_primary),
        "inspector_status": "ok",
    }


async def inspect_field(
    photo_urls: List[str],
    *,
    field_id: Optional[str] = None,
    field_label: Optional[str] = None,
    expected_subject: Optional[str] = None,
    validation_criteria: Optional[str] = None,
    listing_data: Optional[dict] = None,
    catalog_image_urls: Optional[List[str]] = None,
    reason: Optional[str] = None,
    category: Optional[str] = None,
    seller_prompt: Optional[str] = None,
    base_prompt: Optional[str] = None,
    category_prompt: Optional[str] = None,
    trace=None,
) -> Dict[str, Any]:
    """
    Inspect ONE form field's photo set as a whole (v2.35).

    Pipeline:
      1. Fetch each photo's bytes (parallel) + per-photo phash/EXIF preflight.
         Any HARD phash match short-circuits to a field-level reject (stock-photo theft).
      2. Otherwise, ONE multimodal Gemini call with all usable photos + the
         field-level prompt — judges the SET against the field's requirement.
      3. Returns the field-level decision; never raises.
    """
    photo_urls = list(photo_urls or [])
    if not photo_urls:
        return {
            "accepted": False,
            "reupload_reason": "Please upload at least one photo for this field.",
            "per_photo": [],
            "missing_views": [],
            "observations": [],
            "ocr_text_per_photo": {},
            "condition_signals": [],
            "preflight_per_photo": {},
            "inspector_model": None,
            "inspector_status": "no_photos",
        }

    if trace is not None:
        trace.info("inspect", "INSPECT_START",
                   f"🔎 Evidence Inspector (field): {len(photo_urls)} photo(s) for field "
                   f"'{field_id or 'unknown'}'"
                   f"{f' (expected: {expected_subject})' if expected_subject else ''}",
                   field_id=field_id, expected_subject=expected_subject,
                   photo_count=len(photo_urls))

    # --- Step 1: fetch + preflight every photo (parallel) ---
    catalog_hashes: List[str] = []
    if catalog_image_urls:
        try:
            catalog_hashes = await fraud_preflight.compute_catalog_hashes(
                catalog_image_urls, trace=trace)
        except Exception as exc:  # noqa: BLE001
            logger.warning("catalog hash compute failed: %s", exc)

    async def _fetch_one(idx: int, url: str):
        b = await try_fetch_image_bytes(
            url, trace=trace, phase="inspect", label=f"evidence photo #{idx + 1}")
        return url, b

    fetched = await asyncio.gather(*(_fetch_one(i, u) for i, u in enumerate(photo_urls)))

    preflight_per_photo: Dict[str, Any] = {}
    photo_bytes: List[tuple] = []   # [(url, bytes)] — usable photos only
    unfetchable: List[str] = []
    phash_hit_url: Optional[str] = None

    for url, b in fetched:
        if b is None:
            unfetchable.append(url)
            preflight_per_photo[url] = {"unfetchable": True}
            continue
        try:
            pf = fraud_preflight.preflight_bytes(b, catalog_hashes)
        except Exception as exc:  # noqa: BLE001
            logger.warning("preflight failed for %s: %s", url, exc)
            pf = {}
        preflight_per_photo[url] = pf
        if pf.get("classification") == fraud_preflight.CLASSIFICATION_HARD and phash_hit_url is None:
            phash_hit_url = url
        photo_bytes.append((url, b))

    # If a single photo phash-matches a catalog image, reject the field early.
    if phash_hit_url is not None:
        if trace is not None:
            trace.warn("inspect", "INSPECT_RESULT",
                       "🚫 One uploaded photo matches the product's catalog image "
                       "(perceptual-hash) — asking for original photos.",
                       phash_hit_url=phash_hit_url)
        return {
            "accepted": False,
            "reupload_reason": ("One of the photos looks like the product's catalog/listing image "
                                "rather than a photo you took. Please replace it with your own photo "
                                "of the actual item."),
            "per_photo": [
                {"image_url": u, "role": None,
                 "usable": (u != phash_hit_url),
                 "note": ("matches catalog image — please replace" if u == phash_hit_url else None)}
                for u in photo_urls
            ],
            "missing_views": [],
            "observations": [],
            "ocr_text_per_photo": {},
            "condition_signals": [],
            "preflight_per_photo": preflight_per_photo,
            "inspector_model": None,
            "inspector_status": "phash_rejected",
        }

    # If every photo failed to fetch/decode, reject the field.
    if not photo_bytes:
        if trace is not None:
            trace.error("inspect", "INSPECT_RESULT",
                        f"❌ Could not open any of the {len(photo_urls)} uploaded photo(s).")
        return {
            "accepted": False,
            "reupload_reason": "We couldn't open any of these photos. Please re-upload as JPG or PNG.",
            "per_photo": [{"image_url": u, "role": None, "usable": False,
                           "note": "couldn't open this image"} for u in photo_urls],
            "missing_views": [],
            "observations": [],
            "ocr_text_per_photo": {},
            "condition_signals": [],
            "preflight_per_photo": preflight_per_photo,
            "inspector_model": None,
            "inspector_status": "unprocessable_image",
        }

    # --- Step 2: compose prompt + ONE multimodal Gemini call ---
    try:
        template = prompt_loader.load_template("evidence_inspection.txt")
    except prompt_loader.PromptError as exc:
        logger.warning("Inspection template unavailable: %s", exc)
        result = _accept_field_with_warning(f"inspection prompt unavailable: {exc}",
                                            [u for u, _ in photo_bytes])
        result["preflight_per_photo"] = preflight_per_photo
        return result

    # Index photos so the LLM can refer to them as PHOTO_1, PHOTO_2, ... and emit
    # back per_photo[].image_url that we can map to the canonical URLs.
    photo_index_block = "\n".join(
        f"- PHOTO_{i + 1} url: {u}" for i, (u, _) in enumerate(photo_bytes)
    )
    if unfetchable:
        photo_index_block += "\n" + "\n".join(
            f"- (unavailable, ignore) url: {u}" for u in unfetchable
        )

    body = template.format(
        field_id=field_id or "unknown",
        field_label=field_label or "the requested view",
        expected_subject=expected_subject or "the item",
        validation_criteria=validation_criteria or "(none — judge against the expected subject above)",
        listing_data=json.dumps(listing_data or {}, ensure_ascii=False),
        reason=reason or "(none provided)",
        photo_count=len(photo_bytes),
        photo_index=photo_index_block,
    )
    prompt = prompt_loader.compose(category, body, seller_prompt=seller_prompt,
                                   base_override=base_prompt, category_override=category_prompt)

    try:
        raw = await gemini_service.invoke_json(
            prompt,
            images=[b for _, b in photo_bytes],
            max_tokens=1200,
            trace=trace, phase="inspect", label="Evidence Inspector (field)",
        )
    except (GeminiError, GeminiJSONError) as exc:
        if trace is not None:
            trace.warn("inspect", "INSPECT_DEGRADED",
                       f"⚠️ Evidence Inspector LLM unavailable ({type(exc).__name__}) — "
                       "accepting the field with a warning so the user is not blocked.", exc=exc)
        result = _accept_field_with_warning(f"inspector LLM failed: {exc}",
                                            [u for u, _ in photo_bytes])
        result["preflight_per_photo"] = preflight_per_photo
        return result

    result = _normalize_field(raw, [u for u, _ in photo_bytes])
    result["preflight_per_photo"] = preflight_per_photo

    # If some photos couldn't be fetched, record them as unusable in per_photo.
    if unfetchable:
        present = {p["image_url"] for p in result["per_photo"]}
        for url in unfetchable:
            if url not in present:
                result["per_photo"].append({
                    "image_url": url, "role": None, "usable": False,
                    "note": "couldn't open this image — please re-upload",
                })

    if trace is not None:
        if result["accepted"]:
            trace.success("inspect", "INSPECT_RESULT",
                          f"✅ Field accepted ({len(photo_bytes)} photo(s), "
                          f"{len(result['observations'])} observation(s))",
                          missing_views=result["missing_views"])
        else:
            trace.warn("inspect", "INSPECT_RESULT",
                       f"⚠️ Re-upload requested for field: {result['reupload_reason']}",
                       missing_views=result["missing_views"])

    return result


async def inspect_photo(
    photo_url: str,
    *,
    field_id: Optional[str] = None,
    field_label: Optional[str] = None,
    expected_subject: Optional[str] = None,
    validation_criteria: Optional[str] = None,
    listing_data: Optional[dict] = None,
    catalog_image_urls: Optional[List[str]] = None,
    reason: Optional[str] = None,
    category: Optional[str] = None,
    seller_prompt: Optional[str] = None,
    base_prompt: Optional[str] = None,
    category_prompt: Optional[str] = None,
    trace=None,
) -> Dict[str, Any]:
    """
    Single-photo inspection (back-compat wrapper, v2.34 contract).

    Delegates to ``inspect_field`` with a one-element photo list and projects the
    field-level result back onto the per-photo shape callers still expect.
    """
    field = await inspect_field(
        [photo_url],
        field_id=field_id, field_label=field_label,
        expected_subject=expected_subject, validation_criteria=validation_criteria,
        listing_data=listing_data, catalog_image_urls=catalog_image_urls,
        reason=reason, category=category,
        seller_prompt=seller_prompt, base_prompt=base_prompt,
        category_prompt=category_prompt, trace=trace,
    )

    # Project back onto per-photo shape.
    note = next(iter(field.get("per_photo") or []), {}) or {}
    accepted = bool(field.get("accepted", True))
    # On a multi-image set the field could be accepted while some photos are flagged
    # unusable — but here there is only one photo, so accept iff the field accepted
    # AND that single photo wasn't marked unusable.
    if accepted and note.get("usable") is False:
        accepted = False

    # Best-effort projection of clarity/subject/identity from the field-level call.
    # The new prompt no longer emits these per-photo fields directly; we keep the
    # legacy shape conservatively (LLM may still include them — pick them up if so).
    raw_clarity = note.get("clarity") or "clear"
    if raw_clarity not in _CLARITY:
        raw_clarity = "clear"
    return {
        "accepted": accepted,
        "reupload_reason": field.get("reupload_reason") if not accepted else None,
        "clarity": raw_clarity,
        "subject_match": (note.get("usable") is not False),
        "identity_match": "no" if (not accepted and (field.get("missing_views") or note.get("usable") is False))
                          else "unknown",
        "observations": field.get("observations") or [],
        "ocr_text": (field.get("ocr_text_per_photo") or {}).get(photo_url) or None,
        "condition_signals": field.get("condition_signals") or [],
        "preflight": (field.get("preflight_per_photo") or {}).get(photo_url) or {},
        "inspector_model": field.get("inspector_model"),
        "inspector_status": field.get("inspector_status"),
    }


def build_analysis_summary(
    fragments: List[Dict[str, Any]],
    *,
    fraud: Optional[Dict[str, Any]] = None,
    category: Optional[str] = None,
    reason: Optional[str] = None,
    trace=None,
) -> Dict[str, Any]:
    """
    Assemble the text-only Analysis_Summary fed to Pass 2 from the stored fragments.
    Handles BOTH cardinalities transparently:
      * v2.34 — one fragment per photo (image_url + image_hash set, no per_photo)
      * v2.35 — one fragment per field (image_urls + per_photo + missing_views set)

    When both shapes exist for the same field_id (during/after a v2.35 verify), the
    field-level fragment wins and any v2.34 per-photo fragments under the same field
    are dropped from the summary so we don't double-count.
    """
    fragments = fragments or []

    # Bucket fragments by field_id and pick a winner per bucket.
    buckets: Dict[str, List[Dict[str, Any]]] = {}
    for fr in fragments:
        fid = fr.get("field_id") or "ungrouped"
        buckets.setdefault(fid, []).append(fr)

    by_field: Dict[str, Any] = {}
    field_images: Dict[str, List[str]] = {}
    all_ocr: List[str] = []
    identity_flags: List[str] = []
    inspector_status_flags: List[str] = []
    field_level_count = 0
    photo_level_count = 0

    def _is_field_level(fr: Dict[str, Any]) -> bool:
        return bool(fr.get("image_urls") or fr.get("per_photo") or fr.get("missing_views"))

    for fid, frs in buckets.items():
        # If any fragment in the bucket is field-level (v2.35), prefer it and drop
        # the per-photo ones for this field.
        field_level = [fr for fr in frs if _is_field_level(fr)]
        if field_level:
            # Use the most recent field-level fragment (last one wins).
            fr = field_level[-1]
            field_level_count += 1
            urls = list(fr.get("image_urls") or [])
            per_photo = fr.get("per_photo") or []
            entry = {
                "field_label": fr.get("field_label"),
                "image_urls": urls,
                "per_photo": [
                    {k: p.get(k) for k in ("image_url", "role", "usable", "note") if k in p}
                    for p in per_photo if isinstance(p, dict)
                ],
                "missing_views": fr.get("missing_views") or [],
                "observations": fr.get("observations") or [],
                "condition_signals": fr.get("condition_signals") or [],
                "ocr_text_per_photo": fr.get("ocr_text_per_photo") or {},
                "inspector_status": fr.get("inspector_status"),
                "preflight_per_photo": fr.get("preflight_per_photo") or {},
            }
            by_field[fid] = entry
            if urls:
                field_images[fid] = urls
            for txt in (fr.get("ocr_text_per_photo") or {}).values():
                if txt:
                    all_ocr.append(str(txt))
            if fr.get("missing_views"):
                identity_flags.append("partial")
            if fr.get("inspector_status") and fr.get("inspector_status") != "ok":
                inspector_status_flags.append(fr.get("inspector_status"))
            continue

        # v2.34 path — assemble photos under the field.
        entry = {"field_label": frs[0].get("field_label"), "photos": []}
        for fr in frs:
            photo_level_count += 1
            entry["photos"].append({
                "image_url": fr.get("image_url"),
                "clarity": fr.get("clarity"),
                "subject_match": fr.get("subject_match"),
                "identity_match": fr.get("identity_match"),
                "observations": fr.get("observations") or [],
                "condition_signals": fr.get("condition_signals") or [],
                "ocr_text": fr.get("ocr_text"),
                "inspector_status": fr.get("inspector_status"),
                "preflight": fr.get("preflight") or {},
            })
            if fr.get("image_url"):
                field_images.setdefault(fid, []).append(fr["image_url"])
            if fr.get("ocr_text"):
                all_ocr.append(fr["ocr_text"])
            if fr.get("identity_match"):
                identity_flags.append(fr["identity_match"])
            if fr.get("inspector_status") and fr.get("inspector_status") != "ok":
                inspector_status_flags.append(fr.get("inspector_status"))
        by_field[fid] = entry

    warnings: List[str] = []
    if not fragments:
        warnings.append("no_evidence_fragments")
    if any(f == "no" for f in identity_flags):
        warnings.append("identity_mismatch_reported")
    if inspector_status_flags:
        warnings.append("some_inspections_degraded")

    summary: Dict[str, Any] = {
        "source": "evidence_fragments",
        "category": category,
        "reason": reason,
        "field_count": len(by_field),
        # Back-compat: tests/UI still read `photo_count`. For v2.34 fragments it equals
        # the fragment count; for v2.35 fragments it's the total photos in the set.
        "photo_count": photo_level_count + sum(
            len(v.get("image_urls") or []) for v in by_field.values()
        ),
        "field_level_fragment_count": field_level_count,
        "photo_level_fragment_count": photo_level_count,
        "evidence_fields": sorted(by_field.keys()),
        "field_images": field_images,
        "by_field": by_field,
        "ocr_text": all_ocr,
        "warnings": warnings,
    }
    if fraud is not None:
        summary["fraud"] = fraud

    if trace is not None:
        trace.info("analysis", "FRAGMENT_SUMMARY",
                   f"🧩 Pass-2 summary assembled: {len(by_field)} field(s), "
                   f"{field_level_count} field-level fragment(s), "
                   f"{photo_level_count} photo-level fragment(s). "
                   f"Fields: {', '.join(sorted(by_field.keys())) or 'none'}",
                   field_count=len(by_field),
                   field_level_count=field_level_count,
                   photo_level_count=photo_level_count,
                   warnings=warnings)

    return summary
