"""
Video frame selection + liveness — dynamic-stepper-evidence-grading (task 4.1)

Deterministic, **non-LLM** reduction of an uploaded video to a few good, diverse
frames before any Grading_LLM call, plus cheap liveness/anti-fraud signals. This
keeps video support costing no more LLM budget than photos (Req 9) while still
capturing all angles, and proves a real continuous capture without LLM cost
(Req 11).

Pipeline (all CPU-only, no network, no LLM):

    select_frames(video_bytes, max_frames, detail_high)
        ├─ extract_frames(video_bytes, fps)        # cv2.VideoCapture sampling
        ├─ phash_continuity(frames)                # liveness / discontinuity flag
        └─ phash_diversify(usable, max_frames)     # quality + diversity + cap

Reuse (single source of truth):
  * Blur / brightness scoring → ``opencv_utils.compute_blur_score`` /
    ``compute_brightness_score`` with the same ``settings.blur_min`` /
    ``brightness_min`` / ``brightness_max`` thresholds the photo-quality pass uses.
  * Perceptual hashing → ``fraud_preflight._phash_of_bytes`` (the same
    ``imagehash.phash`` the catalog stock-photo-theft check uses), so the hashes are
    bit-compatible and the catalog theft check (task 4.2, ``catalog_theft_check``)
    runs directly against the frames this module returns.
  * Catalog stock-photo-theft → ``fraud_preflight.phash_match`` /
    ``fraud_preflight.classify`` (task 4.2), so a matching frame raises the exact same
    HARD signal the photo Inspector raises — no new signal type is invented.

Requirements: 9.1, 9.2, 9.3, 9.5, 11.1, 11.3, 11.4.

Dependency note: ``cv2`` (``opencv-python-headless``) is NOT currently pinned in
``ml-service/requirements.txt`` (it was removed in v2.34). Server-side frame
extraction therefore degrades gracefully — ``extract_frames`` returns ``[]`` when
cv2 is unavailable, and the client-side ``<canvas>`` extraction path (frontend
task 12.3) remains the prototype default. To enable server-side extraction, add
``opencv-python-headless`` back to requirements.

Frames are represented as JPEG-encoded ``bytes`` throughout, so they flow straight
into the existing S3-upload + ``evidence_inspector.inspect_field`` path and the
``fraud_preflight`` phash helpers without re-encoding. Frames are kept at native
resolution (never downscaled here) so ``detail_level=high`` aspects stay
full-resolution and are never montaged (Req 9.5).
"""
import logging
import os
import tempfile
from typing import List, Optional

from app.config import settings
from app.services import opencv_utils, fraud_preflight
from app.services.fraud_preflight import _phash_of_bytes

logger = logging.getLogger("ml-service.video_frame_selector")

# --- Tunable, deterministic thresholds (no LLM, no network) -----------------------
# Sampling rate when decoding the video: ~1.5 frames/sec captures distinct angles of
# a hand-held pan without flooding the selector with near-identical frames.
DEFAULT_FPS = 1.5

# Hard cap on selected frames per field so a long video still costs ~photo budget
# downstream (Req 9.2). Overridable per call via ``max_frames``.
DEFAULT_MAX_FRAMES = 6

# Two frames whose perceptual-hash Hamming distance is <= this are treated as
# near-duplicates and only the first is kept (Req 9.3). Smaller than the catalog
# stock-photo-theft threshold (``settings.phash_hamming_threshold``) because here we
# want genuine angle diversity, not just "different image".
PHASH_DUPLICATE_THRESHOLD = 8

# Consecutive-frame perceptual-hash Hamming distance >= this is a "hard
# discontinuity" — a cut/splice rather than a continuous pan — and flags the clip
# (Req 11.3). phash distance maxes at 64; ~30 is a large, structural jump.
PHASH_DISCONTINUITY_THRESHOLD = 30


def _import_cv2():
    """Lazy, optional cv2 import (mirrors ``opencv_utils``).

    Returns the module or ``None`` so callers can degrade gracefully rather than
    crash when ``opencv-python-headless`` is not installed.
    """
    try:
        import cv2  # noqa: PLC0415 — intentional lazy/optional import
        return cv2
    except ImportError:
        logger.warning(
            "cv2 (opencv-python-headless) not installed — server-side video frame "
            "extraction unavailable; relying on client-extracted frames.")
        return None


