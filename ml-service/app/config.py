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


class Settings(BaseSettings):
    aws_region: str = "ap-south-1"
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    s3_bucket_name: str = ""
    kms_key_id: str = ""
    ml_service_url: str = "http://localhost:8000"

    # --- Gemini (LLM provider for Pass 1 + Pass 2) ---
    gemini_api_key: str = ""
    # flash-lite is the primary (cheapest/fastest); flash is the genuine fallback
    # so a single flash-lite hiccup still has a different model to retry against.
    gemini_model_primary: str = "gemini-2.5-flash-lite"
    gemini_model_fallback: str = "gemini-2.5-flash"

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
