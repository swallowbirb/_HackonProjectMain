"""
Pre-flight fraud checks — v2.34 (trimmed)

Two cheap, deterministic signals a vision LLM is structurally blind to:
  1. imagehash  — perceptual hash of the submitted photo vs the catalog photo(s).
                  Hamming distance <= threshold => the user re-submitted OUR image
                  (stock-photo theft). HARD signal. Scoped per-angle by the caller
                  (compare the user's `front` against the seller's `front`).
  2. Pillow/EXIF — presence of camera metadata (make / model / timestamp).
                   Absent => weak/SOFT signal (phones/messaging apps strip EXIF, so
                   this never hard-blocks — it is informational only).

REMOVED in v2.34:
  * OpenCV / CLIP (moved into the Evidence Inspector LLM).
  * The "Rekognition web match" signal — it actually called detect_moderation_labels
    (NSFW detection) and mislabeled any hit as a web match. AWS Rekognition has no
    web/reverse-image API, so the capability never existed. Deleted.

Outcome classification:
  * HARD  -> short-circuit (skip grading).
  * SOFT  -> annotate, continue.
  * CLEAN -> no signal.

Every check is defensive: a failure is treated as "not detected" and logged.
"""
import io
import logging
from typing import List, Optional

from app.config import settings

logger = logging.getLogger("ml-service.fraud")

CLASSIFICATION_HARD = "HARD"
CLASSIFICATION_SOFT = "SOFT"
CLASSIFICATION_CLEAN = "CLEAN"

# EXIF tag ids for camera make / model / datetime.
_EXIF_MAKE = 271
_EXIF_MODEL = 272
_EXIF_DATETIME = 306


def _phash_of_bytes(image_bytes: bytes):
    try:
        import imagehash
        from PIL import Image
        img = Image.open(io.BytesIO(image_bytes))
        return imagehash.phash(img)
    except Exception as exc:  # noqa: BLE001
        logger.warning("phash computation failed: %s", exc)
        return None


async def compute_catalog_hashes(listing_image_urls: Optional[List[str]], trace=None) -> List[str]:
    """
    Perceptual-hash (hex strings) the catalog reference photos. These are what the
    submitted evidence photo is compared against. Hashing happens ML-side with the
    same ``imagehash`` library used for comparison so the hex strings are bit-compatible.

    Degrades gracefully: a reference that can't be fetched/hashed is skipped.
    """
    urls = listing_image_urls or []
    if not urls:
        return []

    from app.services.image_utils import try_fetch_image_bytes

    hashes: List[str] = []
    for idx, url in enumerate(urls):
        img_bytes = await try_fetch_image_bytes(
            url, trace=trace, phase="fraud", label=f"catalog ref #{idx + 1}")
        if img_bytes is None:
            continue
        h = _phash_of_bytes(img_bytes)
        if h is not None:
            hashes.append(str(h))
    return hashes


def phash_match(image_bytes: bytes, catalog_hashes: List[str]) -> bool:
    """
    True when the image's perceptual hash is within the Hamming threshold of any
    provided catalog hash. catalog_hashes are hex strings produced by imagehash.
    """
    if not catalog_hashes:
        return False
    sub = _phash_of_bytes(image_bytes)
    if sub is None:
        return False
    try:
        import imagehash
        for h in catalog_hashes:
            try:
                ref = imagehash.hex_to_hash(h)
            except Exception:  # noqa: BLE001
                continue
            if (sub - ref) <= settings.phash_hamming_threshold:
                return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("phash comparison failed: %s", exc)
    return False


def exif_has_camera_data(image_bytes: bytes) -> bool:
    """True when EXIF camera make/model/timestamp metadata is present."""
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(image_bytes))
        exif = img.getexif()
        if not exif:
            return False
        return any(exif.get(tag) for tag in (_EXIF_MAKE, _EXIF_MODEL, _EXIF_DATETIME))
    except Exception as exc:  # noqa: BLE001
        logger.warning("EXIF read failed: %s", exc)
        return False


