"""
Property-based & unit tests for the dependency-free grading logic (Task 2.13).

These exercise the correctness properties from the spec without requiring AWS,
torch, or fastapi to be installed. Run with: python -m pytest ml-service/tests
(or the bundled fallback runner: python tests/test_grading_properties.py).

Maps to spec correctness properties:
  P1/P2 — Grade schema validity + domain (enums + bounds)
  P3    — Low-confidence / missing-evidence => flagged (modeled here as confidence rule)
  P4    — Hard fraud short-circuits
  P5    — Pass-1 cache determinism
  P6    — Form schema round-trip (JSON extraction)
  P8    — Partial-failure resilience (Rekognition unavailable -> missingEvidence)
"""
import os
import sys
import json
import random
import string

# Make `app` importable.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.grade_validation import (
    coerce_and_validate, GradeValidationError, GRADES, CONFIDENCE, ROUTING,
)
from app.services.json_utils import extract_json, JSONExtractionError
from app.services.ttl_cache import cache_key, normalize_reason, TTLCache
from app.services import fraud_preflight


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _rand_str(n=8):
    return "".join(random.choice(string.ascii_letters + " ") for _ in range(n))


def _random_raw_grade():
    return {
        "grade": random.choice(["A", "B", "C", "D", "a", "z", "", None]),
        "qualityScore": random.choice([random.randint(-50, 200), "80", None, 73.6]),
        "confidence": random.choice(["high", "medium", "low", "HIGH", "bogus", None]),
        "routingHint": random.choice(["resell", "donate", "??", None]),
        "estimatedResalePct": random.choice([random.uniform(-1, 2), "0.5", None]),
        "missingEvidence": random.choice([[], ["serial"], ["a", "b"]]),
        "defects": [{"type": "scuff", "severity": random.choice(["minor", "x"])}],
        "returnClaimVerified": random.choice([True, False, "yes"]),
        "rationale": random.choice(["", "looks worn"]),
    }


# --------------------------------------------------------------------------- #
# P1 / P2 — Grade domain invariants
# --------------------------------------------------------------------------- #
def test_grade_domain_invariants():
    for _ in range(500):
        raw = _random_raw_grade()
        try:
            g = coerce_and_validate(raw, {})
        except GradeValidationError:
            # Only acceptable when the grade enum was unrecoverable.
            assert str(raw.get("grade", "")).strip().upper() not in GRADES
            continue
        assert g["grade"] in GRADES
        assert g["confidence"] in CONFIDENCE
        assert g["routingHint"] in ROUTING
        assert 0 <= g["qualityScore"] <= 100
        assert 0.0 <= g["estimatedResalePct"] <= 1.0
        for d in g["defects"]:
            assert d["severity"] in {"minor", "moderate", "major"}
        assert isinstance(g["rationale"], str) and g["rationale"]


# --------------------------------------------------------------------------- #
# P3 — missing evidence / low confidence never reports high
# --------------------------------------------------------------------------- #
def test_missing_evidence_never_high_confidence():
    for _ in range(200):
        raw = _random_raw_grade()
        raw["grade"] = "B"
        raw["confidence"] = "high"
        raw["missingEvidence"] = ["serial_number"]
        g = coerce_and_validate(raw, {})
        assert g["confidence"] != "high"


def test_rekognition_unavailable_downgrades_and_adds_missing():
    raw = {"grade": "A", "confidence": "high", "routingHint": "resell",
           "qualityScore": 90, "estimatedResalePct": 0.9, "rationale": "clean"}
    g = coerce_and_validate(raw, {"warnings": ["rekognition_unavailable"]})
    assert "defect_detection" in g["missingEvidence"]
    assert g["confidence"] != "high"


# --------------------------------------------------------------------------- #
# P4 — Hard fraud short-circuit classification
# --------------------------------------------------------------------------- #
def test_hard_fraud_classification():
    # phash match always => HARD regardless of other signals.
    for exif in (True, False):
        for web in (True, False):
            cls, sig = fraud_preflight.classify(True, exif, web)
            assert cls == fraud_preflight.CLASSIFICATION_HARD
            assert sig == "phash_match_catalog"


