"""Tiny in-memory TTL cache used by the Pass-1 form-schema cache (Task 2.5).

v3.44 hardening (improvement #8):
  * Aggressive reason normalization — lowercase, trim, collapse whitespace, strip
    surrounding punctuation — so "Too tight!" and "too tight" share one schema.
  * Cache key falls back to ``category`` when no catalog ``product_id`` is present
    (the "I bought it elsewhere" sell-used path has no productId).
"""
import time
import hashlib
import re
from typing import Any, Optional


# Strip leading/trailing punctuation and collapse internal punctuation runs so
# semantically identical reasons collide on the same key.
_PUNCT_RUN = re.compile(r"[^\w\s]+")
_WS_RUN = re.compile(r"\s+")


def normalize_reason(reason: str) -> str:
    """Lowercase, trim, drop punctuation, collapse whitespace runs (Req 3.2)."""
    if not reason:
        return ""
    lowered = reason.strip().lower()
    # Replace punctuation with a space so "too-tight" == "too tight".
    depunct = _PUNCT_RUN.sub(" ", lowered)
    return _WS_RUN.sub(" ", depunct).strip()


def cache_key(product_id: Optional[str], reason: str, category: Optional[str] = None) -> str:
    """
    Deterministic Pass-1 cache key (Req 3.2/3.4).

    Primary key:  hash(productId + normalized_reason)
    Fallback key: hash("cat:" + category + normalized_reason) when productId is
                  absent (no catalog match — e.g. "bought it elsewhere").
    """
    norm = normalize_reason(reason)
    if product_id:
        seed = f"{product_id}|{norm}"
    else:
        seed = f"cat:{(category or 'generic').strip().lower()}|{norm}"
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()


class TTLCache:
    def __init__(self, ttl_seconds: int):
        self.ttl = ttl_seconds
        self._store: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Optional[Any]:
        entry = self._store.get(key)
        if entry is None:
            return None
        stored_at, value = entry
        if (time.time() - stored_at) > self.ttl:
            # expired — treat as miss and evict
            self._store.pop(key, None)
            return None
        return value

    def set(self, key: str, value: Any) -> None:
        self._store[key] = (time.time(), value)

    def clear(self) -> None:
        self._store.clear()
