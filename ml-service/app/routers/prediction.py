"""
Phase 7 — prediction endpoints.

Both endpoints degrade gracefully:
  - /predict/return: model load failure or any inference exception falls back
    to the explainable JS-mirror scorecard. The request path NEVER returns 500.
  - /predict/fit-recommend: returns verdict='unknown' when category isn't a
    fit category or the signal is too thin; the frontend renders nothing.
"""

from fastapi import APIRouter

from app.models.schemas import (
    ReturnRiskRequest,
    ReturnRiskResponse,
    FitRecommendRequest,
    FitRecommendResponse,
)
from app.services import return_risk, fit_intel

router = APIRouter()


@router.post("/return", response_model=ReturnRiskResponse)
async def predict_return_probability(request: ReturnRiskRequest) -> ReturnRiskResponse:
    """
    Score return risk for a checkout intent.
    Tries the LightGBM model if artifacts are present; falls back to the
    explainable scorecard otherwise. `used_fallback` reports which path ran.
    """
    result = return_risk.predict_return(request.features)
    return ReturnRiskResponse(**result)


@router.post("/fit-recommend", response_model=FitRecommendResponse)
async def fit_recommendation(request: FitRecommendRequest) -> FitRecommendResponse:
    """
    Honest fit hint mined from our own returns/reviews. No body measurements.
    Returns verdict='unknown' when the data is too thin or the category isn't
    fit-relevant (electronics, books, etc.) — frontend renders nothing.
    """
    result = fit_intel.recommend(
        fit_signal=request.fit_signal,
        category=request.category,
        kept_brand_history=request.kept_brand_history,
    )
    return FitRecommendResponse(**result)
