"""
Parallel specialized analysis + summary assembly — Task 2.7 (Requirement 6)

Fans out four analyses with asyncio.gather, each wrapped so a single failure
becomes a warning instead of crashing the run:
  * OpenCV color/histogram delta vs the first listing image
  * CLIP visual similarity vs listing images
  * Rekognition label detection (defects w/ confidence + location)
  * Textract OCR (serials / labels / care tags)

Assembles one structured Analysis_Summary that mirrors the v1.43 intermediate shape
and merges in the fraud-preflight outcome.
"""
import time
import asyncio
import logging
from typing import List, Optional, Dict, Any

from app.config import settings
from app.services import opencv_utils
from app.services.clip_service import clip_service
from app.services.image_utils import try_fetch_image_bytes
from app.services.rekognition import rekognition_service, REKOGNITION_VERSION
from app.services.textract import textract_service

logger = logging.getLogger("ml-service.analysis")


async def _with_timeout(coro, timeout: float):
    return await asyncio.wait_for(coro, timeout=timeout)


async def _color_delta(photos: List[str], listing_images: List[str], trace=None) -> Dict[str, Any]:
    if not photos or not listing_images:
        return {"available": False, "reason": "no_reference"}
    sub = await try_fetch_image_bytes(photos[0], trace=trace, phase="analysis", label="evidence (OpenCV)")
    ref = await try_fetch_image_bytes(listing_images[0], trace=trace, phase="analysis", label="listing ref (OpenCV)")
    if sub is None or ref is None:
        return {"available": False, "reason": "fetch_failed"}
    delta = await asyncio.to_thread(opencv_utils.compute_color_histogram_delta, sub, ref)
    return {"available": True, "color_histogram_delta": delta}


async def _clip_similarity(photos: List[str], listing_images: List[str]) -> Dict[str, Any]:
    if not photos:
        return {"available": False, "reason": "no_photos"}
    result = await clip_service.visual_similarity(photos[0], listing_images)
    return result


async def _rekognition_labels(photos: List[str], trace=None) -> Dict[str, Any]:
    defects: List[Dict[str, Any]] = []
    all_labels: List[Dict[str, Any]] = []
    for idx, url in enumerate(photos):
        img = await try_fetch_image_bytes(url, trace=trace, phase="analysis", label=f"evidence #{idx + 1} (Rekognition)")
        if img is None:
            continue
        labels = await rekognition_service.detect_labels_bytes(img)
        for l in labels:
            conf = l.get("Confidence", 0.0)
            entry = {"label": l.get("Name"), "confidence": conf}
            instances = l.get("Instances", [])
            if instances:
                entry["location"] = instances[0].get("BoundingBox")
            all_labels.append(entry)
            # Defect labels recorded when confidence >= 50 (Req 6.2).
            if conf >= 50.0:
                defects.append(entry)
    return {"available": True, "labels": all_labels, "defect_candidates": defects}


async def _textract_ocr(photos: List[str], trace=None) -> Dict[str, Any]:
    texts: List[str] = []
    for idx, url in enumerate(photos):
        img = await try_fetch_image_bytes(url, trace=trace, phase="analysis", label=f"evidence #{idx + 1} (Textract)")
        if img is None:
            continue
        lines = await textract_service.extract_text_bytes(img)
        texts.extend(lines)
    return {"available": True, "extracted_text": texts}


def _trace_analysis_result(trace, name: str, result: Dict[str, Any]) -> None:
    """Emit a per-analysis developer-log step summarizing the outcome."""
    if trace is None:
        return
    available = result.get("available", False)
    if name == "opencv_color":
        if available:
            trace.success("analysis", "ANALYSIS_OPENCV",
                          f"🎨 OpenCV colour/histogram delta vs listing: {result.get('color_histogram_delta')}",
                          **result)
        else:
            trace.warn("analysis", "ANALYSIS_OPENCV",
                       f"🎨 OpenCV colour comparison skipped ({result.get('reason', 'unavailable')})", **result)
    elif name == "clip_similarity":
        sim = result.get("max") if result.get("max") is not None else result.get("similarity")
        if available:
            trace.success("analysis", "ANALYSIS_CLIP",
                          f"🧠 CLIP visual similarity to listing: "
                          f"{(sim * 100):.1f}% (compared {result.get('compared', 0)} ref image(s))"
                          if sim is not None else "🧠 CLIP similarity computed", **result)
        else:
            trace.warn("analysis", "ANALYSIS_CLIP",
                       f"🧠 CLIP similarity skipped/unavailable ({result.get('reason', 'model or image unavailable')})",
                       **result)
    elif name == "rekognition":
        if available:
            labels = result.get("labels", [])
            defects = result.get("defect_candidates", [])
            top = ", ".join(f"{l.get('label')}({round(l.get('confidence', 0))}%)" for l in labels[:5]) or "none"
            trace.success("analysis", "ANALYSIS_REKOGNITION",
                          f"🏷️ Rekognition: {len(labels)} label(s), {len(defects)} defect candidate(s). Top: {top}",
                          label_count=len(labels), defect_count=len(defects),
                          defect_candidates=defects[:10])
        else:
            trace.warn("analysis", "ANALYSIS_REKOGNITION",
                       f"🏷️ Rekognition unavailable ({result.get('error', 'no result')})", **result)
    elif name == "textract":
        if available:
            texts = result.get("extracted_text", [])
            sample = " | ".join(texts[:3])[:80]
            trace.success("analysis", "ANALYSIS_TEXTRACT",
                          f"🔤 Textract OCR: {len(texts)} line(s)" + (f" — \"{sample}\"" if texts else ""),
                          line_count=len(texts), sample=texts[:10])
        else:
            trace.warn("analysis", "ANALYSIS_TEXTRACT",
                       f"🔤 Textract unavailable ({result.get('error', 'no result')})", **result)


