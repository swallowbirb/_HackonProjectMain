import re
import os
from pathlib import Path

# Absolute path to ml-service/.env so settings load correctly regardless of CWD.
_ENV_FILE = str(Path(__file__).parent.parent / ".env")

try:
    from pydantic_settings import BaseSettings
    _HAS_PYDANTIC_SETTINGS = True
except Exception:  # noqa: BLE001 — allow importing pure logic without deps installed
    _HAS_PYDANTIC_SETTINGS = False

    class BaseSettings:  # minimal shim: reads env vars, uses class defaults otherwise
        def __init__(self):
            import os
            try:
                from dotenv import load_dotenv
                load_dotenv(_ENV_FILE)
            except ImportError:
                pass
            for name, default in type(self).__dict__.items():
                if name.startswith("_") or callable(default) or isinstance(default, classmethod):
                    continue
                if name == "Config":
                    continue
                env_val = os.environ.get(name.upper())
                if env_val is not None:
                    # coerce to the type of the default
                    if isinstance(default, bool):
                        env_val = env_val.lower() in ("1", "true", "yes")
                    elif isinstance(default, int):
                        try:
                            env_val = int(env_val)
                        except ValueError:
                            env_val = default
                    elif isinstance(default, float):
                        try:
                            env_val = float(env_val)
                        except ValueError:
                            env_val = default
                    setattr(self, name, env_val)
                else:
                    setattr(self, name, default)


_LOCAL_DEV_ORIGINS = (
    "http://localhost:3000,"
    "http://localhost:5173,"
    "http://localhost:5001"
)

# Wildcard patterns for Vercel preview/production and Render deployments
_CORS_ORIGIN_PATTERNS = (
    re.compile(r"^https://.*\.vercel\.app$"),
    re.compile(r"^https://.*\.onrender\.com$"),
)


def _strip_trailing_slash(url: str) -> str:
    return url.rstrip("/") if url else ""


def parse_cors_origins(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [_strip_trailing_slash(o) for o in raw.split(",") if o.strip()]


def get_cors_origins() -> list[str]:
    """Explicit origins from CORS_ORIGINS plus FRONTEND_URL and BACKEND_URL."""
    explicit = parse_cors_origins(os.environ.get("CORS_ORIGINS"))
    for key in ("FRONTEND_URL", "BACKEND_URL", "ML_SERVICE_URL"):
        val = os.environ.get(key)
        if val:
            explicit.append(_strip_trailing_slash(val))
    if not explicit:
        explicit = parse_cors_origins(_LOCAL_DEV_ORIGINS)
    # Deduplicate while preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for origin in explicit:
        if origin not in seen:
            seen.add(origin)
            unique.append(origin)
    return unique


def is_cors_origin_allowed(origin: str) -> bool:
    if not origin:
        return True
    normalized = _strip_trailing_slash(origin)
    if normalized in get_cors_origins():
        return True
    return any(pattern.match(normalized) for pattern in _CORS_ORIGIN_PATTERNS)


class Settings(BaseSettings):
    aws_region: str = "ap-south-1"
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    s3_bucket_name: str = ""
    kms_key_id: str = ""
    ml_service_url: str = "http://localhost:8000"
    frontend_url: str = "http://localhost:5173"
    backend_url: str = "http://localhost:5001"
    cors_origins: str = _LOCAL_DEV_ORIGINS

    # --- Gemini (LLM provider for Pass 1 + Pass 2) ---
    gemini_api_key: str = ""
    # Comma-separated list of additional API keys for round-robin rotation.
    # When the primary key is exhausted (429/RESOURCE_EXHAUSTED), the service
    # automatically tries the next key before falling back to the mock response.
    # Example: GEMINI_API_KEYS=key1,key2,key3
    gemini_api_keys: str = ""
    # flash-lite is the primary (cheapest/fastest); flash is the genuine fallback
    # so a single flash-lite hiccup still has a different model to retry against.
    gemini_model_primary: str = "gemini-2.5-flash-lite"
    gemini_model_fallback: str = "gemini-2.5-flash"
    # When True, return a hardcoded mock grade instead of calling Gemini.
    # Automatically activates when all API keys are exhausted.
    gemini_mock_fallback: bool = False

    # --- Phase 2 grading tunables ---
    grade_cache_ttl_seconds: int = 3600          # Pass-1 form-schema cache TTL
    gemini_timeout_seconds: int = 10             # per-attempt Gemini timeout (Req 11.1/11.2)
    pass2_timeout_seconds: int = 20              # Pass-2 synthesis budget (Req 7.7)
    analysis_timeout_seconds: int = 60           # asyncio.gather per-task budget (Req 6.1)
    phash_hamming_threshold: int = 10            # hard-fraud perceptual-hash distance (Req 2.2)
    clip_subject_match_threshold: float = 0.25   # CLIP zero-shot subject match (Req 5.2)
    clip_model_name: str = "openai/clip-vit-base-patch32"

    # OpenCV photo-quality thresholds (Req 5.1)
    blur_min: float = 100.0
    brightness_min: float = 40.0
    brightness_max: float = 220.0
    min_width: int = 800
    min_height: int = 600

    # --- Phase 7 prevention tunables ---
    return_model_path: str = "trained_models/return_model.txt"
    return_calibrator_path: str = "trained_models/calibrator.joblib"
    return_feature_spec_path: str = "trained_models/feature_spec.json"
    risk_high_threshold: float = 0.55
    risk_medium_threshold: float = 0.30

    class Config:
        env_file = _ENV_FILE
        case_sensitive = False


settings = Settings()