def preflight_bytes(image_bytes: bytes, catalog_hashes: Optional[List[str]] = None) -> dict:
    """
    Run the two file-level checks on already-fetched bytes (used by the Evidence
    Inspector at upload time). Returns the per-photo preflight signals + classification.
    """
    catalog_hashes = list(catalog_hashes or [])
    any_phash = phash_match(image_bytes, catalog_hashes)
    any_exif = exif_has_camera_data(image_bytes)
    classification, triggering = classify(any_phash, any_exif)
    return {
        "phash_match": any_phash,
        "exif_has_camera_data": any_exif,
        "classification": classification,
        "triggering_signal": triggering,
    }


def classify(any_phash_match: bool, any_exif_camera: bool, *_ignored):
    """
    Pure classification of fraud signals (testable without AWS / image fetches).
    Returns (classification, triggering_signal). Extra positional args are ignored
    for backward compatibility with the old 3-arg signature.
    """
    if any_phash_match:
        return CLASSIFICATION_HARD, "phash_match_catalog"
    if not any_exif_camera:
        return CLASSIFICATION_SOFT, "missing_exif"
    return CLASSIFICATION_CLEAN, None


async def run_preflight(image_urls: List[str], catalog_hashes: Optional[List[str]] = None,
                        listing_image_urls: Optional[List[str]] = None,
                        trace=None) -> dict:
    """
    Run both pre-flight checks across the submitted photos (submit-time / legacy path).
    The per-upload path uses ``preflight_bytes`` on already-fetched bytes instead.

    Returns:
      { phash_match, exif_has_camera_data, classification, triggering_signal, notes[] }
    """
    catalog_hashes = list(catalog_hashes or [])
    listing_image_urls = listing_image_urls or []
    notes: List[str] = []

    from app.services.image_utils import try_fetch_image_bytes

    if trace is not None:
        trace.info("fraud", "FRAUD_PREFLIGHT",
                   f"🛡️ Fraud preflight: checking {len(image_urls or [])} photo(s) "
                   f"against {len(catalog_hashes) + len(listing_image_urls)} catalog reference(s) "
                   "(perceptual-hash duplicate check + EXIF camera data)")

    if listing_image_urls:
        computed = await compute_catalog_hashes(listing_image_urls, trace=trace)
        catalog_hashes = catalog_hashes + computed
        if len(computed) < len(listing_image_urls):
            notes.append(
                f"hashed {len(computed)}/{len(listing_image_urls)} catalog reference photo(s)")

    any_phash_match = False
    any_exif_camera = False
    fetched = 0

    for idx, url in enumerate(image_urls or []):
        img_bytes = await try_fetch_image_bytes(
            url, trace=trace, phase="fraud", label=f"fraud photo #{idx + 1}")
        if img_bytes is None:
            notes.append(f"could not fetch {url} for fraud preflight")
            continue
        fetched += 1
        if phash_match(img_bytes, catalog_hashes):
            any_phash_match = True
        if exif_has_camera_data(img_bytes):
            any_exif_camera = True

    classification, triggering = classify(any_phash_match, any_exif_camera)

    if trace is not None:
        level = "error" if classification == CLASSIFICATION_HARD else (
            "warn" if classification == CLASSIFICATION_SOFT else "success")
        if classification == CLASSIFICATION_CLEAN:
            msg = f"✅ Fraud preflight CLEAN — no signals across {fetched} photo(s)"
        else:
            msg = (f"⚠️ Fraud preflight {classification} — triggering signal: {triggering}"
                   + (" (HARD signal short-circuits grading)"
                      if classification == CLASSIFICATION_HARD else ""))
        trace.add("fraud", "FRAUD_RESULT", msg, level=level,
                  classification=classification, triggering_signal=triggering,
                  phash_match=any_phash_match, exif_has_camera_data=any_exif_camera,
                  photos_fetched=fetched, notes=notes or None)

    return {
        "phash_match": any_phash_match,
        "exif_has_camera_data": any_exif_camera,
        "classification": classification,
        "triggering_signal": triggering,
        "notes": notes,
    }
