"""
Persona integration smoke tests (Task 2.13) — Pass-2 synthesis with a mocked Gemini.

We mock the Gemini client's invoke_json so the test runs without AWS/torch, while
still exercising the real prompt composition + grade coercion/validation path and
asserting the persona expectations (Priya->C, Rahul->B, Anjali->A).

Run: python tests/test_persona_integration.py
"""
import os
import sys
import asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services import grade_synthesizer
from app.services import gemini as gemini_module


class _FakeGemini:
    """Returns a canned raw grade based on a tag embedded in the summary."""
    _current_model = "gemini-2.5-flash"

    def __init__(self, raw):
        self._raw = raw

    async def invoke_json(self, prompt, images=None, max_tokens=2048, temperature=0.0, **kwargs):
        # **kwargs tolerates the developer-trace interface (trace=, phase=, label=).
        return self._raw


def _run_persona(raw, summary):
    # Patch the module-level gemini_service used by the synthesizer.
    original = grade_synthesizer.gemini_service
    grade_synthesizer.gemini_service = _FakeGemini(raw)
    try:
        return asyncio.run(grade_synthesizer.synthesize_grade(summary, category=summary.get("category")))
    finally:
        grade_synthesizer.gemini_service = original


def test_priya_worn_shoes_grade_c():
    raw = {
        "grade": "C", "qualityScore": 52, "confidence": "high", "routingHint": "refurbish",
        "estimatedResalePct": 0.35, "returnClaimVerified": True,
        "defects": [{"type": "sole_wear", "severity": "moderate", "location": "heel",
                     "description": "visible tread wear"}],
        "missingEvidence": [], "rationale": "Visible wear consistent with used footwear.",
    }
    summary = {"category": "footwear", "warnings": [], "analyses": {}}
    g = _run_persona(raw, summary)
    assert g["grade"] == "C", g
    assert g["modelVersions"]["pass2Model"]
    assert g["routingHint"] in {"refurbish", "resell", "donate", "liquidate"}


def test_rahul_baby_monitor_grade_b():
    raw = {
        "grade": "B", "qualityScore": 74, "confidence": "high", "routingHint": "resell",
        "estimatedResalePct": 0.6, "returnClaimVerified": True,
        "defects": [{"type": "scuff", "severity": "minor", "location": "back",
                     "description": "light cosmetic scuff"}],
        "missingEvidence": [], "rationale": "Minor cosmetic wear, function verified.",
    }
    summary = {"category": "electronics", "warnings": [], "analyses": {}}
    g = _run_persona(raw, summary)
    assert g["grade"] == "B", g
    assert g["confidence"] in {"high", "medium", "low"}


def test_anjali_dslr_grade_a():
    raw = {
        "grade": "A", "qualityScore": 95, "confidence": "high", "routingHint": "resell",
        "estimatedResalePct": 0.85, "returnClaimVerified": True,
        "defects": [], "missingEvidence": [], "rationale": "No visible defects, like-new.",
    }
    summary = {"category": "electronics", "warnings": [], "analyses": {}}
    g = _run_persona(raw, summary)
    assert g["grade"] == "A", g
    assert g["qualityScore"] >= 85


def test_rekognition_down_caps_confidence():
    raw = {
        "grade": "A", "qualityScore": 90, "confidence": "high", "routingHint": "resell",
        "estimatedResalePct": 0.8, "returnClaimVerified": False,
        "defects": [], "missingEvidence": [], "rationale": "Looks clean.",
    }
    summary = {"category": "apparel", "warnings": ["rekognition_unavailable"], "analyses": {}}
    g = _run_persona(raw, summary)
    assert g["confidence"] != "high"
    assert "defect_detection" in g["missingEvidence"]


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
