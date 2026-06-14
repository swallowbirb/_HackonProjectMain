from typing import Optional, List, Any, Dict
from pydantic import BaseModel, Field, ConfigDict


# --- Grading ---

class PerPhotoNote(BaseModel):
    """A short, descriptive note about ONE photo within a multi-photo field set (v2.35)."""
    image_url: Optional[str] = None
    role: Optional[str] = None       # free-text, e.g. "left side", "front of phone"
    usable: Optional[bool] = None    # was this single photo usable evidence?
    note: Optional[str] = None       # short reason / observation


class EvidenceFragment(BaseModel):
    """
    A persisted inspection result. Two cardinalities coexist:
      - v2.34: ONE photo per fragment (image_url + image_hash set).
      - v2.35: ONE FIELD per fragment (image_urls + per_photo set), produced by the
        per-field "Submit Field" verification — the LLM judged the photo set as a whole.
    The synthesizer (Pass 2) consumes both shapes uniformly.
    """
    field_id: Optional[str] = None
    field_label: Optional[str] = None
    # v2.34 single-photo shape
    image_url: Optional[str] = None
    # v2.35 multi-photo shape
    image_urls: List[str] = []
    per_photo: List[PerPhotoNote] = []
    missing_views: List[str] = []
    # Common evidence fields (apply to the photo OR the field set)
    clarity: Optional[str] = None
    subject_match: Optional[bool] = None
    identity_match: Optional[str] = None       # yes | no | unknown
    observations: List[str] = []
    ocr_text: Optional[str] = None
    condition_signals: List[str] = []
    preflight: Dict[str, Any] = {}             # { phash_match, exif_has_camera_data }
    inspector_status: Optional[str] = None     # ok | unavailable | unprocessable_image


class GradingRequest(BaseModel):
    item_id: str
    photos: List[str] = []  # S3 URLs (flat union of all provided images) — legacy/fallback path
    category: Optional[str] = None
    return_claim_description: Optional[str] = None
    original_product_id: Optional[str] = None
    # Optional context used for fraud preflight.
    listing_image_urls: List[str] = []
    catalog_hashes: List[str] = []
    expected_subject: Optional[str] = None
    # v3.44 — field → [image URLs] mapping from the dynamic Pass-1 form, so Pass 2
    # can reference photos by the named field they answer (improvement #3).
    field_images: Dict[str, List[str]] = {}
    # v2.34 — pre-computed per-photo inspection fragments. When present, Pass 2
    # synthesizes from these (no raw-image re-analysis). When empty, the router
    # falls back to inspecting `photos` once before synthesis (legacy contract).
    fragments: List[EvidenceFragment] = []
    # v2.34 — prompt overrides resolved by the backend (admin base/category + seller).
    base_prompt: Optional[str] = None
    category_prompt: Optional[str] = None
    seller_prompt: Optional[str] = None


# --- Evidence inspection (Pass 1.5 — per upload) ---

class EvidenceInspectionRequest(BaseModel):
    photo_url: str
    item_id: Optional[str] = None
    field_id: Optional[str] = None
    field_label: Optional[str] = None
    expected_subject: Optional[str] = None
    # The AI-form field's validity criteria (what makes this photo acceptable). The
    # Pass-1 form generator emits this per field; the inspector enforces it.
    validation_criteria: Optional[str] = None
    reason: Optional[str] = None
    category: Optional[str] = None
    listing_data: Dict[str, Any] = {}
    # Same-angle catalog reference image(s) for this field, used for the per-upload
    # perceptual-hash duplicate check (stock-photo-theft).
    catalog_image_urls: List[str] = []
    base_prompt: Optional[str] = None
    category_prompt: Optional[str] = None
    seller_prompt: Optional[str] = None


class EvidenceInspectionResponse(BaseModel):
    photo_url: str
    accepted: bool
    reupload_reason: Optional[str] = None
    clarity: Optional[str] = None
    subject_match: Optional[bool] = None
    identity_match: Optional[str] = None
    observations: List[str] = []
    ocr_text: Optional[str] = None
    condition_signals: List[str] = []
    preflight: Dict[str, Any] = {}             # { phash_match, exif_has_camera_data, classification }
    inspector_model: Optional[str] = None
    inspector_status: Optional[str] = None
    trace: List[Dict[str, Any]] = []


# --- Field-level inspection (Pass 1.5 — per FIELD, v2.35) ---

class FieldInspectionRequest(BaseModel):
    """One field's photo set submitted for inspection as a unit (v2.35)."""
    photo_urls: List[str]
    item_id: Optional[str] = None
    field_id: Optional[str] = None
    field_label: Optional[str] = None
    expected_subject: Optional[str] = None
    validation_criteria: Optional[str] = None
    reason: Optional[str] = None
    category: Optional[str] = None
    listing_data: Dict[str, Any] = {}
    # Same-angle (or per-field) catalog reference image(s) — used per-photo for the
    # cheap phash duplicate check before the LLM call.
    catalog_image_urls: List[str] = []
    base_prompt: Optional[str] = None
    category_prompt: Optional[str] = None
    seller_prompt: Optional[str] = None


