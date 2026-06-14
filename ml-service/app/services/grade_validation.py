"""
Pure grade coercion + validation (no AWS deps) — Task 2.8 logic, testable in isolation.

Enforces the v1.43 enums and numeric bounds and the metamorphic rules:
  * grade in {A,B,C,D}; confidence in {high,medium,low}; routingHint in {resell,...}
  * 0 <= qualityScore <= 100; 0.0 <= estimatedResalePct <= 1.0
  * Rekognition-unavailable -> dependent field in missingEvidence + confidence <= medium
  * any missingEvidence -> confidence never high
"""

GRADES = {"A", "B", "C", "D"}
CONFIDENCE = {"high", "medium", "low"}
ROUTING = {"resell", "refurbish", "donate", "liquidate"}
SEVERITIES = {"minor", "moderate", "major"}

DEFAULT_ROUTE_BY_GRADE = {"A": "resell", "B": "resell", "C": "refurbish", "D": "donate"}


class GradeValidationError(Exception):
    """Raised when model output cannot be coerced into a valid grade."""


def _clamp(value, lo, hi, default):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


def coerce_and_validate(raw, summary=None):
    """Coerce model output into a schema-valid Grade dict, enforcing enums + bounds."""
    summary = summary or {}

    grade = str(raw.get("grade", "")).strip().upper()
    if grade not in GRADES:
        raise GradeValidationError(f"Invalid grade value: {raw.get('grade')!r}")

    confidence = str(raw.get("confidence", "")).strip().lower()
    if confidence not in CONFIDENCE:
        confidence = "low"

    routing = str(raw.get("routingHint", "")).strip().lower()
    if routing not in ROUTING:
        routing = DEFAULT_ROUTE_BY_GRADE[grade]

    quality = int(round(_clamp(raw.get("qualityScore"), 0, 100, 0)))
    resale = _clamp(raw.get("estimatedResalePct"), 0.0, 1.0, 0.0)

    defects = []
    for d in raw.get("defects", []) or []:
        if not isinstance(d, dict):
            continue
        sev = str(d.get("severity", "minor")).strip().lower()
        if sev not in SEVERITIES:
            sev = "minor"
        defects.append({
            "type": str(d.get("type", "unknown")),
            "severity": sev,
            "location": str(d.get("location", "")) if d.get("location") else "",
            "description": str(d.get("description", "")) if d.get("description") else "",
        })

    missing = [str(m) for m in (raw.get("missingEvidence") or []) if m]

    warnings = summary.get("warnings", []) if isinstance(summary, dict) else []
    if "rekognition_unavailable" in warnings:
        if "defect_detection" not in missing:
            missing.append("defect_detection")
        if confidence == "high":
            confidence = "medium"

    if missing and confidence == "high":
        confidence = "medium"

    rationale = str(raw.get("rationale", "")).strip()
    if not rationale:
        rationale = f"Grade {grade} assigned from analysis summary."

    return {
        "grade": grade,
        "qualityScore": quality,
        "confidence": confidence,
        "defects": defects,
        "missingEvidence": missing,
        "returnClaimVerified": bool(raw.get("returnClaimVerified", False)),
        "estimatedResalePct": resale,
        "routingHint": routing,
        "rationale": rationale,
    }
