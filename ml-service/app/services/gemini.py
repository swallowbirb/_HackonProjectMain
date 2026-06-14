"""
Gemini client wrapper — LLM provider for the grading pipeline.

Replaces the former Bedrock client. Exposes the same interface the rest of the
pipeline already depends on, so Pass 1 (form generation) and Pass 2 (grade
synthesis) need no structural changes:

  * ``invoke(prompt, images=..., max_tokens=..., temperature=...)`` -> raw text
  * ``invoke_json(...)`` -> parsed JSON (raises GeminiJSONError on parse failure)
  * ``GeminiError`` / ``GeminiJSONError`` typed errors
  * module-level singleton ``gemini_service`` with a ``_current_model`` attribute

Uses the unified Google Gen AI SDK (``google-genai``):
    from google import genai
    client = genai.Client(api_key=...)
    client.models.generate_content(model=..., contents=[...], config=...)

Multimodal: image bytes are attached as inline parts (``types.Part.from_bytes``).
Deterministic JSON: Pass-1/Pass-2 requests set ``response_mime_type=application/json``.

Adds:
  * Automatic single retry against the configured fallback model.
  * Per-attempt timeout via the SDK ``HttpOptions(timeout=...)`` (milliseconds).
  * A JSON-extraction helper that strips prose and parses the first valid JSON object.
"""
import time
import asyncio
import logging
from typing import Optional, List

from app.config import settings
from app.services.json_utils import extract_json as _extract_json, JSONExtractionError
from app.services.trace import clip_text as _clip_text

logger = logging.getLogger("ml-service.gemini")


class GeminiError(Exception):
    """Gemini invocation failed on both primary and fallback models."""


class GeminiJSONError(Exception):
    """Gemini returned text that could not be parsed into JSON."""


def extract_json(text: str) -> dict:
    """Strip prose and parse the first valid JSON object. Raises GeminiJSONError."""
    try:
        return _extract_json(text)
    except JSONExtractionError as exc:
        raise GeminiJSONError(str(exc)) from exc