def extract_frames(video_bytes: bytes, fps: float = DEFAULT_FPS) -> List[bytes]:
    """Decode ``video_bytes`` and return JPEG-encoded candidate frames sampled at ``fps``.

    Uses ``cv2.VideoCapture`` over a temp file (OpenCV cannot decode a raw byte
    buffer directly). Degrades to ``[]`` on any failure (cv2 missing, undecodable
    codec, open failure) so the caller can fall back to client-extracted frames and
    proceed — never blocking the user (design Error Handling: video codec/decode).

    Deterministic: the same bytes always yield the same frames.
    """
    if not video_bytes:
        return []

    cv2 = _import_cv2()
    if cv2 is None:
        return []

    tmp_path: Optional[str] = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            tmp.write(video_bytes)
            tmp_path = tmp.name

        cap = cv2.VideoCapture(tmp_path)
        if not cap.isOpened():
            logger.warning("cv2.VideoCapture could not open the uploaded video")
            return []

        video_fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        if video_fps <= 0.0:
            video_fps = 30.0  # safe assumption for malformed/missing fps metadata

        # Sample one frame every ``interval`` decoded frames to approximate ``fps``.
        interval = max(1, int(round(video_fps / float(fps)))) if fps and fps > 0 else 1

        frames: List[bytes] = []
        idx = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if idx % interval == 0:
                encoded, buf = cv2.imencode(".jpg", frame)
                if encoded:
                    frames.append(buf.tobytes())
            idx += 1
        cap.release()
        return frames
    except Exception as exc:  # noqa: BLE001 — degrade, never block
        logger.warning("video frame extraction failed: %s", exc)
        return []
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def _is_usable(frame_bytes: bytes) -> bool:
    """True when a frame passes the blur + exposure thresholds (Req 9.1, 9.3).

    Reuses ``opencv_utils`` scoring and the same ``settings`` thresholds as the
    photo-quality pass. If a score cannot be computed (e.g. cv2 unavailable for the
    blur Laplacian), that signal is treated as "not failed" so we degrade rather
    than discard everything.
    """
    try:
        blur = opencv_utils.compute_blur_score(frame_bytes)
        if blur < settings.blur_min:
            return False
    except Exception as exc:  # noqa: BLE001
        logger.debug("blur scoring unavailable for a frame: %s", exc)

    try:
        brightness = opencv_utils.compute_brightness_score(frame_bytes)
        if brightness < settings.brightness_min or brightness > settings.brightness_max:
            return False
    except Exception as exc:  # noqa: BLE001
        logger.debug("brightness scoring unavailable for a frame: %s", exc)

    return True


def phash_diversify(
    frames: List[bytes],
    max_n: int,
    *,
    duplicate_threshold: int = PHASH_DUPLICATE_THRESHOLD,
    drop_low_quality: bool = True,
) -> List[bytes]:
    """Select up to ``max_n`` good, perceptually-diverse frames (Req 9.1–9.3).

    Greedy, order-preserving pass:
      1. Discard blurred / poorly-exposed frames (``drop_low_quality``).
      2. Discard frames whose perceptual hash is within ``duplicate_threshold`` of an
         already-selected frame (near-duplicate of a kept angle).
      3. Cap the result at ``max_n``.

    Pure and deterministic for a given frame list. Frames are never downscaled, so a
    frame answering a ``detail_level=high`` aspect is retained full-resolution
    (Req 9.5). A frame whose hash cannot be computed is skipped, since diversity
    cannot be guaranteed for it.
    """
    if max_n is not None and max_n <= 0:
        return []

    selected: List[bytes] = []
    selected_hashes = []  # parallel list of imagehash.ImageHash for kept frames

    for frame in frames or []:
        if drop_low_quality and not _is_usable(frame):
            continue

        h = _phash_of_bytes(frame)
        if h is None:
            continue

        if any((h - kept) <= duplicate_threshold for kept in selected_hashes):
            continue

        selected.append(frame)
        selected_hashes.append(h)
        if max_n is not None and len(selected) >= max_n:
            break

    return selected


def phash_continuity(
    frames: List[bytes],
    *,
    discontinuity_threshold: int = PHASH_DISCONTINUITY_THRESHOLD,
) -> dict:
    """Deterministic, LLM-free liveness classification from frame-to-frame phash drift.

    Computes the perceptual-hash Hamming distance between each pair of consecutive
    frames as a cheap signal of a single continuous capture (Req 11.1). A pair whose
    distance is >= ``discontinuity_threshold`` is a "hard discontinuity" (a cut or
    splice), which flags the clip (Req 11.3). No Grading_LLM is invoked (Req 11.4),
    and the same frame sequence always yields the same classification.

    Returns a JSON-serialisable dict:
        {
          frame_count, comparisons, distances, max_distance, mean_distance,
          continuous, hard_discontinuity, discontinuity_indices, llm_free
        }
    ``discontinuity_indices`` are the indices ``i`` where the jump from frame
    ``i-1`` to frame ``i`` exceeded the threshold.
    """
    frames = frames or []
    hashes = [_phash_of_bytes(f) for f in frames]

    distances: List[int] = []
    discontinuity_indices: List[int] = []
    for i in range(1, len(hashes)):
        prev_h, cur_h = hashes[i - 1], hashes[i]
        if prev_h is None or cur_h is None:
            continue
        dist = int(prev_h - cur_h)
        distances.append(dist)
        if dist >= discontinuity_threshold:
            discontinuity_indices.append(i)

    max_distance = max(distances) if distances else 0
    mean_distance = round(sum(distances) / len(distances), 2) if distances else 0.0
    hard_discontinuity = len(discontinuity_indices) > 0

    return {
        "frame_count": len(frames),
        "comparisons": len(distances),
        "distances": distances,
        "max_distance": max_distance,
        "mean_distance": mean_distance,
        "continuous": not hard_discontinuity,
        "hard_discontinuity": hard_discontinuity,
        "discontinuity_indices": discontinuity_indices,
        "llm_free": True,
    }


