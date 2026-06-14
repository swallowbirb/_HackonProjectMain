"""
PipelineTrace — developer-visibility instrumentation for the ML grading pipeline.

The Node backend can only see what the ML service *returns*. Historically every
internal step (each S3 image fetch, each Gemini attempt, each vision call) was
invisible: failures were swallowed into a Python ``logger.warning`` and the only
thing that reached the Developer Logs sidebar was a generic "ML service failed".

``PipelineTrace`` fixes that at the root. It is a lightweight, never-throwing
accumulator of ordered, timestamped, severity- and phase-tagged steps. The
grading/form routers thread one trace through the whole pipeline and attach
``trace.to_list()`` to **every** response — success *and* failure — so the
backend can replay the exact internal story into the itemLogs stream.

Design rules:
  * NEVER throw. A tracing bug must never break grading. Every public method is
    wrapped defensively.
  * JSON-serializable output only (``to_list``).
  * Cheap. Pure in-memory list of small dicts.
"""
from __future__ import annotations

import time
import logging
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger("ml-service.trace")

# Severity levels (mirrors the backend ItemLogger levels).
INFO = "info"
SUCCESS = "success"
WARN = "warn"
ERROR = "error"
DEBUG = "debug"

# Canonical phase keys (mirrors the frontend phase grouping).
PHASE_REQUEST = "request"
PHASE_PASS1 = "pass1"
PHASE_FRAUD = "fraud"
PHASE_ANALYSIS = "analysis"
PHASE_PASS2 = "pass2"
PHASE_RESPONSE = "response"


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clip(text: Any, limit: int = 240) -> str:
    """Truncate long strings (prompts, URLs, error blobs) for log readability."""
    s = str(text)
    return s if len(s) <= limit else s[: limit - 1] + "…"


class _StepHandle:
    """Returned by ``trace.step(...)``; lets the caller annotate the outcome."""

    def __init__(self, trace: "PipelineTrace", phase: str, code: str, started: float):
        self._trace = trace
        self._phase = phase
        self._code = code
        self._started = started
        self._closed = False

    @property
    def elapsed_ms(self) -> float:
        return round((time.perf_counter() - self._started) * 1000, 1)

    def done(self, message: str, level: str = SUCCESS, **meta: Any) -> None:
        if self._closed:
            return
        self._closed = True
        self._trace.add(self._phase, self._code, message, level=level,
                        duration_ms=self.elapsed_ms, **meta)

    def fail(self, message: str, exc: Optional[BaseException] = None, **meta: Any) -> None:
        if self._closed:
            return
        self._closed = True
        if exc is not None:
            meta.setdefault("error_type", type(exc).__name__)
            meta.setdefault("error_detail", _clip(exc, 600))
        self._trace.add(self._phase, self._code, message, level=ERROR,
                        duration_ms=self.elapsed_ms, **meta)


class PipelineTrace:
    """Ordered, leveled, phased accumulator of pipeline steps."""

    def __init__(self, item_id: Optional[str] = None):
        self.item_id = item_id
        self._entries: List[Dict[str, Any]] = []
        self._seq = 0
        self._t0 = time.perf_counter()

    # ------------------------------------------------------------------ #
    # Core
    # ------------------------------------------------------------------ #
    def add(self, phase: str, code: str, message: str, level: str = INFO,
            duration_ms: Optional[float] = None, **meta: Any) -> Dict[str, Any]:
        """Record one step. Never throws."""
        try:
            self._seq += 1
            entry: Dict[str, Any] = {
                "seq": self._seq,
                "source": "ml",
                "phase": phase,
                "code": code,
                "level": level,
                "message": message,
                "ts": _utc_iso(),
                "since_start_ms": round((time.perf_counter() - self._t0) * 1000, 1),
            }
            if duration_ms is not None:
                entry["duration_ms"] = duration_ms
            # Drop None-valued metadata so the sidebar stays clean.
            clean = {k: v for k, v in meta.items() if v is not None}
            if clean:
                entry["meta"] = clean
            self._entries.append(entry)
            # Mirror to the Python console so `uvicorn` logs tell the same story.
            logger.log(
                logging.ERROR if level == ERROR else
                logging.WARNING if level == WARN else logging.INFO,
                "[%s/%s] %s", phase, code, message,
            )
            return entry
        except Exception as exc:  # noqa: BLE001 — tracing must never break the flow
            logger.warning("PipelineTrace.add failed: %s", exc)
            return {}

    # Convenience severity helpers ------------------------------------- #
    def info(self, phase: str, code: str, message: str, **meta: Any) -> Dict[str, Any]:
        return self.add(phase, code, message, level=INFO, **meta)

    def success(self, phase: str, code: str, message: str, **meta: Any) -> Dict[str, Any]:
        return self.add(phase, code, message, level=SUCCESS, **meta)

    def warn(self, phase: str, code: str, message: str, **meta: Any) -> Dict[str, Any]:
        return self.add(phase, code, message, level=WARN, **meta)

    def error(self, phase: str, code: str, message: str, exc: Optional[BaseException] = None,
              **meta: Any) -> Dict[str, Any]:
        if exc is not None:
            meta.setdefault("error_type", type(exc).__name__)
            meta.setdefault("error_detail", _clip(exc, 600))
        return self.add(phase, code, message, level=ERROR, **meta)

    def debug(self, phase: str, code: str, message: str, **meta: Any) -> Dict[str, Any]:
        return self.add(phase, code, message, level=DEBUG, **meta)

    # Timed spans ------------------------------------------------------- #
    @contextmanager
    def step(self, phase: str, code: str, start_message: Optional[str] = None, **start_meta: Any):
        """
        Context manager that times a block of work.

        Usage:
            with trace.step(PHASE_PASS2, "MODEL_PASS2", "Synthesizing grade...") as s:
                result = await do_work()
                s.done(f"Grade {result['grade']} synthesized")

        If the block raises, the exception is recorded as an ERROR step (with its
        type + message) and re-raised. If the block neither calls ``done`` nor
        ``fail`` nor raises, a default completion step is recorded on exit.
        """
        if start_message:
            self.debug(phase, f"{code}_START", start_message, **start_meta)
        started = time.perf_counter()
        handle = _StepHandle(self, phase, code, started)
        try:
            yield handle
        except Exception as exc:  # noqa: BLE001
            handle.fail(f"{code} failed: {_clip(exc, 200)}", exc=exc)
            raise
        else:
            if not handle._closed:
                handle.done(f"{code} completed")

    # Output ------------------------------------------------------------ #
    def to_list(self) -> List[Dict[str, Any]]:
        return list(self._entries)

    @property
    def error_count(self) -> int:
        return sum(1 for e in self._entries if e.get("level") == ERROR)

    @property
    def total_ms(self) -> float:
        return round((time.perf_counter() - self._t0) * 1000, 1)


# Helper used to keep prompt/url logging consistent across modules.
clip_text = _clip