class GeminiService:
    def __init__(self):
        self._client = None
        self._types = None
        self.primary_model = settings.gemini_model_primary
        self.fallback_model = settings.gemini_model_fallback
        self._current_model = self.primary_model

    @property
    def client(self):
        """Lazily construct the genai client so the module imports without the SDK installed."""
        if self._client is None:
            from google import genai
            from google.genai import types
            self._types = types
            http_options = types.HttpOptions(
                timeout=int(settings.gemini_timeout_seconds * 1000),  # SDK expects milliseconds
            )
            self._client = genai.Client(
                api_key=settings.gemini_api_key,
                http_options=http_options,
            )
        return self._client

    @property
    def types(self):
        if self._types is None:
            # Touch the client property to import + cache the types module.
            _ = self.client
        return self._types

    # ------------------------------------------------------------------ #
    # Low-level invocation
    # ------------------------------------------------------------------ #
    def _invoke_sync(self, prompt: str, model_id: str, images: Optional[List[bytes]],
                     max_tokens: int, temperature: float) -> str:
        self._current_model = model_id
        types = self.types

        contents = [prompt]
        for img_bytes in images or []:
            contents.append(types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"))

        config = types.GenerateContentConfig(
            max_output_tokens=max_tokens,
            temperature=temperature,
            response_mime_type="application/json",
        )
        response = self.client.models.generate_content(
            model=model_id,
            contents=contents,
            config=config,
        )
        text = getattr(response, "text", None)
        if not text:
            # Empty/blocked response — surface so the caller can fall back.
            reason = None
            try:
                reason = response.candidates[0].finish_reason
            except Exception:  # noqa: BLE001
                reason = None
            raise GeminiError(f"Gemini returned no text (finish_reason={reason})")
        return text

    # ------------------------------------------------------------------ #
    # Public async API
    # ------------------------------------------------------------------ #
    async def invoke(self, prompt: str, model_id: str = None, images: Optional[List[bytes]] = None,
                     max_tokens: int = 2048, temperature: float = 0.0,
                     *, trace=None, phase: str = "pass2", label: str = "Gemini") -> str:
        """
        Invoke Gemini with text (+ optional images), returning raw model text.
        Tries the primary model, then exactly once against the fallback.
        Raises GeminiError when both attempts fail.

        When ``trace`` is provided, every attempt is recorded: the model id,
        prompt size, image count, and on failure the EXACT SDK error (e.g.
        PERMISSION_DENIED, INVALID_ARGUMENT, RESOURCE_EXHAUSTED) so a dev can see
        precisely why a model call "isn't working".
        """
        models = [model_id] if model_id else [self.primary_model, self.fallback_model]
        img_count = len(images or [])
        last_err = None

        # Log the FULL input prompt once (untruncated) so devs can see exactly what
        # was sent to Gemini. The message carries a preview; metadata carries the
        # complete prompt text.
        if trace is not None:
            trace.info(
                phase, "MODEL_PROMPT",
                f"📨 {label} full input prompt ({len(prompt)} chars, {img_count} image(s)):\n{prompt}",
                model_provider="gemini", prompt_chars=len(prompt), image_count=img_count,
                full_prompt=prompt,
            )

        for idx, model in enumerate(models):
            role = "primary" if idx == 0 else "fallback"
            if trace is not None:
                trace.info(
                    phase, "MODEL_INVOKE",
                    f"🤖 Calling {label} → {model} ({role}, gemini/generate_content) "
                    f"with {img_count} image(s), {len(prompt)} prompt chars, max_tokens={max_tokens}",
                    model_id=model, provider="gemini", attempt=idx + 1, role=role,
                    image_count=img_count, prompt_chars=len(prompt),
                    max_tokens=max_tokens, temperature=temperature,
                )
            started = time.perf_counter()
            try:
                text = await asyncio.to_thread(
                    self._invoke_sync, prompt, model, images, max_tokens, temperature
                )
                elapsed = round((time.perf_counter() - started) * 1000, 1)
                if trace is not None:
                    trace.success(
                        phase, "MODEL_INVOKE",
                        f"✅ {label} responded from {model} in {elapsed:.0f}ms ({len(text)} chars)",
                        duration_ms=elapsed, model_id=model, role=role,
                        response_chars=len(text), response_preview=_clip_text(text, 200),
                    )
                    # Log the FULL raw output response (untruncated) in metadata.
                    trace.info(
                        phase, "MODEL_RESPONSE",
                        f"📩 {label} full raw response from {model} ({len(text)} chars):\n{text}",
                        model_id=model, role=role, response_chars=len(text),
                        full_response=text,
                    )
                return text
            except Exception as exc:  # noqa: BLE001 — fall through to fallback
                elapsed = round((time.perf_counter() - started) * 1000, 1)
                last_err = exc
                # Surface the Gemini error CODE/STATUS explicitly — this is the actionable bit.
                api_code = getattr(exc, "code", None) or getattr(exc, "status", None)
                will_fallback = idx + 1 < len(models)
                if trace is not None:
                    trace.error(
                        phase, "MODEL_INVOKE",
                        f"❌ {label} FAILED on {model} ({role}): "
                        f"{api_code or type(exc).__name__} — {_clip_text(exc, 220)}"
                        + (f". Retrying on fallback {models[idx + 1]}…" if will_fallback
                           else ". No models left — pipeline will degrade."),
                        exc=exc, duration_ms=elapsed, model_id=model, role=role,
                        api_error_code=api_code, will_fallback=will_fallback,
                    )
                logger.warning("Gemini invoke failed on %s (attempt %d): %s", model, idx + 1, exc)
                continue
        raise GeminiError(f"All Gemini attempts failed: {last_err}")

    async def invoke_json(self, prompt: str, images: Optional[List[bytes]] = None,
                          max_tokens: int = 2048, temperature: float = 0.0,
                          *, trace=None, phase: str = "pass2", label: str = "Gemini") -> dict:
        """
        Invoke Gemini and return parsed JSON.
        Raises GeminiError (invocation) or GeminiJSONError (parse) on failure.
        """
        text = await self.invoke(prompt, images=images, max_tokens=max_tokens,
                                 temperature=temperature, trace=trace, phase=phase, label=label)
        try:
            parsed = extract_json(text)
        except GeminiJSONError as exc:
            if trace is not None:
                trace.error(
                    phase, "MODEL_PARSE",
                    f"❌ {label} returned text that is not valid JSON: {_clip_text(exc, 160)}",
                    exc=exc, raw_preview=_clip_text(text, 400),
                )
            raise
        return parsed


gemini_service = GeminiService()
