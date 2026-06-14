"""
return_risk.py — Phase 7 prevention scorecard + (deferred) LightGBM serving.

Mirrors the JS scorecard in backend/src/modules/prevention/prevention.scoring.js
exactly. Both implementations MUST agree on the §4.3 worked examples in
Phase7-Prevention.md (Priya/Rahul/Bracketer) within rounding.

The LightGBM model is deliberately deferred post-hackathon (§5). The serving
function lazily attempts to load the model artifacts; if absent or any error
occurs, it falls back to the scorecard automatically — the request path
NEVER raises. Drop the trained model files into trained_models/ later and
the path picks them up with no other code changes.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ── Constants (mirror backend/src/contracts/prevention.contract.js) ──────────

FIT_CATEGORIES = {"apparel", "clothing", "footwear", "shoes"}
ELECTRONICS_CATEGORIES = {"electronics", "gadgets", "tech", "mobile", "computers"}
FURNITURE_CATEGORIES = {"furniture", "home", "kitchen", "decor", "home decor"}
VISUAL_CATEGORIES = FIT_CATEGORIES | FURNITURE_CATEGORIES | {"bags"}

CATEGORY_RETURN_PRIORS: Dict[str, float] = {
    "apparel": 0.28,
    "clothing": 0.28,
    "footwear": 0.20,
    "shoes": 0.20,
    "electronics": 0.08,
    "gadgets": 0.08,
    "tech": 0.08,
    "mobile": 0.10,
    "computers": 0.08,
    "home": 0.10,
    "kitchen": 0.10,
    "furniture": 0.12,
    "decor": 0.12,
    "beauty": 0.06,
    "cosmetics": 0.06,
    "toys": 0.10,
    "baby": 0.10,
    "books": 0.04,
    "media": 0.04,
    "default": 0.12,
}

MIN_SALES_FOR_OWN_RATE = 5

PRICE_BANDS_INR = {
    "CHEAP_MAX": 200,
    "MID_MAX": 800,
    "UPPER_MID_MAX": 3000,
}

BAND_THRESHOLDS = {"HIGH": 65, "MEDIUM": 35}

SIGNAL_WEIGHTS: Dict[str, float] = {
    "PRODUCT_RETURN_RATE": 0.26,
    "FIT_MISMATCH": 0.20,
    "USER_RETURN_BEHAVIOUR": 0.20,
    "CATEGORY_PRIOR": 0.12,
    "BRACKETING_INTENT": 0.12,
    "PRICE_BAND": 0.03,
    "REVIEW_SENTIMENT_GAP": 0.03,
    "PHOTO_VERIFICATION": 0.04,
}

REASON_TEMPLATES: Dict[str, str] = {
    "PRODUCT_RETURN_RATE": "About {pct}% of these are returned",
    "FIT_MISMATCH": "Tends to run {verdict} — most returns cite {issue}",
    "USER_RETURN_BEHAVIOUR": "Your recent returns are higher than usual",
    "CATEGORY_PRIOR": "{category} items are returned more often than average",
    "BRACKETING_INTENT": "You've added multiple of the same item",
    "REVIEW_SENTIMENT_GAP": "Recent reviews mention quality concerns",
    "PHOTO_VERIFICATION": "This listing has no verified real-time photo — product may differ from images",
}


def _clamp(n: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, n))


def _norm(s: Any) -> str:
    return str(s or "").lower().strip()


def _category_group(category: Any) -> str:
    c = _norm(category)
    if c in FIT_CATEGORIES:
        return "apparel"
    if c in ELECTRONICS_CATEGORIES:
        return "electronics"
    if c in FURNITURE_CATEGORIES:
        return "furniture"
    return "other"


def _category_prior(category: Any) -> float:
    return CATEGORY_RETURN_PRIORS.get(_norm(category), CATEGORY_RETURN_PRIORS["default"])


# ── Per-signal scoring (each returns 0..100, 100 = max risk) ──────────────────

def _score_product_return_rate(insight: Dict[str, Any], category: Any) -> float:
    units = (insight or {}).get("unitsSold") or 0
    rate = (
        (insight or {}).get("returnRate") or 0.0
        if units >= MIN_SALES_FOR_OWN_RATE
        else _category_prior(category)
    )
    return _clamp(rate / 0.40, 0, 1) * 100


def _score_category_prior(category: Any) -> float:
    return _clamp(_category_prior(category) / 0.30, 0, 1) * 100


def _score_fit_mismatch(insight: Dict[str, Any], category: Any, buyer_acted_on_fit: bool) -> float:
    g = _category_group(category)
    insight = insight or {}

    if g == "apparel":
        sig = insight.get("fitSignal") or {}
        if buyer_acted_on_fit:
            return 0.0
        if sig.get("verdict") in ("runs_small", "runs_large"):
            return float(sig.get("confidence") or 0) * 100
        return 0.0

    if g == "electronics":
        sig = insight.get("compatSignal") or {}
        if sig.get("verdict") == "issues_reported":
            return float(sig.get("confidence") or 0) * 100
        return 0.0

    if g == "furniture":
        sig = insight.get("dimensionSignal") or {}
        if sig.get("verdict") in ("too_large", "too_small", "color_mismatch"):
            return float(sig.get("confidence") or 0) * 100
        return 0.0

    return 0.0


def _score_user_return_behaviour(trust: Optional[Dict[str, Any]]) -> float:
    if not trust:
        return 0.0
    rr = float(trust.get("returnRate") or 0)
    r90 = float(trust.get("recentReturnRate90d") or 0)
    score = 0.6 * _clamp(rr / 0.40, 0, 1) * 100 + 0.4 * _clamp(r90 / 0.50, 0, 1) * 100

    tier = trust.get("tier")
    if tier == "restricted":
        score = max(score, 90)
    elif tier == "watch":
        score = max(score, 60)
    elif tier == "verified":
        score = min(score, 20)
    elif tier == "trusted":
        score = min(score, 35)
    return _clamp(score, 0, 100)


def _score_bracketing_intent(bracketing: bool, trust: Optional[Dict[str, Any]]) -> float:
    if bracketing:
        return 100.0
    if trust and trust.get("bracketingFlag"):
        return 60.0
    return 0.0


def _score_price_band(price_inr: Any) -> float:
    p = float(price_inr or 0)
    if p < PRICE_BANDS_INR["CHEAP_MAX"]:
        return 20.0
    if p < PRICE_BANDS_INR["MID_MAX"]:
        return 100.0
    if p < PRICE_BANDS_INR["UPPER_MID_MAX"]:
        return 60.0
    return 30.0


def _score_review_sentiment_gap(review_count: Any, rating: Any) -> float:
    rc = int(review_count or 0)
    rt = float(rating or 0)
    if rc < 5 or rt >= 3.5:
        return 0.0
    return _clamp((3.5 - rt) / 2.5, 0, 1) * 100


def _score_photo_verification(verified: Any, category: Any) -> float:
    if verified is True:
        return 0.0
    if _norm(category) not in VISUAL_CATEGORIES:
        return 0.0
    return 100.0


# ── Aggregate scorecard ────────────────────────────────────────────────────


def scorecard(features: Dict[str, Any]) -> Dict[str, Any]:
    """PURE — mirrors the JS computeScorecard. Returns risk_score, band, top_reasons."""
    f = features or {}
    insight = f.get("insight") or {}
    trust = f.get("trust")
    category = f.get("category")

    signal_scores: Dict[str, float] = {
        "PRODUCT_RETURN_RATE": _score_product_return_rate(insight, category),
        "FIT_MISMATCH": _score_fit_mismatch(insight, category, bool(f.get("buyerActedOnFit"))),
        "USER_RETURN_BEHAVIOUR": _score_user_return_behaviour(trust),
        "CATEGORY_PRIOR": _score_category_prior(category),
        "BRACKETING_INTENT": _score_bracketing_intent(bool(f.get("bracketingIntent")), trust),
        "PRICE_BAND": _score_price_band(f.get("priceInr")),
        "REVIEW_SENTIMENT_GAP": _score_review_sentiment_gap(f.get("reviewCount"), f.get("averageRating")),
        "PHOTO_VERIFICATION": _score_photo_verification(f.get("realtimePhotoVerified"), category),
    }

    contributions: List[Dict[str, Any]] = []
    for name, score in signal_scores.items():
        weight = SIGNAL_WEIGHTS[name]
        contributions.append({
            "signal": name,
            "score": round(score, 1),
            "weight": weight,
            "contribution": round(score * weight, 2),
        })

    risk_score = _clamp(sum(c["contribution"] for c in contributions), 0, 100)

    if risk_score > BAND_THRESHOLDS["HIGH"]:
        band = "high"
    elif risk_score >= BAND_THRESHOLDS["MEDIUM"]:
        band = "medium"
    else:
        band = "low"

    genuine = bool(trust and trust.get("tier") in ("verified", "trusted"))
    eligible = [
        c for c in contributions
        if c["contribution"] > 0 and not (c["signal"] == "USER_RETURN_BEHAVIOUR" and genuine)
    ]
    top = sorted(eligible, key=lambda c: c["contribution"], reverse=True)[:3]
    top_reasons = [_render_reason(c, features, signal_scores) for c in top]

    return {
        "risk_score": int(round(risk_score)),
        "band": band,
        "signal_scores": signal_scores,
        "contributions": contributions,
        "top_reasons": top_reasons,
    }


def _render_reason(contribution: Dict[str, Any], features: Dict[str, Any], _signal_scores: Dict[str, float]) -> Dict[str, Any]:
    f = features or {}
    insight = f.get("insight") or {}
    tmpl = REASON_TEMPLATES.get(contribution["signal"], contribution["signal"])
    signal = contribution["signal"]
    base = {
        "signal": signal,
        "weight": contribution["weight"],
        "contribution": contribution["contribution"],
    }

    if signal == "PRODUCT_RETURN_RATE":
        pct = round((insight.get("returnRate") or 0) * 100)
        base["message"] = tmpl.replace("{pct}", str(pct))
    elif signal == "FIT_MISMATCH":
        g = _category_group(f.get("category"))
        verdict, issue = "differently", "expectation mismatch"
        if g == "apparel":
            v = (insight.get("fitSignal") or {}).get("verdict")
            verdict = "large" if v == "runs_large" else "small"
            issue = "tightness" if verdict == "small" else "looseness"
        elif g == "electronics":
            verdict, issue = "with compatibility issues", "setup or compatibility"
        elif g == "furniture":
            v = (insight.get("dimensionSignal") or {}).get("verdict") or "unknown"
            verdict = "small" if v == "too_small" else "large" if v == "too_large" else "differently"
            issue = "color difference" if v == "color_mismatch" else "size mismatch"
        base["message"] = tmpl.replace("{verdict}", verdict).replace("{issue}", issue)
    elif signal == "CATEGORY_PRIOR":
        cat = (str(f.get("category") or "these")).capitalize()
        base["message"] = tmpl.replace("{category}", cat)
    else:
        base["message"] = tmpl
    return base


# ── LightGBM model serving (lazy, falls back to scorecard) ───────────────────

_MODEL: Any = None
_CALIB: Any = None
_SPEC: Optional[Dict[str, Any]] = None
_LOAD_ATTEMPTED = False

_MODEL_PATH = os.getenv("RETURN_MODEL_PATH", "trained_models/return_model.txt")
_CALIB_PATH = os.getenv("RETURN_CALIBRATOR_PATH", "trained_models/calibrator.joblib")
_SPEC_PATH = os.getenv("RETURN_FEATURE_SPEC_PATH", "trained_models/feature_spec.json")
_HIGH_PROB = float(os.getenv("RISK_HIGH_THRESHOLD", "0.55"))
_MED_PROB = float(os.getenv("RISK_MEDIUM_THRESHOLD", "0.30"))


def _try_load() -> None:
    global _MODEL, _CALIB, _SPEC, _LOAD_ATTEMPTED
    if _LOAD_ATTEMPTED:
        return
    _LOAD_ATTEMPTED = True
    try:
        if not Path(_MODEL_PATH).exists():
            return
        # Lazy-import — these libs are heavy and optional for the demo.
        import lightgbm as lgb  # type: ignore
        import joblib  # type: ignore

        with open(_SPEC_PATH, "r", encoding="utf-8") as fh:
            _SPEC = json.load(fh)
        _MODEL = lgb.Booster(model_file=_MODEL_PATH)
        if Path(_CALIB_PATH).exists():
            _CALIB = joblib.load(_CALIB_PATH)
    except Exception as e:  # noqa: BLE001
        # Any failure → silently fall back to the scorecard path.
        _MODEL, _CALIB, _SPEC = None, None, None
        # eslint-style: log to stderr but never raise
        import sys
        print(f"[return_risk] model load failed; using scorecard fallback: {e}", file=sys.stderr)


def _band_from_prob(p: float) -> str:
    if p > _HIGH_PROB:
        return "high"
    if p >= _MED_PROB:
        return "medium"
    return "low"


def _vectorize(features: Dict[str, Any], spec: Dict[str, Any]) -> List[float]:
    f = features or {}
    insight = f.get("insight") or {}
    trust = f.get("trust") or {}
    feature_names: List[str] = spec.get("features", [])
    tier_ord = spec.get("tier_ordinal", {"verified": 0, "trusted": 1, "standard": 2, "watch": 3, "restricted": 4})

    def price_band_ordinal(p: float) -> int:
        if p < PRICE_BANDS_INR["CHEAP_MAX"]:
            return 0
        if p < PRICE_BANDS_INR["MID_MAX"]:
            return 1
        if p < PRICE_BANDS_INR["UPPER_MID_MAX"]:
            return 2
        return 3

    src: Dict[str, float] = {
        "product_return_rate": float(insight.get("returnRate") or 0),
        "category_prior": _category_prior(f.get("category")),
        "price_band_ordinal": float(price_band_ordinal(float(f.get("priceInr") or 0))),
        "condition_used": 0.0,  # not currently tracked — placeholder
        "user_return_rate": float(trust.get("returnRate") or 0),
        "user_recent90d": float(trust.get("recentReturnRate90d") or 0),
        "user_tier_ordinal": float(tier_ord.get(trust.get("tier") or "standard", 2)),
        "first_time_category": 0.0,  # placeholder
        "fit_mismatch": float(_score_fit_mismatch(insight, f.get("category"), bool(f.get("buyerActedOnFit"))) / 100),
        "bracketing_intent": 1.0 if f.get("bracketingIntent") else 0.0,
        "review_rating": float(f.get("averageRating") or 0),
        "review_count_log": float(0 if not f.get("reviewCount") else _safe_log1p(int(f.get("reviewCount")))),
    }
    return [src.get(name, 0.0) for name in feature_names]


def _safe_log1p(n: int) -> float:
    import math
    return math.log1p(max(n, 0))


def predict_return(features: Dict[str, Any]) -> Dict[str, Any]:
    """Public entry — always returns a result; never raises."""
    sc = scorecard(features)
    _try_load()

    if _MODEL is not None and _SPEC is not None:
        try:
            x = _vectorize(features, _SPEC)
            if _CALIB is not None:
                # CalibratedClassifierCV expects 2D; some calibrators wrap a
                # different model. We try predict_proba; fall back to raw model.
                try:
                    prob = float(_CALIB.predict_proba([x])[:, 1][0])
                except Exception:
                    prob = float(_MODEL.predict([x])[0])
            else:
                prob = float(_MODEL.predict([x])[0])
            prob = max(0.0, min(1.0, prob))
            return {
                "return_probability": round(prob, 3),
                "risk_band": _band_from_prob(prob),
                "scorecard_score": sc["risk_score"],
                "top_reasons": sc["top_reasons"],
                "used_fallback": False,
                "model_version": "lightgbm-v1",
            }
        except Exception as e:  # noqa: BLE001
            import sys
            print(f"[return_risk] predict failed; falling back to scorecard: {e}", file=sys.stderr)

    # Fallback path: scorecard probability proxy.
    return {
        "return_probability": round(sc["risk_score"] / 100, 3),
        "risk_band": sc["band"],
        "scorecard_score": sc["risk_score"],
        "top_reasons": sc["top_reasons"],
        "used_fallback": True,
        "model_version": "scorecard-only",
    }