async def run_analysis(
    photos: List[str],
    listing_images: Optional[List[str]] = None,
    fraud_outcome: Optional[Dict[str, Any]] = None,
    category: Optional[str] = None,
    reason: Optional[str] = None,
    field_images: Optional[Dict[str, List[str]]] = None,
    trace=None,
) -> Dict[str, Any]:
    """
    Run all specialized analyses concurrently and assemble the Analysis_Summary.
    Each task is independently guarded; a failure is recorded as a warning (Req 6.5/6.6).
    """
    listing_images = listing_images or []
    field_images = field_images or {}
    timeout = settings.analysis_timeout_seconds

    if trace is not None:
        trace.info("analysis", "ANALYSIS_FANOUT",
                   f"🔬 Fanning out 4 parallel analyses (OpenCV, CLIP, Rekognition, Textract) "
                   f"over {len(photos)} evidence + {len(listing_images)} reference photo(s)",
                   photo_count=len(photos), reference_count=len(listing_images))

    started = time.perf_counter()
    tasks = {
        "opencv_color": _with_timeout(_color_delta(photos, listing_images, trace), timeout),
        "clip_similarity": _with_timeout(_clip_similarity(photos, listing_images), timeout),
        "rekognition": _with_timeout(_rekognition_labels(photos, trace), timeout),
        "textract": _with_timeout(_textract_ocr(photos, trace), timeout),
    }

    results = await asyncio.gather(*tasks.values(), return_exceptions=True)

    summary: Dict[str, Any] = {
        "category": category,
        "reason": reason,
        "photo_count": len(photos),
        "warnings": [],
        "analyses": {},
    }

    # v3.44 — record which uploaded photo answers which named form field, so Pass 2
    # can speak in field terms ("sole_photo shows heavy wear") rather than "image 3"
    # (improvement #3). Build a reverse url→field index too for label attribution.
    if field_images:
        summary["field_images"] = field_images
        url_to_field = {}
        for field_id, urls in field_images.items():
            for u in (urls or []):
                url_to_field.setdefault(u, field_id)
        summary["evidence_fields"] = sorted(field_images.keys())
        if trace is not None:
            mapped = sum(len(v or []) for v in field_images.values())
            trace.info("analysis", "ANALYSIS_FIELD_MAP",
                       f"🗂️ Evidence mapped to {len(field_images)} named field(s) "
                       f"({mapped} photo(s)): {', '.join(sorted(field_images.keys()))}",
                       field_count=len(field_images), mapped_photo_count=mapped)

    for name, result in zip(tasks.keys(), results):
        if isinstance(result, Exception):
            logger.warning("Analysis '%s' failed: %s", name, result)
            summary["warnings"].append(f"{name}_failed")
            summary["analyses"][name] = {"available": False, "error": str(result)}
            if trace is not None:
                trace.error("analysis", f"ANALYSIS_{name.upper()}",
                            f"❌ {name} analysis crashed: {result}", exc=result)
        else:
            summary["analyses"][name] = result
            if isinstance(result, dict) and result.get("available") is False:
                summary["warnings"].append(f"{name}_unavailable")
            _trace_analysis_result(trace, name, result if isinstance(result, dict) else {})

    # Rekognition-specific degradation warning (Req 11.5/11.6).
    rek = summary["analyses"].get("rekognition", {})
    if not rek.get("available", False):
        if "rekognition_unavailable" not in summary["warnings"]:
            summary["warnings"].append("rekognition_unavailable")

    # Merge fraud preflight outcome.
    if fraud_outcome is not None:
        summary["fraud"] = fraud_outcome

    summary["rekognition_version"] = REKOGNITION_VERSION

    if trace is not None:
        elapsed = round((time.perf_counter() - started) * 1000, 1)
        warnings = summary["warnings"]
        if warnings:
            trace.warn("analysis", "ANALYSIS_COMPLETE",
                       f"🔬 Parallel analysis finished in {elapsed:.0f}ms with {len(warnings)} warning(s): "
                       f"{', '.join(warnings)}", duration_ms=elapsed, warnings=warnings)
        else:
            trace.success("analysis", "ANALYSIS_COMPLETE",
                          f"🔬 All 4 analyses completed cleanly in {elapsed:.0f}ms", duration_ms=elapsed)

    return summary
