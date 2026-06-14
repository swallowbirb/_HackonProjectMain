import logging

from fastapi import APIRouter

from app.models.schemas import (
    PhotoValidationRequest, PhotoValidationResponse,
    EvidenceInspectionRequest, EvidenceInspectionResponse,
    FieldInspectionRequest, FieldInspectionResponse,
)
from app.services.evidence_inspector import inspect_photo, inspect_field
from app.services.rekognition import rekognition_service
from app.services.image_utils import try_fetch_image_bytes
from app.services.trace import PipelineTrace

router = APIRouter()
logger = logging.getLogger("ml-service.vision")


@router.post("/inspect-field", response_model=FieldInspectionResponse)
async def inspect_evidence_field(request: FieldInspectionRequest):
    """
    Per-field batched Evidence Inspection (Pass 1.5, v2.35).

    Triggered by the user's "Submit Field" click. Receives ALL photos for one form
    field and judges them as a SET in ONE multimodal LLM call. Returns a single
    field-level accept/reject + per-photo descriptive notes + any missing views.
    Replaces the v2.34 per-photo unit of work for the default flow.
    """
    trace = PipelineTrace(item_id=request.item_id)
    result = await inspect_field(
        request.photo_urls,
        field_id=request.field_id,
        field_label=request.field_label,
        expected_subject=request.expected_subject,
        validation_criteria=request.validation_criteria,
        listing_data=request.listing_data,
        catalog_image_urls=request.catalog_image_urls,
        reason=request.reason,
        category=request.category,
        seller_prompt=request.seller_prompt,
        base_prompt=request.base_prompt,
        category_prompt=request.category_prompt,
        trace=trace,
    )
    return FieldInspectionResponse(
        field_id=request.field_id,
        photo_urls=request.photo_urls,
        trace=trace.to_list(),
        **{k: v for k, v in result.items() if k != "warning"},
    )


@router.post("/inspect-photo", response_model=EvidenceInspectionResponse)
async def inspect_evidence_photo(request: EvidenceInspectionRequest):
    """
    Single-photo Evidence Inspection (back-compat shim, v2.34 contract).

    Now delegates to ``inspect_field`` with a one-element photo list and projects the
    result back onto the per-photo response shape so existing callers keep working.
    """
    trace = PipelineTrace(item_id=request.item_id)
    result = await inspect_photo(
        request.photo_url,
        field_id=request.field_id,
        field_label=request.field_label,
        expected_subject=request.expected_subject,
        validation_criteria=request.validation_criteria,
        listing_data=request.listing_data,
        catalog_image_urls=request.catalog_image_urls,
        reason=request.reason,
        category=request.category,
        seller_prompt=request.seller_prompt,
        base_prompt=request.base_prompt,
        category_prompt=request.category_prompt,
        trace=trace,
    )
    return EvidenceInspectionResponse(
        photo_url=request.photo_url,
        trace=trace.to_list(),
        **{k: v for k, v in result.items() if k != "warning"},
    )


@router.post("/validate-photo", response_model=PhotoValidationResponse)
async def validate_photo(request: PhotoValidationRequest):
    """
    Backward-compatible shim. The old contract returned {is_valid, issues[]}; we now
    delegate to the Evidence Inspector and map its richer result back onto that shape
    so existing callers keep working. OpenCV/CLIP are gone.
    """
    trace = PipelineTrace(item_id=request.item_id)
    result = await inspect_photo(
        request.photo_url,
        expected_subject=request.expected_subject,
        trace=trace,
    )

    issues = []
    if not result.get("accepted"):
        clarity = result.get("clarity")
        if clarity in ("blurry", "dark", "cropped"):
            issues.append(clarity if clarity != "blurry" else "too_blurry")
        if result.get("subject_match") is False:
            issues.append("wrong_subject")
        if result.get("identity_match") == "no":
            issues.append("wrong_item")
        if not issues:
            issues.append("unusable_evidence")

    return PhotoValidationResponse(
        photo_url=request.photo_url,
        is_valid=bool(result.get("accepted")),
        issues=issues,
        trace=trace.to_list(),
    )


@router.post("/analyze-image")
async def analyze_image(request: PhotoValidationRequest):
    """Rekognition label detection on a single image (optional/enhanced lane only)."""
    image_bytes = await try_fetch_image_bytes(request.photo_url)
    if image_bytes is None:
        return {"photo_url": request.photo_url, "labels": [], "error": "unprocessable_image"}
    try:
        labels = await rekognition_service.detect_labels_bytes(image_bytes)
        return {
            "photo_url": request.photo_url,
            "labels": [
                {
                    "name": l.get("Name"),
                    "confidence": l.get("Confidence"),
                    "instances": l.get("Instances", []),
                }
                for l in labels
            ],
        }
    except Exception as exc:  # noqa: BLE001
        logger.warning("Rekognition analyze-image failed: %s", exc)
        return {"photo_url": request.photo_url, "labels": [], "error": "rekognition_unavailable"}
