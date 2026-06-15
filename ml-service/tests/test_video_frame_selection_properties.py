"""
Property-based tests for deterministic video frame selection (Task 4.3).

# Feature: dynamic-stepper-evidence-grading, Property 6: Frame selection bounds, quality, and diversity

Targets ``app.services.video_frame_selector.phash_diversify`` / ``select_frames`` —
the deterministic, non-LLM reduction of candidate video frames to a few good,
diverse, full-resolution frames (Requirements 9.1, 9.2, 9.3, 9.5).

Frames are real, small JPEG images synthesised with Pillow (always a dependency)
from hypothesis-drawn parameters, so the actual ``imagehash`` perceptual hashing
(``fraud_preflight._phash_of_bytes``) and the ``opencv_utils`` blur/exposure scoring
run exactly as in production. The image generators deliberately mix:
  * "good" frames — high-contrast 4x4-block grayscale patterns that pass the blur
    and exposure thresholds; distinct ``pattern`` ids are perceptually far apart
    (phash distance well above the duplicate threshold) while a repeated ``pattern``
    id reproduces a byte-identical near-duplicate that diversification must drop;
  * "black"/"white" frames — solid fills that fail the exposure (and blur) thresholds
    and so must be discarded when low-quality dropping is on.

The properties asserted hold by construction of the algorithm regardless of the
particular inputs drawn, which is exactly what makes them good property tests.

Run: python -m pytest tests/test_video_frame_selection_properties.py -q
"""
import io
import os
import sys
from functools import lru_cache

from PIL import Image

import hypothesis.strategies as st
from hypothesis import given, settings, HealthCheck

# Make `app` importable when run from the ml-service dir.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services import video_frame_selector as vfs
from app.services.video_frame_selector import (
    phash_diversify,
    select_frames,
    _is_usable,
    PHASH_DUPLICATE_THRESHOLD,
    DEFAULT_MAX_FRAMES,
)
from app.services.fraud_preflight import _phash_of_bytes


# --------------------------------------------------------------------------- #
# Deterministic Pillow image synthesis (cached — hypothesis reuses many specs)
# --------------------------------------------------------------------------- #
_IMG_SIZE = 64


@lru_cache(maxsize=512)
def _make_good_frame(pattern: int) -> bytes:
    """A high-contrast 4x4-block grayscale JPEG that passes blur + exposure.

    Distinct ``pattern`` ids yield perceptually distinct images (phash distance
    comfortably above ``PHASH_DUPLICATE_THRESHOLD``); the same ``pattern`` id always
    yields byte-identical output (a near-duplicate to be dropped).
    """
    img = Image.new("RGB", (_IMG_SIZE, _IMG_SIZE))
    px = img.load()
    grid = 4
    cell = _IMG_SIZE // grid
    state = (pattern * 2654435761 + 12345) & 0xFFFFFFFF
    for r in range(grid):
        for c in range(grid):
            state = (1103515245 * state + 12345) & 0xFFFFFFFF
            v = 40 + (state >> 16) % 170  # mid-range 40..209 -> mean stays in [40, 220]
            for y in range(r * cell, (r + 1) * cell):
                for x in range(c * cell, (c + 1) * cell):
                    px[x, y] = (v, v, v)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


@lru_cache(maxsize=4)
def _make_solid_frame(value: int) -> bytes:
    """A solid-fill JPEG. value=0 (black) / 255 (white) fail blur + exposure."""
    img = Image.new("RGB", (_IMG_SIZE, _IMG_SIZE), (value, value, value))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def _frame_from_spec(spec) -> bytes:
    quality, pattern = spec
    if quality == "good":
        return _make_good_frame(pattern % 16)
    if quality == "black":
        return _make_solid_frame(0)
    return _make_solid_frame(255)  # "white"


# Each frame spec: a quality class + a pattern id (controls duplication/diversity).
_frame_spec = st.tuples(
    st.sampled_from(["good", "black", "white"]),
    st.integers(min_value=0, max_value=15),
)
_frame_specs = st.lists(_frame_spec, min_size=0, max_size=12)


