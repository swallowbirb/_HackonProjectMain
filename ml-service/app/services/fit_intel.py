"""
fit_intel.py — Phase 7 fit recommendation.

No body measurements. Input is the SKU's mined fitSignal (from RIKB, passed
by the backend) + the buyer's own kept-brand history (also passed by the
backend). Output is an honest, sourced one-liner.

Mirrors §6 of Phase7-Prevention.md.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

FIT_CATEGORIES = {"apparel", "clothing", "footwear", "shoes"}


def _norm(s: Any) -> str:
    return str(s or "").lower().strip()


def _pct(numerator: int, denominator: int) -> str:
    if denominator <= 0:
        return "Most"
    p = round((numerator / denominator) * 100)
    return f"{p}%"


def recommend(
    fit_signal: Optional[Dict[str, Any]],
    category: Any,
    kept_brand_history: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Return a structured recommendation; verdict='unknown' means "render nothing"."""
    sig = fit_signal or {}
    verdict = sig.get("verdict")
    confidence = float(sig.get("confidence") or 0)
    small = int(sig.get("smallMentions") or 0)
    large = int(sig.get("largeMentions") or 0)

    if _norm(category) not in FIT_CATEGORIES or verdict in (None, "unknown"):
        return {
            "verdict": "unknown",
            "message": None,
            "confidence": confidence,
            "suggested_action": None,
        }

    if verdict == "runs_small":
        msg = (
            f"Runs small — {_pct(small, small + large)} of shoppers who returned "
            "this said it was too tight. Consider sizing up."
        )
        action = "SIZE_UP"
    elif verdict == "runs_large":
        msg = (
            f"Runs large — {_pct(large, small + large)} of returns cite it being "
            "too loose. Consider sizing down."
        )
        action = "SIZE_DOWN"
    else:
        msg = "Sizing looks true to size for most shoppers."
        action = None

    if kept_brand_history and isinstance(kept_brand_history, dict):
        brand = kept_brand_history.get("brand")
        size = kept_brand_history.get("size")
        if brand:
            if size:
                msg += f" You took {size} in {brand} and kept it."
            else:
                msg += f" You've kept past {brand} purchases — your usual size is likely fine."

    return {
        "verdict": verdict,
        "message": msg,
        "confidence": confidence,
        "suggested_action": action,
    }
