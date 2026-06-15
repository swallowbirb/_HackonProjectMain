"""
Montage utilities — Req 10.3–10.6

tile(frame_bytes_list) → bytes (JPEG)
    Build a low-resolution contact sheet from a list of image bytes.
    Each cell is downscaled to CELL_SIZE × CELL_SIZE; the cells are laid
    out left-to-right, top-to-bottom in a grid.

parse_flagged_cells(raw) → List[int]
    Parse the LLM's flagged_cells output (0-based cell indices) from a
    raw value that may be a list of ints, a list of strings, or a JSON
    string — handling every reasonable shape the model might emit.
"""
import io
import json
import math
from typing import List

try:
    from PIL import Image as _PILImage
    _PIL_AVAILABLE = True
except ImportError:  # noqa: BLE001
    _PILImage = None  # type: ignore[assignment]
    _PIL_AVAILABLE = False

CELL_SIZE = 224   # px — small enough to keep montage token cost low
GRID_COLS = 3
JPEG_QUALITY = 75  # overview call doesn't need full fidelity


def tile(
    frame_bytes_list: List[bytes],
    *,
    grid_cols: int = GRID_COLS,
    cell_size: int = CELL_SIZE,
) -> bytes:
    """
    Build a low-res contact sheet and return its JPEG bytes.

    Each frame is thumbnail-resized to ``cell_size`` × ``cell_size`` and
    centered inside its cell.  A dark-grey background fills any empty cells
    or letter-box padding.

    Raises ``ImportError`` if Pillow is not installed.
    Raises ``ValueError`` for an empty frame list.
    """
    if not _PIL_AVAILABLE:
        raise ImportError(
            "Pillow is required for montage tiling — `pip install Pillow`"
        )
    n = len(frame_bytes_list)
    if n == 0:
        raise ValueError("Cannot tile an empty frame list")

    grid_cols = max(1, min(grid_cols, n))
    grid_rows = math.ceil(n / grid_cols)
    canvas = _PILImage.new(
        "RGB",
        (grid_cols * cell_size, grid_rows * cell_size),
        color=(30, 30, 30),
    )

    for idx, raw in enumerate(frame_bytes_list):
        try:
            img = _PILImage.open(io.BytesIO(raw)).convert("RGB")
            img.thumbnail((cell_size, cell_size), _PILImage.LANCZOS)
            col = idx % grid_cols
            row = idx // grid_cols
            x = col * cell_size + (cell_size - img.width) // 2
            y = row * cell_size + (cell_size - img.height) // 2
            canvas.paste(img, (x, y))
        except Exception:  # noqa: BLE001
            pass  # blank cell on decode failure — never block the caller

    buf = io.BytesIO()
    canvas.save(buf, format="JPEG", quality=JPEG_QUALITY)
    return buf.getvalue()


def parse_flagged_cells(raw) -> List[int]:
    """
    Parse the LLM's ``flagged_cells`` field into a deduplicated list of
    0-based integer cell indices.

    Accepts: ``None``, ``list[int]``, ``list[str]``, a JSON-encoded string,
    or a comma-separated string.  Invalid/non-integer values are silently
    dropped.
    """
    if raw is None:
        return []

    if isinstance(raw, list):
        out: List[int] = []
        seen: set = set()
        for v in raw:
            try:
                i = int(v)
                if i not in seen:
                    seen.add(i)
                    out.append(i)
            except (TypeError, ValueError):
                pass
        return out

    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return parse_flagged_cells(parsed)
        except (json.JSONDecodeError, ValueError):
            pass
        # Fallback: comma-separated ints
        out = []
        seen = set()
        for part in raw.split(","):
            part = part.strip()
            try:
                i = int(part)
                if i not in seen:
                    seen.add(i)
                    out.append(i)
            except (TypeError, ValueError):
                pass
        return out

    return []