# --------------------------------------------------------------------------- #
# Property 6: Frame selection bounds, quality, and diversity
# Validates: Requirements 9.1, 9.2, 9.3, 9.5
# --------------------------------------------------------------------------- #
@settings(max_examples=150, deadline=None,
          suppress_health_check=[HealthCheck.too_slow])
@given(
    specs=_frame_specs,
    max_frames=st.integers(min_value=-2, max_value=8),
    duplicate_threshold=st.integers(min_value=0, max_value=12),
    drop_low_quality=st.booleans(),
)
def test_frame_selection_bounds_quality_and_diversity(
    specs, max_frames, duplicate_threshold, drop_low_quality
):
    # Feature: dynamic-stepper-evidence-grading, Property 6: Frame selection bounds, quality, and diversity
    frames = [_frame_from_spec(s) for s in specs]

    selected = phash_diversify(
        frames,
        max_frames,
        duplicate_threshold=duplicate_threshold,
        drop_low_quality=drop_low_quality,
    )

    # --- Bound: size <= max_frames, and empty when max_frames <= 0 (Req 9.2) ---
    if max_frames <= 0:
        assert selected == []
    else:
        assert len(selected) <= max_frames

    # --- Full-resolution / identity preservation: every returned frame is one of
    # the original input frames, byte-for-byte (never re-encoded or downscaled),
    # so a detail_level=high frame is retained full-resolution (Req 9.5). ---
    for f in selected:
        assert any(f is orig or f == orig for orig in frames)

    # --- Diversity: no two selected frames are within the duplicate threshold of
    # each other by recomputed perceptual hash (Req 9.3). ---
    hashes = [_phash_of_bytes(f) for f in selected]
    assert all(h is not None for h in hashes)
    for i in range(len(hashes)):
        for j in range(i + 1, len(hashes)):
            assert (hashes[i] - hashes[j]) > duplicate_threshold

    # --- Quality: when low-quality dropping is on, no retained frame fails the
    # blur/exposure thresholds (Req 9.1) — asserted via the same scorer the
    # selector uses, so it holds whether or not cv2 blur scoring is available. ---
    if drop_low_quality:
        for f in selected:
            assert _is_usable(f)


# --------------------------------------------------------------------------- #
# Supporting deterministic checks (example/edge cases that anchor the property)
# --------------------------------------------------------------------------- #
def test_solid_frames_dropped_when_quality_on():
    """Black and white solid frames fail exposure/blur and are discarded."""
    frames = [_make_solid_frame(0), _make_solid_frame(255)]
    assert phash_diversify(frames, DEFAULT_MAX_FRAMES, drop_low_quality=True) == []


def test_byte_identical_duplicates_collapse_to_one():
    """Repeated identical frames collapse to a single retained frame."""
    f = _make_good_frame(3)
    selected = phash_diversify([f, f, f, f], DEFAULT_MAX_FRAMES,
                               duplicate_threshold=PHASH_DUPLICATE_THRESHOLD)
    assert len(selected) == 1
    assert selected[0] == f


def test_distinct_frames_capped_at_max():
    """A surplus of distinct, diverse frames is capped at max_frames."""
    frames = [_make_good_frame(p) for p in range(10)]
    selected = phash_diversify(frames, 4,
                               duplicate_threshold=PHASH_DUPLICATE_THRESHOLD)
    assert len(selected) <= 4
    # and the cap is actually reached given enough diverse input
    assert len(selected) == 4


def test_non_positive_max_returns_empty():
    frames = [_make_good_frame(p) for p in range(3)]
    assert phash_diversify(frames, 0) == []
    assert phash_diversify(frames, -3) == []


def test_select_frames_degrades_and_echoes_full_resolution():
    """Undecodable bytes degrade to an empty, full-resolution, LLM-free result."""
    out = select_frames(b"not-a-real-video", max_frames=DEFAULT_MAX_FRAMES,
                        detail_high=True)
    assert out["frames"] == []
    assert out["full_resolution"] is True
    assert out["detail_high"] is True
    assert out["liveness"]["llm_free"] is True


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-q"]))
