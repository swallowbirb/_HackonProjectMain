"""
CLIP service — Task 2.2

Zero-shot subject match + visual similarity using openai/clip-vit-base-patch32.
The model is lazy-loaded on first use and cached in module scope (CPU is fine for
the demo). All image inputs are S3 URL strings; bytes are fetched on demand and
fetch failures are handled gracefully.
"""
import io
import asyncio
import logging
from typing import List, Optional

import numpy as np
from PIL import Image

from app.config import settings
from app.services.image_utils import try_fetch_image_bytes

logger = logging.getLogger("ml-service.clip")

# Module-scoped cache so the heavy model loads only once.
_model = None
_processor = None


def _load_model():
    """Lazy-load CLIP model + processor. Returns (model, processor) or (None, None)."""
    global _model, _processor
    if _model is not None and _processor is not None:
        return _model, _processor
    try:
        import torch  # noqa: F401
        from transformers import CLIPModel, CLIPProcessor

        logger.info("Loading CLIP model %s ...", settings.clip_model_name)
        _model = CLIPModel.from_pretrained(settings.clip_model_name)
        _model.eval()
        _processor = CLIPProcessor.from_pretrained(settings.clip_model_name)
        return _model, _processor
    except Exception as exc:  # noqa: BLE001
        logger.warning("CLIP model unavailable: %s", exc)
        return None, None


def _open_image(image_bytes: bytes) -> Optional[Image.Image]:
    try:
        return Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not decode image for CLIP: %s", exc)
        return None


class CLIPService:
    def _image_embedding_sync(self, image: Image.Image) -> Optional[np.ndarray]:
        model, processor = _load_model()
        if model is None:
            return None
        import torch

        inputs = processor(images=image, return_tensors="pt")
        with torch.no_grad():
            feats = model.get_image_features(**inputs)
        # transformers >=5 returns a BaseModelOutputWithPooling object whose
        # pooled (512-dim) embedding lives in `.pooler_output`; older versions
        # returned the embedding tensor directly. Support both.
        pooled = getattr(feats, "pooler_output", None)
        if pooled is None and isinstance(feats, dict):
            pooled = feats.get("pooler_output")
        if pooled is None:
            pooled = feats  # legacy: tensor of shape (1, dim)
        vec = pooled[0].cpu().numpy().astype("float32")
        norm = np.linalg.norm(vec)
        return vec / norm if norm > 0 else vec

    def _subject_match_sync(self, image: Image.Image, expected_subject: str) -> dict:
        model, processor = _load_model()
        if model is None:
            return {"matches": False, "confidence": 0.0, "available": False}
        import torch

        # Richer contrastive prompt set. The two-prompt softmax (positive vs
        # generic negative) almost always picks the specific label when the
        # subject vaguely matches; adding plausible distractors forces the
        # model to actually discriminate.
        positive = f"a photo of {expected_subject}"
        labels = [
            positive,
            "a photo of an unrelated object",
            "a photo of a different part of the same item",
            "a blurry or unrecognisable photo",
        ]

        # State-aware verifier: when the subject describes a STATE the camera
        # cannot fake (a powered-on screen, a lit display), zero-shot CLIP is
        # too coarse — a powered-OFF phone is still "a photo of an Oppo Reno
        # 11" so it scores high. Add an explicit OFF/ON pair so the contrast
        # is visible to the softmax.
        subj_l = expected_subject.lower()
        is_powered_on_subject = any(
            kw in subj_l
            for kw in (
                "powered on", "powered-on", "screen on", "screen turned on",
                "lit screen", "displaying", "turned on", "switched on",
                "showing the home screen", "showing content",
            )
        )
        if is_powered_on_subject:
            labels.append("a photo of a phone with the screen turned off, dark and black")

        inputs = processor(text=labels, images=image, return_tensors="pt", padding=True)
        with torch.no_grad():
            outputs = model(**inputs)
            probs = outputs.logits_per_image.softmax(dim=1)[0].cpu().numpy()

        confidence = float(probs[0])
        winning_idx = int(np.argmax(probs))
        winning_label = labels[winning_idx]
        matches = winning_idx == 0 and confidence >= settings.clip_subject_match_threshold

        return {
            "matches": matches,
            "confidence": confidence,
            "winning_label": winning_label,
            "label_scores": {labels[i]: float(probs[i]) for i in range(len(labels))},
            "available": True,
        }

    async def subject_match(self, image_url: str, expected_subject: str) -> dict:
        """
        Zero-shot subject match.
        Returns { matches: bool, confidence: float, available: bool }.
        On fetch/decode/model failure returns matches=False with available=False.
        """
        img_bytes = await try_fetch_image_bytes(image_url)
        if img_bytes is None:
            return {"matches": False, "confidence": 0.0, "available": False}
        image = _open_image(img_bytes)
        if image is None:
            return {"matches": False, "confidence": 0.0, "available": False}
        return await asyncio.to_thread(self._subject_match_sync, image, expected_subject)

    async def visual_similarity(self, image_url: str, listing_image_urls: List[str]) -> dict:
        """
        Cosine similarity between the submitted image and each listing image.
        Returns { max: float, avg: float, available: bool, compared: int }.
        """
        sub_bytes = await try_fetch_image_bytes(image_url)
        if sub_bytes is None:
            return {"max": 0.0, "avg": 0.0, "available": False, "compared": 0}
        sub_img = _open_image(sub_bytes)
        if sub_img is None:
            return {"max": 0.0, "avg": 0.0, "available": False, "compared": 0}

        sub_emb = await asyncio.to_thread(self._image_embedding_sync, sub_img)
        if sub_emb is None:
            return {"max": 0.0, "avg": 0.0, "available": False, "compared": 0}

        sims: List[float] = []
        for url in listing_image_urls or []:
            ref_bytes = await try_fetch_image_bytes(url)
            if ref_bytes is None:
                continue
            ref_img = _open_image(ref_bytes)
            if ref_img is None:
                continue
            ref_emb = await asyncio.to_thread(self._image_embedding_sync, ref_img)
            if ref_emb is None:
                continue
            sims.append(float(np.dot(sub_emb, ref_emb)))

        if not sims:
            return {"max": 0.0, "avg": 0.0, "available": False, "compared": 0}
        return {
            "max": max(sims),
            "avg": sum(sims) / len(sims),
            "available": True,
            "compared": len(sims),
        }


clip_service = CLIPService()
