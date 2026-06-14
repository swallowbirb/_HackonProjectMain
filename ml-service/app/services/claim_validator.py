"""
Claim plausibility pre-check (v2.34) — the cheapest gate in the pipeline.

Runs ONE tiny text-only LLM call at return/resale initiation, BEFORE any of the
expensive work (Pass-1 form generation, per-photo inspection, Pass-2 synthesis).
Its only job: reject claims that clearly cannot pertain to this product — e.g.
"fridge not cooling" on a phone listing — so we never spend tokens grading nonsense.

Token-efficient by design:
  * text only (no images), tiny prompt, max_tokens ~120, cheap model,
  * lenient: only rejects CLEAR product-type mismatches; vague/empty claims pass,
  * fail-open: any LLM error returns plausible=True so real users are never blocked.
"""
import json
import logging
from typing import Optional, Dict, Any

from app.services.gemini import gemini_service, GeminiError, GeminiJSONError

logger = logging.getLogger("ml-service.claim_validator")

# Don't even call the LLM for trivially short / empty free-text — nothing to judge.
_MIN_REASON_CHARS = 6

_PROMPT = """You screen product return/resale claims for plausibility. Decide ONLY whether the
claim could plausibly refer to THIS product. Reject solely on a CLEAR product-type
mismatch (the claim describes a completely different kind of item than the product —
e.g. "fridge not cooling" for a mobile phone, "won't boot" for a t-shirt).

Be LENIENT: vague, generic, or merely odd claims are plausible. When unsure, plausible=true.

PRODUCT:
- Title: {title}
- Category: {category}
- Details: {listing_data}

CLAIM (buyer's stated reason): "{reason}"

Return ONLY this JSON, no prose:
{{"plausible": true | false, "reason": "<short reason, only when plausible is false>"}}
"""


async def validate_claim(
    reason: Optional[str],
    *,
    category: Optional[str] = None,
    product_title: Optional[str] = None,
    listing_data: Optional[dict] = None,
    trace=None,
) -> Dict[str, Any]:
    """Return {plausible: bool, reason: str|None, checked: bool}. Never raises."""
    text = (reason or "").strip()
    if len(text) < _MIN_REASON_CHARS:
        # Nothing meaningful to screen (e.g. only a dropdown reason was given).
        if trace is not None:
            trace.info("claim", "CLAIM_SKIP",
                       "↪️ Claim plausibility check skipped — no meaningful free-text claim.")
        return {"plausible": True, "reason": None, "checked": False}

    prompt = _PROMPT.format(
        title=product_title or "(unknown)",
        category=category or "(unknown)",
        listing_data=json.dumps(listing_data or {}, ensure_ascii=False)[:600],
        reason=text[:500],
    )

    if trace is not None:
        trace.info("claim", "CLAIM_CHECK",
                   f"🔎 Screening claim plausibility against product "
                   f"'{product_title or category or 'unknown'}' (text-only, cheap).")

    try:
        raw = await gemini_service.invoke_json(
            prompt, images=None, max_tokens=120,
            trace=trace, phase="claim", label="Claim plausibility")
    except (GeminiError, GeminiJSONError) as exc:
        # Fail open — never block a real user because the LLM hiccuped.
        if trace is not None:
            trace.warn("claim", "CLAIM_DEGRADED",
                       f"⚠️ Claim check unavailable ({type(exc).__name__}) — allowing the claim.", exc=exc)
        return {"plausible": True, "reason": None, "checked": False}

    plausible = bool(raw.get("plausible", True))
    why = raw.get("reason")
    why = str(why).strip() if why else None

    if trace is not None:
        if plausible:
            trace.success("claim", "CLAIM_RESULT", "✅ Claim is plausible for this product.")
        else:
            trace.warn("claim", "CLAIM_RESULT",
                       f"🚫 Claim rejected as implausible for this product: {why or 'mismatch'}")

    return {"plausible": plausible, "reason": why, "checked": True}
