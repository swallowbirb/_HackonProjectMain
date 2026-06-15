import time

from fastapi import APIRouter

from app.config import settings
from app.services.gemini import gemini_service, GeminiError

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check():
    return {"service": "ml-service", "status": "ok"}


@router.get("/gemini/ping")
async def gemini_ping():
    """
    DEV connectivity probe: send a trivial prompt to Gemini and report the
    outcome. On failure it surfaces the EXACT API error (e.g. RESOURCE_EXHAUSTED,
    PERMISSION_DENIED) so a quota / key problem is obvious at a glance.
    """
    if not settings.gemini_api_key:
        return {"ok": False, "error": "GEMINI_API_KEY is not configured in ml-service."}

    started = time.perf_counter()
    try:
        text = await gemini_service.invoke(
            'Reply with the single word "ok".',
            max_tokens=32,
            temperature=0.0,
            phase="general",
            label="Gemini ping",
        )
        return {
            "ok": True,
            "model": gemini_service._current_model,
            "elapsedMs": round((time.perf_counter() - started) * 1000, 1),
            "reply": (text or "").strip()[:300],
        }
    except GeminiError as exc:
        return {
            "ok": False,
            "model": gemini_service._current_model,
            "elapsedMs": round((time.perf_counter() - started) * 1000, 1),
            "error": str(exc),
        }
