"""
OpenCV utility functions for photo quality checks.
Used in Phase 2 — vision validation pass.
"""
import io
import numpy as np
from PIL import Image


def compute_blur_score(image_bytes: bytes) -> float:
    """
    Returns a blur score derived from Laplacian variance.

    Naive whole-image variance is fragile: a sharp photo that contains a large
    dark or uniform region (e.g. a powered-off phone screen against a bedsheet)
    has very little texture overall and reads as "blurry" even though the
    in-focus details are crisp. We instead split the image into a 4×4 grid and
    take the *maximum* per-tile variance — a photo is "in focus" when at least
    one region of it is sharp, regardless of how much smooth/dark area surrounds
    it. The whole-image variance is taken into account too (max of both).

    Lower = more blurry. Threshold ~100 for acceptable quality.
    """
    try:
        import cv2
        img = Image.open(io.BytesIO(image_bytes)).convert("L")
        img_np = np.array(img)

        # Whole-image variance (legacy signal).
        global_var = float(cv2.Laplacian(img_np, cv2.CV_64F).var())

        # Tile-based max variance: split into a 4×4 grid, drop tiles that are
        # almost entirely dark (mean < 25, e.g. an OFF screen) so they don't
        # poison the maximum. Take the largest variance from what remains.
        h, w = img_np.shape
        rows, cols = 4, 4
        tile_h = max(1, h // rows)
        tile_w = max(1, w // cols)
        tile_vars = []
        for r in range(rows):
            for c in range(cols):
                y0, x0 = r * tile_h, c * tile_w
                y1 = h if r == rows - 1 else y0 + tile_h
                x1 = w if c == cols - 1 else x0 + tile_w
                tile = img_np[y0:y1, x0:x1]
                if tile.size == 0:
                    continue
                # Skip near-black tiles — they have no texture by definition.
                if float(tile.mean()) < 25.0:
                    continue
                tile_vars.append(float(cv2.Laplacian(tile, cv2.CV_64F).var()))

        local_max = max(tile_vars) if tile_vars else 0.0
        return max(global_var, local_max)
    except ImportError:
        raise RuntimeError("opencv-python-headless not installed")


def compute_brightness_score(image_bytes: bytes) -> float:
    """
    Returns mean pixel brightness (0-255).
    Below 40 = too dark, above 220 = overexposed.
    """
    img = Image.open(io.BytesIO(image_bytes)).convert("L")
    img_np = np.array(img, dtype=np.float32)
    return float(img_np.mean())


def compute_center_brightness(image_bytes: bytes, fraction: float = 0.5) -> float:
    """
    Mean brightness (0-255) of the centre `fraction` of the image.

    Used to verify state claims like "powered-on screen": the screen typically
    occupies the centre of the frame, so a centre crop is far more diagnostic
    than the whole-image mean (which is dominated by background — bedsheet,
    table, hand). A powered-off screen reads near 0; a powered-on screen
    showing content reads ~70-200.
    """
    img = Image.open(io.BytesIO(image_bytes)).convert("L")
    arr = np.array(img, dtype=np.float32)
    h, w = arr.shape
    cy, cx = h // 2, w // 2
    half_h = max(1, int(h * fraction / 2))
    half_w = max(1, int(w * fraction / 2))
    crop = arr[max(0, cy - half_h):cy + half_h, max(0, cx - half_w):cx + half_w]
    if crop.size == 0:
        return float(arr.mean())
    return float(crop.mean())


def check_min_resolution(image_bytes: bytes, min_width: int = 800, min_height: int = 600) -> bool:
    """Returns True if image meets minimum resolution requirements."""
    img = Image.open(io.BytesIO(image_bytes))
    w, h = img.size
    return w >= min_width and h >= min_height


def validate_photo_quality(image_bytes: bytes) -> dict:
    """
    Runs all quality checks and returns a summary dict.
    """
    from app.config import settings

    issues = []
    blur_score = compute_blur_score(image_bytes)
    brightness = compute_brightness_score(image_bytes)
    resolution_ok = check_min_resolution(image_bytes, settings.min_width, settings.min_height)

    if blur_score < settings.blur_min:
        issues.append("blurry")
    if brightness < settings.brightness_min:
        issues.append("too_dark")
    if brightness > settings.brightness_max:
        issues.append("overexposed")
    if not resolution_ok:
        issues.append("low_resolution")

    return {
        "is_valid": len(issues) == 0,
        "issues": issues,
        "blur_score": blur_score,
        "brightness_score": brightness,
    }


def compute_color_histogram_delta(image_bytes_a: bytes, image_bytes_b: bytes) -> float:
    """
    Compare two images by HSV color-histogram correlation.
    Returns a delta in [0, 1]: 0 = identical color profile, 1 = completely different.
    Used to flag color mismatch between a submitted item and its listing photo.
    """
    try:
        import cv2
    except ImportError:
        raise RuntimeError("opencv-python-headless not installed")

    def _hist(b: bytes):
        img = Image.open(io.BytesIO(b)).convert("RGB")
        arr = np.array(img)
        bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
        hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
        h = cv2.calcHist([hsv], [0, 1], None, [50, 60], [0, 180, 0, 256])
        cv2.normalize(h, h, 0, 1, cv2.NORM_MINMAX)
        return h

    ha = _hist(image_bytes_a)
    hb = _hist(image_bytes_b)
    correlation = float(cv2.compareHist(ha, hb, cv2.HISTCMP_CORREL))
    # correlation in [-1, 1]; convert to a 0..1 delta.
    delta = 1.0 - max(0.0, correlation)
    return delta