def catalog_theft_check(
    frames: List[bytes],
    catalog_hashes: Optional[List[str]],
) -> dict:
    """Reuse the catalog stock-photo-theft phash check on selected video frames (Req 11.2).

    Runs the SAME catalog perceptual-hash comparison the photo Inspector uses —
    ``fraud_preflight.phash_match(frame, catalog_hashes)``, scoped by
    ``settings.phash_hamming_threshold`` — over each selected frame. ``catalog_hashes``
    are the hex strings produced by ``fraud_preflight.compute_catalog_hashes`` from the
    listing/reference images, exactly as the photo path supplies them.

    If ANY frame matches a catalog/reference image within the threshold, the user has
    re-submitted OUR image inside a video rather than filming the real item, so the
    existing stock-photo-theft **HARD** signal is raised — identical in shape to the
    photo path (``classification='HARD'``, ``triggering_signal='phash_match_catalog'``).
    The signal name/shape comes from the single source of truth
    (``fraud_preflight.classify``); this never invents a new signal type.

    Deterministic and LLM-free. Degrades to a CLEAN signal when no catalog hashes are
    supplied or a frame's hash cannot be computed. Returns a JSON-serialisable dict::

        {phash_match, classification, triggering_signal, matched_frame_index, frames_checked}

    ``matched_frame_index`` is the index of the first frame that matched a catalog
    image (``None`` when clean).
    """
    catalog_hashes = list(catalog_hashes or [])
    frames = frames or []

    matched_index: Optional[int] = None
    if catalog_hashes:
        for idx, frame in enumerate(frames):
            try:
                if fraud_preflight.phash_match(frame, catalog_hashes):
                    matched_index = idx
                    break
            except Exception as exc:  # noqa: BLE001 — degrade, never block
                logger.warning("catalog phash check failed for frame %d: %s", idx, exc)

    any_match = matched_index is not None
    # Reuse the single-source-of-truth classifier so the raised signal name/shape
    # exactly matches the photo path. Pass any_exif_camera=True so a re-encoded video
    # frame (which never carries camera EXIF) does not raise a spurious SOFT
    # missing-exif signal — Req 11.2 scopes this to the HARD catalog-theft signal only.
    classification, triggering = fraud_preflight.classify(any_match, True)

    return {
        "phash_match": any_match,
        "classification": classification,
        "triggering_signal": triggering,
        "matched_frame_index": matched_index,
        "frames_checked": len(frames),
    }


def select_frames(
    video_bytes: bytes,
    *,
    max_frames: int = DEFAULT_MAX_FRAMES,
    detail_high: bool = False,
    catalog_hashes: Optional[List[str]] = None,
) -> dict:
    """Orchestrate extraction → liveness → diverse selection for one video field.

    Returns ``{"frames": [<jpeg bytes>...], "liveness": {...}, ...}``:
      * ``frames``    — the selected, diverse, quality-passing frames (Req 9.1–9.3),
                        capped at ``max_frames`` (Req 9.2), kept at native resolution
                        (Req 9.5).
      * ``liveness``  — the deterministic ``phash_continuity`` classification over
                        ALL extracted candidate frames (Req 11.1, 11.3).
      * ``theft``     — the catalog stock-photo-theft signal from
                        ``catalog_theft_check`` over the SELECTED frames (Req 11.2);
                        ``classification='HARD'`` with ``triggering_signal=
                        'phash_match_catalog'`` when a frame matches a catalog image.
                        A no-op CLEAN signal when ``catalog_hashes`` is omitted.
      * ``detail_high`` / ``full_resolution`` — echo so the montage path (task 5.1)
                        excludes ``detail_level=high`` frames from any low-res montage
                        and inspects them full-resolution (Req 9.5).

    ``catalog_hashes`` are the hex perceptual hashes of the listing/reference images
    (as produced by ``fraud_preflight.compute_catalog_hashes``); pass them to enable
    the catalog stock-photo-theft check (Req 11.2). When omitted, the theft check is a
    no-op CLEAN signal.

    No Grading_LLM is ever invoked. Degrades to an empty frame set (with the caller
    free to fall back to photo capture) when the video cannot be decoded.
    """
    frames = extract_frames(video_bytes, fps=DEFAULT_FPS)
    liveness = phash_continuity(frames)
    selected = phash_diversify(frames, max_frames)
    theft = catalog_theft_check(selected, catalog_hashes)

    return {
        "frames": selected,
        "liveness": liveness,
        "theft": theft,
        "detail_high": bool(detail_high),
        "full_resolution": True,
        "candidate_count": len(frames),
        "selected_count": len(selected),
    }