class FieldInspectionResponse(BaseModel):
    """Field-level decision over the photo set."""
    field_id: Optional[str] = None
    photo_urls: List[str] = []
    accepted: bool
    reupload_reason: Optional[str] = None
    # Per-photo descriptive notes (NOT decisions). Each entry's `usable` is the
    # LLM's judgement of that single photo's contribution to the set; the field
    # may still be `accepted=true` even when some photos are flagged unusable.
    per_photo: List[Dict[str, Any]] = []
    missing_views: List[str] = []      # e.g. ["left side"]
    observations: List[str] = []       # cross-set, neutral
    ocr_text_per_photo: Dict[str, str] = {}
    condition_signals: List[str] = []  # cross-set, described not graded
    preflight_per_photo: Dict[str, Any] = {}  # { url: { phash_match, exif_has_camera_data, ... } }
    inspector_model: Optional[str] = None
    inspector_status: Optional[str] = None    # ok | unavailable | phash_rejected | unprocessable_image
    trace: List[Dict[str, Any]] = []


class DefectDetail(BaseModel):
    type: str
    severity: str  # minor | moderate | major
    location: Optional[str] = None
    description: Optional[str] = None


class GradingResponse(BaseModel):
    item_id: str
    grade: str                      # A | B | C | D
    quality_score: float            # 0-100
    confidence: str                 # high | medium | low
    defects: List[DefectDetail] = []
    missing_evidence: List[str] = []
    return_claim_verified: bool = False
    estimated_resale_pct: float = 0.0
    routing_hint: str               # resell | refurbish | donate | liquidate
    rationale: str
    model_versions: dict = {}
    # Provenance / orchestration metadata
    analysis_summary: Dict[str, Any] = {}
    form_schema: Dict[str, Any] = {}
    prompts: Dict[str, str] = {}
    fraud: Dict[str, Any] = {}
    status: str = "ok"              # ok | fraud_rejected | failed
    # Developer-visibility trace: ordered, leveled, phased steps of the internal
    # pipeline (image fetches, Gemini attempts, vision calls). Ingested verbatim
    # into the backend itemLogs stream / Developer Logs sidebar.
    trace: List[Dict[str, Any]] = []


# --- Vision ---

class PhotoValidationRequest(BaseModel):
    photo_url: str                  # S3 URL
    item_id: Optional[str] = None
    expected_subject: Optional[str] = None


class PhotoValidationResponse(BaseModel):
    photo_url: str
    is_valid: bool
    issues: List[str] = []          # e.g. ["blurry", "dark", "moire"]
    blur_score: Optional[float] = None
    brightness_score: Optional[float] = None
    # Developer-visibility trace: ordered, leveled steps of the validation
    # (image fetch, OpenCV measurements, CLIP subject match). Replayed verbatim
    # into the backend itemLogs stream so the dev sidebar shows EVERY tool call.
    trace: List[Dict[str, Any]] = []


# --- Form generation (Pass 1) ---

class FormRequest(BaseModel):
    product_id: Optional[str] = None
    reason: str
    category: Optional[str] = None
    initial_photos: List[str] = []
    listing_image_urls: List[str] = []
    listing_data: Dict[str, Any] = {}
    # v2.34 — per-image custom hints from the seller. Each entry instructs Pass-1 to
    # generate a dedicated form field targeting that specific catalog image.
    # Shape: [{ url: str, hint: str }]
    image_hints: List[Dict[str, str]] = []
    base_prompt: Optional[str] = None
    category_prompt: Optional[str] = None
    seller_prompt: Optional[str] = None


class FormResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    form_schema: Dict[str, Any] = Field(default_factory=dict, alias="schema")
    status: str
    cached: bool
    key: str
    trace: List[Dict[str, Any]] = []


# --- Claim plausibility pre-check (cheap, text-only, runs before any Pass-1 work) ---

class ClaimValidationRequest(BaseModel):
    reason: str
    category: Optional[str] = None
    product_title: Optional[str] = None
    listing_data: Dict[str, Any] = {}


class ClaimValidationResponse(BaseModel):
    plausible: bool = True
    reason: Optional[str] = None        # short explanation when implausible
    checked: bool = True                # false when skipped (e.g. empty claim)
    trace: List[Dict[str, Any]] = []


# --- Prevention (Phase 7) ---

class ReturnRiskRequest(BaseModel):
    """Feature payload built by the backend prevention service."""
    features: Dict[str, Any]


class ReturnRiskResponse(BaseModel):
    return_probability: float
    risk_band: str                  # low | medium | high
    scorecard_score: int
    top_reasons: List[Dict[str, Any]] = []
    used_fallback: bool
    model_version: str


class FitRecommendRequest(BaseModel):
    fit_signal: Optional[Dict[str, Any]] = None
    category: Optional[str] = None
    kept_brand_history: Optional[Dict[str, Any]] = None


class FitRecommendResponse(BaseModel):
    verdict: str                    # runs_small | true_to_size | runs_large | unknown
    message: Optional[str] = None
    confidence: float = 0.0
    suggested_action: Optional[str] = None  # SIZE_UP | SIZE_DOWN | None