def test_soft_and_clean_fraud_classification():
    # No phash, has exif => CLEAN.
    cls, sig = fraud_preflight.classify(False, True)
    assert cls == fraud_preflight.CLASSIFICATION_CLEAN
    # No phash, missing exif => SOFT.
    cls, sig = fraud_preflight.classify(False, False)
    assert cls == fraud_preflight.CLASSIFICATION_SOFT
    assert sig == "missing_exif"


# --------------------------------------------------------------------------- #
# P5 — Pass-1 cache determinism
# --------------------------------------------------------------------------- #
def test_cache_key_determinism():
    for _ in range(200):
        pid = _rand_str(10)
        reason = _rand_str(20)
        # Same product + reason with cosmetic whitespace/case changes => same key.
        variant = f"  {reason.upper()}   "
        assert cache_key(pid, reason) == cache_key(pid, variant)
        # Different product => different key (overwhelmingly likely).
        assert cache_key(pid + "x", reason) != cache_key(pid, reason)


def test_normalize_reason():
    assert normalize_reason("  Hello   World ") == "hello world"
    assert normalize_reason("ALL\tCAPS\nHERE") == "all caps here"


# --------------------------------------------------------------------------- #
# v3.44 — cache key category fallback + punctuation normalization
# --------------------------------------------------------------------------- #
def test_cache_key_category_fallback_when_no_product():
    # No productId => key derived from category + reason, and is stable.
    k1 = cache_key(None, "too tight", category="footwear")
    k2 = cache_key(None, "too tight", category="footwear")
    assert k1 == k2
    # Different category => different key.
    assert cache_key(None, "too tight", category="apparel") != k1
    # productId path differs from category path for the same reason.
    assert cache_key("prod123", "too tight", category="footwear") != k1


def test_normalize_reason_strips_punctuation():
    # "Too tight!" and "too tight" must collide (improvement #8).
    assert normalize_reason("Too tight!") == normalize_reason("too tight")
    assert normalize_reason("too-tight") == "too tight"
    assert cache_key("p", "Too tight!") == cache_key("p", "too tight")


# --------------------------------------------------------------------------- #
# v3.44 — Form schema normalization (field clamp + expected_subject backfill)
# --------------------------------------------------------------------------- #
def test_form_schema_normalization_clamps_and_backfills():
    from app.services.form_generator import _normalize_schema, MAX_PHOTO_FIELDS, SCHEMA_VERSION

    fields = [{"id": f"p{i}", "type": "photo", "label": f"Photo {i}"} for i in range(MAX_PHOTO_FIELDS + 5)]
    fields.append({"id": "notes", "type": "text", "label": "Notes"})
    schema = _normalize_schema({"title": "t", "fields": fields}, "footwear")

    photo_fields = [f for f in schema["fields"] if f["type"] == "photo"]
    text_fields = [f for f in schema["fields"] if f["type"] == "text"]
    # Photo fields clamped; non-photo fields preserved.
    assert len(photo_fields) == MAX_PHOTO_FIELDS
    assert len(text_fields) == 1
    # expected_subject backfilled for every photo field.
    assert all(f.get("expected_subject") for f in photo_fields)
    assert schema["schemaVersion"] == SCHEMA_VERSION


def test_generic_default_schema_has_expected_subjects():
    from app.services.form_generator import generic_default_schema
    schema = generic_default_schema("footwear")
    photo_fields = [f for f in schema["fields"] if f["type"] == "photo"]
    assert photo_fields
    assert all(f.get("expected_subject") for f in photo_fields)
    assert schema["schemaVersion"] >= 1


def test_ttl_cache_hit_and_miss():
    c = TTLCache(ttl_seconds=3600)
    c.set("k", {"a": 1})
    assert c.get("k") == {"a": 1}
    assert c.get("missing") is None
    # Expired entry behaves as miss.
    c2 = TTLCache(ttl_seconds=-1)
    c2.set("k", {"a": 1})
    assert c2.get("k") is None


