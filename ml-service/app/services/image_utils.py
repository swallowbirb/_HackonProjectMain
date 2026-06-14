"""
Image fetching helpers shared across the grading pipeline.

Photos live in S3 and are passed around as URL strings. These helpers fetch the
raw bytes (async, off the event loop) and parse S3 bucket/key out of an HTTPS URL
so we can call the Rekognition/Textract S3Object APIs without re-uploading.

Every fetch is instrumented: pass an optional ``trace`` (PipelineTrace) and the
fetch result — success (bytes, content-type, latency) or the exact failure
(timeout, 403, connection error) — is recorded as a developer-log step. This is
the single most important diagnostic for "the model ran but got no image" bugs,
which happen when an S3 URL is expired/forbidden and the failure is otherwise
silently swallowed.
"""
import time
import asyncio
import logging
from typing import Optional, Tuple
from urllib.parse import urlparse, unquote

import httpx

logger = logging.getLogger("ml-service.image_utils")


class ImageFetchError(Exception):
    """Raised when an image URL cannot be retrieved or decoded."""


def _short_url(url: str, keep: int = 80) -> str:
    """Strip query string (presign noise) and truncate for readable logs."""
    try:
        base = url.split("?", 1)[0]
        return base if len(base) <= keep else "…" + base[-(keep - 1):]
    except Exception:  # noqa: BLE001
        return str(url)[:keep]


async def fetch_image_bytes(url: str, timeout: float = 10.0) -> bytes:
    """Fetch raw image bytes from an HTTP(S) URL. Raises ImageFetchError on failure."""
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.content
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to fetch image %s: %s", url, exc)
        raise ImageFetchError(f"Could not fetch image from {url}: {exc}") from exc


async def try_fetch_image_bytes(
    url: str,
    timeout: float = 10.0,
    *,
    trace=None,
    phase: str = "request",
    label: str = "image",
) -> Optional[bytes]:
    """
    Like fetch_image_bytes but returns None on failure instead of raising.

    When ``trace`` is provided, records a developer-log step for the fetch: on
    success the byte size + latency, on failure the precise reason (HTTP status,
    timeout, DNS/connection error). This converts every silent S3 fetch failure
    into a visible, actionable log line.
    """
    started = time.perf_counter()

    # If this is an S3 URL, download via authenticated GetObject. The bucket is
    # private — the presigned URL only authorizes the PUT upload, so a plain HTTP
    # GET on the bare object URL returns 403. boto3 uses the ML service's creds.
    s3_loc = parse_s3_url(url)
    if s3_loc is not None:
        bucket, key = s3_loc
        try:
            from app.services.s3_download import s3_download_service
            data = await asyncio.to_thread(s3_download_service.get_object_bytes, bucket, key)
            elapsed = round((time.perf_counter() - started) * 1000, 1)
            if trace is not None:
                kb = round(len(data) / 1024, 1)
                trace.add(
                    phase, "IMAGE_FETCH",
                    f"📥 Fetched {label}: {kb} KB (authenticated S3 GetObject)",
                    level="success", duration_ms=elapsed,
                    url=_short_url(url), bytes=len(data), source="s3:getobject",
                )
            return data
        except Exception as exc:  # noqa: BLE001
            elapsed = round((time.perf_counter() - started) * 1000, 1)
            aws_code = None
            try:
                aws_code = getattr(exc, "response", {}).get("Error", {}).get("Code")
            except Exception:  # noqa: BLE001
                aws_code = None
            if trace is not None:
                trace.error(
                    phase, "IMAGE_FETCH",
                    f"❌ Could not fetch {label} via S3 GetObject "
                    f"({aws_code or type(exc).__name__}) — the model will run WITHOUT this image.",
                    exc=exc, duration_ms=elapsed, url=_short_url(url),
                    aws_error_code=aws_code, source="s3:getobject",
                )
            logger.warning("Failed to fetch S3 image %s/%s: %s", bucket, key, exc)
            return None

    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.content
        elapsed = round((time.perf_counter() - started) * 1000, 1)
        if trace is not None:
            kb = round(len(data) / 1024, 1)
            trace.add(
                phase, "IMAGE_FETCH",
                f"📥 Fetched {label}: {kb} KB ({resp.headers.get('content-type', 'unknown type')})",
                level="success", duration_ms=elapsed,
                url=_short_url(url), bytes=len(data),
                content_type=resp.headers.get("content-type"),
                http_status=resp.status_code,
            )
        return data
    except httpx.HTTPStatusError as exc:
        elapsed = round((time.perf_counter() - started) * 1000, 1)
        status = exc.response.status_code if exc.response is not None else None
        hint = ""
        if status == 403:
            hint = " — S3 returned 403 Forbidden (presigned URL expired or bucket policy)."
        elif status == 404:
            hint = " — S3 returned 404 (object missing / wrong key)."
        if trace is not None:
            trace.error(
                phase, "IMAGE_FETCH",
                f"❌ Could not fetch {label} (HTTP {status}){hint}",
                exc=exc, duration_ms=elapsed, url=_short_url(url), http_status=status,
            )
        logger.warning("Failed to fetch image %s: %s", url, exc)
        return None
    except Exception as exc:  # noqa: BLE001
        elapsed = round((time.perf_counter() - started) * 1000, 1)
        if trace is not None:
            trace.error(
                phase, "IMAGE_FETCH",
                f"❌ Could not fetch {label}: {type(exc).__name__} — the model will run WITHOUT this image.",
                exc=exc, duration_ms=elapsed, url=_short_url(url),
            )
        logger.warning("Failed to fetch image %s: %s", url, exc)
        return None


def parse_s3_url(url: str) -> Optional[Tuple[str, str]]:
    """
    Parse a standard S3 HTTPS URL into (bucket, key).
    Supports virtual-hosted (https://<bucket>.s3.<region>.amazonaws.com/<key>)
    and path-style (https://s3.<region>.amazonaws.com/<bucket>/<key>) forms.
    Returns None if the URL is not an S3 URL.
    """
    try:
        parsed = urlparse(url)
        host = parsed.netloc.lower()
        path = unquote(parsed.path.lstrip("/"))
        if ".s3." in host or host.endswith("s3.amazonaws.com") or host.startswith("s3."):
            if host.startswith("s3.") or host == "s3.amazonaws.com":
                # path-style: first segment is the bucket
                parts = path.split("/", 1)
                if len(parts) == 2:
                    return parts[0], parts[1]
                return None
            # virtual-hosted: bucket is the leading host label
            bucket = host.split(".s3.")[0] if ".s3." in host else host.split(".s3-")[0]
            return bucket, path
        return None
    except Exception:  # noqa: BLE001
        return None