# --------------------------------------------------------------------------- #
# P6 — JSON extraction / form-schema round-trip
# --------------------------------------------------------------------------- #
def test_json_extraction_strips_prose_and_fences():
    obj = {"title": "t", "fields": [{"id": "x", "type": "photo"}]}
    raw = json.dumps(obj)
    assert extract_json(raw) == obj
    assert extract_json(f"Here is your form:\n```json\n{raw}\n```\nThanks!") == obj
    assert extract_json(f"Sure! {raw} (done)") == obj


def test_json_extraction_roundtrip():
    for _ in range(100):
        obj = {"title": _rand_str(6), "fields": [{"id": _rand_str(4), "type": "text"}]}
        once = extract_json(json.dumps(obj))
        twice = extract_json(json.dumps(once))
        assert once == twice == obj


def test_json_extraction_errors():
    for bad in ["", "   ", "no json here", "{ unbalanced"]:
        try:
            extract_json(bad)
            assert False, f"expected error for {bad!r}"
        except JSONExtractionError:
            pass


# --------------------------------------------------------------------------- #
# Minimal fallback runner (when pytest is unavailable)
# --------------------------------------------------------------------------- #
# --------------------------------------------------------------------------- #
# v2.34 — Evidence Inspector normalization + fragment-based Pass-2 summary
# --------------------------------------------------------------------------- #
def test_inspector_normalize_strips_grading_fields_and_enforces_invariants():
    from app.services.evidence_inspector import _normalize

    # Even if a model hallucinates a grade/severity, the inspector shape never carries it.
    raw = {
        "accepted": True, "reupload_reason": "ignored when accepted",
        "clarity": "BOGUS", "subject_match": "yes", "identity_match": "maybe",
        "observations": ["scuff", None, 3], "ocr_text": "  ",
        "condition_signals": ["light wear"], "grade": "A", "severity": "major",
    }
    r = _normalize(raw)
    assert "grade" not in r and "severity" not in r          # inspector never grades
    assert r["clarity"] == "clear"                            # invalid enum -> clear
    assert r["identity_match"] == "unknown"                   # invalid enum -> unknown
    assert r["reupload_reason"] is None                       # null when accepted
    assert r["observations"] == ["scuff", "3"]                # cleaned list
    assert r["ocr_text"] is None                              # blank -> None
    assert r["inspector_status"] == "ok"


def test_inspector_rejected_always_has_reason():
    from app.services.evidence_inspector import _normalize
    r = _normalize({"accepted": False, "reupload_reason": None})
    assert r["accepted"] is False
    assert isinstance(r["reupload_reason"], str) and r["reupload_reason"]


def test_build_summary_from_fragments_groups_by_field():
    from app.services.evidence_inspector import build_analysis_summary

    fragments = [
        {"field_id": "sole_photo", "field_label": "Sole", "image_url": "s3://a",
         "clarity": "clear", "identity_match": "yes", "observations": ["tread worn"],
         "condition_signals": ["heavy wear"], "ocr_text": None, "inspector_status": "ok"},
        {"field_id": "upper_photo", "field_label": "Upper", "image_url": "s3://b",
         "clarity": "clear", "identity_match": "no", "observations": [],
         "condition_signals": [], "ocr_text": "SN123", "inspector_status": "ok"},
    ]
    summary = build_analysis_summary(fragments, fraud={"classification": "CLEAN"},
                                     category="footwear", reason="too worn")
    assert summary["source"] == "evidence_fragments"
    assert summary["evidence_fields"] == ["sole_photo", "upper_photo"]
    assert summary["field_images"] == {"sole_photo": ["s3://a"], "upper_photo": ["s3://b"]}
    assert "SN123" in summary["ocr_text"]
    # An identity "no" must surface as a warning so Pass 2 withholds a high grade.
    assert "identity_mismatch_reported" in summary["warnings"]


def test_build_summary_empty_fragments_warns():
    from app.services.evidence_inspector import build_analysis_summary
    summary = build_analysis_summary([], category="apparel", reason="x")
    assert "no_evidence_fragments" in summary["warnings"]
    assert summary["photo_count"] == 0


if __name__ == "__main__":
    funcs = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in funcs:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"FAIL {fn.__name__}: {exc}")
    print(f"\n{len(funcs) - failed}/{len(funcs)} passed")
    sys.exit(1 if failed else 0)
