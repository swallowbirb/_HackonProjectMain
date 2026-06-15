# Design Document

## Overview

This design reworks the Phase 2 dynamic evidence flow from a flat, free-text-inferred field form into a **structured, multi-step, context-aware verification & grading flow**. It is built on top of the existing, live pipeline (`backend/src/modules/grading/`, `backend/src/modules/items/`, `ml-service/app/`, `frontend/src/pages/ItemEvidencePage.jsx`) and is strictly **additive** — every new shape is optional, legacy schemas and fragments keep working, and the `triggerGrading` contract is preserved.

The central move is to replace "the inspector infers what's required from prose" with "**Pass 1 declares structured aspects; the inspector enforces only those.**" Everything else (steps, capture-mode selection, video, clothing rules, human-review routing) hangs off that structured model.

What already exists and is reused (verified in code):

- **Dynamic Pass-1 form** persisted on the Item as `evidenceForm` (`item.model.js`), with an in-memory cache in `grading.service.js`.
- **Per-field inspection (v2.35)** — `FieldInspectionRequest/Response` (`schemas.py`), `inspect_field` (`evidence_inspector.py`), `POST /vision/inspect-field`, and `verifyField` on the backend, writing one `evidenceFragments` entry per field.
- **Admin-editable prompts** — `PromptConfig` model + `prompt.service.js` (DB override with file/default fallback) + admin-only `prompt.routes.js`. Composition order base → category → seller is implemented in `prompt_loader.compose`.
- **Deterministic CV tooling** — `opencv_utils.py` (blur/brightness/resolution/histogram) and `fraud_preflight.py` (`imagehash` phash + EXIF).
- **Category prompts** — `apparel.txt`, `electronics.txt`, `footwear.txt` plus DB defaults in `prompt.service.js`.

The model is provider-neutral in requirements language (**Grading_LLM**) but designed concretely against **Gemini** as implemented (`gemini.py`, `gemini-2.5-flash` / `-flash-lite`).

### Design Principles

- **Generate flexibly, enforce strictly.** Pass 1 (the Grading_LLM) generates the aspect list per product; the inspector may only check the declared `required_views`. This is the root-cause fix for the "Side Body Condition demands front/back" bug.
- **Additive, non-breaking.** New fields on `Form_Schema`, `Item`, `Grade`, and the ML request/response are optional. A schema with no `steps`/`aspects` renders as a single implicit step of plain photo fields.
- **Degrade, never block.** LLM-unavailable inspection accepts-with-warning (existing behavior). The Two_Attempt_Passthrough guarantees a user is never trapped.
- **Honesty over fabrication.** Unverifiable claims are routed to humans, not assigned a confident grade.
- **Cheap-first.** Deterministic CV (blur/exposure/phash) does all video triage before any LLM call; the Grading_LLM only ever sees a few selected frames or one montage.

## Architecture

### End-to-end flow

```mermaid
flowchart TD
    subgraph FE["Frontend"]
        CLAIM["Claim screen\nreason + clarifying photos"]
        STEP["ItemEvidencePage (rework)\nStepper + per-step fields"]
        DEVT["DeveloperLogsSidebar\nMontage_Toggle (localStorage)"]
        ADMIN["Admin → Prompt Console\n(all prompt assets)"]
    end

    subgraph BE["Backend (Express)"]
        ITEM["item.service\nrequestEvidenceForm / attachEvidence\n+ verify-attempt tracking\n+ human-review signal"]
        GRAD["grading.service\nstartFormGeneration / verifyField / triggerGrading\n+ video frame-set + montage flag"]
        PROMPT["prompts module\nPromptConfig (base|category|template)"]
        ROUTE["routing signal\nneedsHumanReview + reasons"]
    end

    subgraph ML["ML Service (FastAPI)"]
        P1["form_generator\nemits steps[] + aspects[] + capture_mode"]
        INS["evidence_inspector.inspect_field\nenforces required_views + sibling scope\n+ montage_triage path"]
        VID["video_frame_selector (new)\nblur/exposure/phash → top-K frames\n+ liveness continuity"]
        P2["grade_synthesizer\n+ verifiability=none → 'cannot determine'"]
    end

    CLAIM --> ITEM --> GRAD -->|POST /grade/form| P1
    STEP -->|upload video/photo| GRAD
    GRAD -->|frames| VID
    STEP -->|Verify Field| GRAD -->|POST /vision/inspect-field| INS
    INS -->|video & toggle on| VID
    STEP -->|Submit| ITEM --> GRAD -->|POST /grade/| P2
    ITEM --> ROUTE
    DEVT -. montage flag .-> GRAD
    ADMIN --> PROMPT
    PROMPT -. base/category/template overrides .-> P1
    PROMPT -. .-> INS
    PROMPT -. .-> P2
```

### Component ownership (where each requirement lands)

| Requirement | Primary location(s) |
|---|---|
| 1. Structured aspects | `pass1_form_generation.txt`, `form_generator.py` (`_normalize_schema`), `schemas.py` (FormResponse schema shape) |
| 2. Inspector enforces declared aspects | `evidence_inspection.txt`, `evidence_inspector.py` (`inspect_field`), `schemas.py` (`FieldInspectionRequest`) |
| 3. Verifiability & limits | `pass1_form_generation.txt`, `pass2_grade_synthesis.txt`, `grade_synthesizer.py`, backend human-review signal |
| 4. Importance gating & 2-attempt passthrough | `item.service.js` / `grading.service.verifyField`, `item.model.js` (attempt counters) |
| 5. Capture-mode selection | `pass1_form_generation.txt`, `form_generator.py`, frontend field renderer |
| 6. Dynamic steps | `pass1_form_generation.txt`, `form_generator.py` (step assembly + dedup), `ItemEvidencePage.jsx` |
| 7. Stepper UI | `ItemEvidencePage.jsx` + new `EvidenceStepper` component |
| 8. Context-aware generation | `form_generator.py` (trust/value/clarifying inputs), `startFormGeneration` |
| 9. Video frame selection | new `video_frame_selector.py`, `opencv_utils.py`, `grading.service` (frame upload) |
| 10. Montage toggle | `DeveloperLogsSidebar.jsx`, `dev.service.js`, `inspect_field` montage path |
| 11. Video liveness | `video_frame_selector.py`, `fraud_preflight.py` (phash reuse) |
| 12. Clothing-aware | `apparel.txt` + DB `DEFAULT_CATEGORY.apparel`, Pass-1 rules |
| 13. Base/category split | `prompt_loader.py`, `prompt.service.js` (already structured) |
| 14. Admin prompt console | `prompt.model.js` (+ `template` scope), `prompt.service.js`, `prompt.routes.js`, ML template-override plumbing, frontend admin page |
| 15. Developer logs | `trace.py` / `ItemLogger`, `DeveloperLogsSidebar.jsx` |
| 16. Backward compatibility | all of the above — additive only |

## Components and Interfaces

### 1. The structured Form_Schema (Pass 1 output)

`schemaVersion` bumps to **3**. The schema gains an ordered `steps[]` layer; each photo/video field gains an `aspects[]` list and a `capture_mode`. The flat `fields[]` remains valid input (treated as one implicit step).

```jsonc
{
  "title": "Evidence for your return",
  "schemaVersion": 3,
  "category": "apparel",
  "steps": [
    {
      "id": "identity",
      "title": "Identity & tags",
      "purpose": "Confirm this is the item you purchased and it is unworn.",
      "fields": [
        {
          "id": "tags_label",
          "label": "Tags & care label",
          "type": "photo",
          "required": true,
          "capture_mode": "photo",            // video | photo | text
          "guidance": "Show the price tag and the care/size label still attached.",
          "aspects": [
            {
              "id": "tag_attached",
              "kind": "label",                // angle | region | label | functional
              "verifiability": "ocr",         // photo | ocr | none
              "importance": "critical",       // critical | standard | minor
              "detail_level": "normal",       // high | normal
              "expected_subject": "the price tag and care/size label",
              "required_views": ["price tag", "care/size label"],
              "validation_criteria": "Tags must be legible and attached to the garment."
            }
          ]
        }
      ]
    }
  ],
  "photo_guidance": ["Good light, plain background."]
}
```

`form_generator._normalize_schema` is extended to:
- Backfill any missing aspect attribute with safe defaults (`kind=region`, `verifiability=photo`, `importance=standard`, `detail_level=normal`, `expected_subject` from the field label, `required_views=[expected_subject]`, `validation_criteria="Must clearly show {expected_subject}."`) — **Req 1.3**.
- Clamp photo/video field count to `MAX_PHOTO_FIELDS` and stamp `schemaVersion` — **Req 1.4**.
- Assemble `steps[]` if the model returned only `fields[]` (group by an emitted `step` hint or fall back to a single step), and **de-duplicate** aspects whose `(kind, expected_subject)` already appears in an earlier step — **Req 6.2**.
- Set `capture_mode = "text"` for any field whose only aspects are `verifiability=none` — **Req 5.3**; default `photo` otherwise; honor an explicit `video` from the model — **Req 5.1/5.2**.

The `pass1_form_generation.txt` template is rewritten to emit this shape and to:
- Produce ordered steps composed from identity/overall (base), category checks (overlay), and the reason-specific defect.
- Emit `required_views` explicitly per angle/region aspect, using precise terms (no "sides") — **Req 1.6**.
- Mark non-photo-verifiable claims `verifiability=none` and prefer `capture_mode=text` for them — **Req 3.1, 5.3**.
- For fit/size reasons, emit **no** verification aspect for the fit claim, only condition-grading aspects — **Req 3.5**.
- Weight `importance` by the stated reason; mark a clarifying-photo-satisfied aspect as `satisfied: true` so it is not re-requested — **Req 8.1, 8.2**.

### 2. Inspector enforces declared aspects (`inspect_field`, `evidence_inspection.txt`)

`FieldInspectionRequest` (`schemas.py`) gains:

```python
aspects: List[Dict[str, Any]] = []          # the field's declared aspects
required_views: List[str] = []              # union of aspect required_views (convenience)
sibling_fields: List[Dict[str, str]] = []   # [{id,label,expected_subject}] of other fields
capture_mode: Optional[str] = "photo"       # photo | video
detail_level: Optional[str] = "normal"
```

`evidence_inspection.txt` is rewritten so the model is **constrained to declared scope**:
- `missing_views` MUST be a subset of `required_views`; the model is explicitly forbidden from adding any view not in `required_views` (**Req 2.1, 2.2**).
- Out-of-scope concerns go to `observations`, never to `missing_views` and never as a rejection reason (**Req 2.3**).
- `sibling_fields` are listed so the model does not demand evidence another field covers (**Req 2.4**).

`inspect_field` enforces this deterministically after the LLM call (defense in depth):

```python
declared = set(_norm(v) for v in required_views)
result["missing_views"] = [v for v in result["missing_views"] if _norm(v) in declared]
# If, after filtering, nothing is genuinely missing, the field cannot be rejected
# for "missing views":
if result["accepted"] is False and not result["missing_views"] \
        and reject_reason_is_missing_view_only(result):
    result["accepted"] = True
    result["reupload_reason"] = None
```

The existing accept-with-warning on LLM failure (**Req 2.6**) and the phash short-circuit are unchanged.

### 3. Capture mode + video frame selection (new `video_frame_selector.py`)

For a `capture_mode=video` field the frontend uploads a video (or pre-extracted frames). A new deterministic, **non-LLM** module selects frames:

```python
# video_frame_selector.py
def select_frames(video_bytes, *, max_frames, detail_high) -> dict:
    frames = extract_frames(video_bytes, fps=1.5)            # OpenCV VideoCapture
    scored = [(f, blur(f), brightness(f)) for f in frames]   # reuse opencv_utils
    usable = [f for f,b,br in scored
              if b >= BLUR_MIN and BRIGHT_MIN <= br <= BRIGHT_MAX]
    selected = phash_diversify(usable, max_n=max_frames)     # reuse imagehash phash
    liveness = phash_continuity(frames)                      # Req 11.1
    return {"frames": selected, "liveness": liveness}
```

- `select_frames` discards blurred/poorly-exposed/near-duplicate frames and caps at `max_frames` — **Req 9.1–9.3**.
- Frames answering a `detail_level=high` aspect are kept full-resolution and never montaged — **Req 9.5, 10.4**.
- `phash_continuity` and a catalog-phash check provide liveness/theft signals with no LLM — **Req 11.1, 11.2, 11.4**; discontinuities annotate the item — **Req 11.3**.

Client-side extraction is the prototype default: the browser samples frames via `<canvas>` and uploads JPEGs, so the existing S3-upload + `inspect_field` path is reused unchanged. Server-side `cv2.VideoCapture` is the fallback when raw video is uploaded.

### 4. Montage toggle (`DeveloperLogsSidebar.jsx`, `dev.service.js`, `inspect_field`)

Following the existing DevTools localStorage pattern:

```js
// dev.service.js
const MONTAGE_KEY = 'dev_montage_triage';
export const getMontageMode = () => localStorage.getItem(MONTAGE_KEY) === 'true'; // default off
```

The flag rides the verify request to the backend, which forwards `montage: bool` into `inspect_field`. Behavior:
- **off** (default): selected frames are inspected at full resolution in one call — **Req 10.5, 9.4**.
- **on**: `inspect_field` runs **Montage_Triage** — build a low-res contact sheet (`montage_utils.tile(frames)`), one overview call; for any cell the overview flags, send that single frame full-res in a follow-up call. Aspects with `detail_level=high` are excluded from the low-res montage and always inspected full-res — **Req 10.3, 10.4**.

A new admin-editable **montage prompt** instructs the overview call to return flagged cell indices. The video-inspection mode is logged per Verify_Action — **Req 10.6**.

### 5. Two-attempt passthrough + human-review routing (`item.service.js`, `grading.service.verifyField`)

`item.model.js` `evidenceForm` gains a per-field attempt/decision record (additive Mixed sub-doc):

```js
evidenceForm.fieldState: {           // { [fieldId]: {...} }
  // verifyAttempts: Number, status: 'staged'|'verified'|'unverified',
  // highestImportance: 'minor'|'standard'|'critical'
}
needsHumanReview: { type: Boolean, default: false },
humanReviewReasons: { type: [String], default: [] },   // e.g. ['unverifiable:ssd', 'unverified_critical:tags']
```

`verifyField` increments `verifyAttempts[fieldId]`. The gate logic (`item.service`):
- On the **2nd** failed verify for a field → mark `status='unverified'`, allow pass-through — **Req 4.1**.
- If the field's highest aspect importance is `critical` → set `needsHumanReview=true` with a reason — **Req 4.3**; if `minor` → proceed silently — **Req 4.2**.
- Any `verifiability=none` aspect material to the reason → set `needsHumanReview` immediately, no attempts needed — **Req 3.4, 4.4**.
- At submit, a required field with uploads but no successful verify gets one inline verify before the rule is applied — **Req 4.5**; a required field with no evidence blocks submit — **Req 4.6**.

`needsHumanReview` is carried into `triggerGrading` → persisted on the Grade (reusing `flaggedForReview`/`reviewReason`) and emitted as a routing signal, so the existing routing brain takes the hold-for-inspection path. **Req 3.4**.

### 6. Pass 2 honesty (`grade_synthesizer.py`, `pass2_grade_synthesis.txt`)

The Analysis_Summary (built by `build_analysis_summary`) is extended to carry each field's aspects and their `verifiability`. The Pass-2 prompt is instructed: for any material `verifiability=none` claim, record "cannot be determined from the provided media" for that claim rather than asserting a confident grade — **Req 3.3**. The canonical Grade JSON contract is unchanged and still passes `coerce_and_validate` — **Req 16.2**.

### 7. Stepper UI (`ItemEvidencePage.jsx` + `EvidenceStepper`)

- A new presentational `EvidenceStepper` renders an evenly-spaced horizontal `1—2—…—N` bar, highlighting the current step and distinguishing complete/upcoming — **Req 7.1, 7.2**.
- `ItemEvidencePage` is refactored to a step machine: it polls the dynamic form, renders the current step's fields by `capture_mode` (video recorder / photo uploader / text input), keeps the per-field Verify (v2.35) inside the step, and gates "Next" on the step's required fields being verified or passed-through — **Req 6.3, 6.4**.
- "Next" is disabled while a required field in the step is unsatisfied, naming the incomplete field — **Req 6.4**. Completed steps are revisitable — **Req 7.5**.
- A dynamically appended follow-up field updates the step and the stepper count — **Req 6.7, 7.4**.
- A schema without `steps` renders as a single implicit step — **Req 6.6, 16.4**.

### 8. Admin prompt & template console (extend `prompts` module)

The existing `PromptConfig` already covers `scope ∈ {base, category}` with DB-override-and-file-fallback and admin-only routes. Extend:

- Add `scope: 'template'` with keys `pass1_form`, `pass2_synthesis`, `evidence_inspection`, `montage` — **Req 14.1**.
- `prompt.service.listPrompts` returns base + all categories + all templates, each with current effective content (DB row or shipped file/default) — **Req 14.1, 14.4**.
- `upsertPrompt` validates non-empty content; an empty/unreadable save is rejected and prior content retained — **Req 14.5**. Routes already admin-only — **Req 14.6**.
- ML plumbing: `FormRequest`, `GradingRequest`, `FieldInspectionRequest` gain optional template-override fields (`pass1_template`, `pass2_template`, `inspection_template`, `montage_template`); `prompt_loader.load_template` prefers the supplied override over the bundled file. The backend resolves these from `PromptConfig` in `_resolvePrompts` and threads them through — **Req 14.2, 14.3**.
- A new frontend admin page lists every Prompt_Asset with an editor, save, and reset, using the existing `/api/prompts` endpoints (extended).

## Data Models

### `Form_Schema` (ML, persisted on Item `evidenceForm.schema`)
Additive: `steps[]`, per-field `aspects[]`, `capture_mode`, `satisfied`; `schemaVersion: 3`. Legacy `fields[]`-only schemas remain valid (single implicit step).

### `Item` (`item.model.js`) — additive only
```js
evidenceForm.fieldState: Mixed,        // per-field { verifyAttempts, status, highestImportance }
needsHumanReview:  { type: Boolean, default: false },
humanReviewReasons:{ type: [String], default: [] },
videoEvidence: Mixed,                  // { [fieldId]: { liveness, selectedFrameUrls } }
```
`evidenceFragments` gains optional `aspects`, `capture_mode`, and `liveness` (Mixed) carried from the field-level inspection. Existing v2.34/v2.35 fragment shapes remain valid — **Req 16.3, 16.5**.

### ML schemas (`schemas.py`) — additive optional
- `FieldInspectionRequest`: `+ aspects`, `+ required_views`, `+ sibling_fields`, `+ capture_mode`, `+ detail_level`, `+ inspection_template`, `+ montage`, `+ montage_template`.
- `FieldInspectionResponse`: `+ liveness`, `+ flagged_cells` (montage), `missing_views` constrained to declared views.
- `FormRequest`: `+ trust_tier`, `+ item_value`, `+ pass1_template`.
- `GradingRequest`: `+ pass2_template`; Analysis_Summary carries aspects/verifiability.

### `PromptConfig` (`prompt.model.js`) — additive
`scope` enum gains `'template'`; new keys `pass1_form`, `pass2_synthesis`, `evidence_inspection`, `montage`. Unique `(scope,key)` index already present.

### `Grade` — reuse existing
`flaggedForReview` / `reviewReason` carry the human-review routing (`reviewReason ∈ {... 'unverifiable_claim', 'unverified_critical_field'}`). No required-field changes — **Req 16.5**.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — a formal statement of what the system should do, bridging human-readable specs and machine-verifiable guarantees.*

The properties below target the **pure, input-varying logic** (schema normalization, view-scope enforcement, attempt/routing decisions, frame selection, step de-duplication, prompt resolution). LLM calls, network I/O, and React rendering are out of scope for PBT and covered by the Testing Strategy. Criteria classified INTEGRATION/SMOKE/EXAMPLE/EDGE_CASE there are not restated as universal properties.

### Property 1: Aspect normalization yields complete, valid aspects
*For any* Pass-1 schema object (well-formed, partial, or missing attributes), after `_normalize_schema` every photo/video field SHALL have at least one aspect, and every aspect SHALL have `kind ∈ {angle,region,label,functional}`, `verifiability ∈ {photo,ocr,none}`, `importance ∈ {critical,standard,minor}`, `detail_level ∈ {high,normal}`, a non-empty `expected_subject`, and a `required_views` list; and the photo/video field count SHALL NOT exceed `MAX_PHOTO_FIELDS`, with `schemaVersion` stamped.
**Validates: Requirements 1.1, 1.3, 1.4**

### Property 2: Inspector never reports an undeclared missing view
*For any* declared `required_views` list and *any* raw inspector output, the normalized `missing_views` SHALL be a subset of the declared `required_views`; and IF the only stated rejection cause is a missing view AND the filtered `missing_views` is empty, THEN the field SHALL be marked accepted.
**Validates: Requirements 2.1, 2.2, 2.3**

### Property 3: Capture-mode assignment respects verifiability
*For any* field, IF all of its aspects have `verifiability=none` THEN its resolved `capture_mode` SHALL be `text`; and a field assigned `capture_mode=text` SHALL have no media requirement.
**Validates: Requirements 5.1, 5.3**

### Property 4: Two-attempt pass-through and importance routing
*For any* sequence of verify outcomes on a field, the field SHALL become `unverified` and pass-through after exactly two failed verifications; and a human-review signal SHALL be set if and only if (a passed-through field's highest aspect importance is `critical`) OR (the field has a material `verifiability=none` aspect) — in the latter case without requiring two attempts.
**Validates: Requirements 3.4, 4.1, 4.2, 4.3, 4.4**

### Property 5: Required-field submit gate
*For any* form state at submit, submission SHALL be blocked if and only if at least one required field has no evidence at all; a required field with evidence but no successful verification SHALL trigger exactly one inline verification before the pass-through rule is applied.
**Validates: Requirements 4.5, 4.6**

### Property 6: Frame selection bounds, quality, and diversity
*For any* set of candidate video frames, the selected set SHALL contain no frame failing the blur or exposure thresholds, SHALL contain no two frames within the perceptual-hash duplicate threshold of each other, and SHALL have size at most `max_frames`; and any frame designated for a `detail_level=high` aspect SHALL be retained at full resolution.
**Validates: Requirements 9.1, 9.2, 9.3, 9.5**

### Property 7: Montage mode preserves high-detail fidelity
*For any* field inspected while the montage flag is on, every aspect with `detail_level=high` SHALL be inspected at full resolution and SHALL NOT appear in the low-resolution montage; while the montage flag is off, no montage pass SHALL be produced and all selected frames SHALL be inspected at full resolution.
**Validates: Requirements 10.3, 10.4, 10.5**

### Property 8: Step composition is ordered and de-duplicated
*For any* generated schema, the result SHALL be an ordered non-empty list of steps; no aspect identified by `(kind, normalized expected_subject)` SHALL appear in more than one field across all steps; and a schema lacking explicit steps SHALL be represented as exactly one implicit step containing all fields.
**Validates: Requirements 6.1, 6.2, 6.6, 16.4**

### Property 9: Prompt-asset resolution precedence
*For any* prompt asset (base, category, or template) and *any* combination of present/absent DB override and present/absent bundled file, the effective content SHALL be the DB override when it is non-empty, otherwise the bundled file/default; and a save with empty or unreadable content SHALL be rejected, leaving the previous effective content unchanged.
**Validates: Requirements 13.1, 13.3, 14.2, 14.3, 14.5**

### Property 10: Grade contract preserved across the rework
*For any* Analysis_Summary (including ones carrying `verifiability=none` aspects), the synthesized Grade_Result SHALL satisfy the canonical contract — `grade ∈ {A,B,C,D}`, `confidence ∈ {high,medium,low}`, `routingHint ∈ {resell,refurbish,donate,liquidate}`, `0 ≤ qualityScore ≤ 100`, `0.0 ≤ estimatedResalePct ≤ 1.0`, every defect severity `∈ {minor,moderate,major}` — and SHALL preserve all pre-existing required document fields, new fields being optional.
**Validates: Requirements 16.2, 16.3, 16.5**

### Property 11: Video liveness signals are deterministic and LLM-free
*For any* ordered frame sequence, `phash_continuity` SHALL produce the same continuity classification on repeated runs without invoking the Grading_LLM, and a sequence containing a hard discontinuity SHALL be flagged as such.
**Validates: Requirements 11.1, 11.3, 11.4**

## Error Handling

| Failure | Detection | Handling | Requirement |
|---|---|---|---|
| Pass-1 returns malformed/partial schema | `_is_valid_form_schema` + `_normalize_schema` | Backfill aspects, clamp, stamp version; if invalid, serve generic default schema | 1.3, 16.4 |
| Grading_LLM unavailable during inspection | try/except in `inspect_field` | Accept-with-warning; never block | 2.6 |
| Inspector invents an out-of-scope view | deterministic `missing_views ⊆ required_views` filter | Drop undeclared views; un-reject if nothing genuinely missing | 2.2, 2.3 |
| Video undecodable / no usable frames | `select_frames` returns empty usable set | Field falls back to photo capture with guidance; if still none, normal required-field gate | 9.1–9.3 |
| Video codec unsupported server-side | `cv2.VideoCapture` open failure | Use client-extracted frames; log and proceed | 9.1 |
| Montage overview flags no cells | empty `flagged_cells` | Accept on overview alone; no follow-up full-res call | 10.3 |
| User cannot satisfy a field | verify attempt counter reaches 2 | Pass-through tagged `unverified`; importance decides human-review | 4.1–4.3 |
| Unverifiable (verifiability=none) claim | Pass-1 marks aspect; submit detects | Capture what media can show; route to human review; Pass-2 records "cannot determine" | 3.1–3.4 |
| Admin saves empty/unreadable prompt | `upsertPrompt` validation | Reject save, retain previous effective content | 14.5 |
| Base prompt unloadable | `load_base_prompt` raises `PromptError` | 503 with trace (existing behavior) | 13.5 |
| Legacy flat schema / legacy fragments | shape detection in renderer + `build_analysis_summary` | Single implicit step; synthesize from existing fragments | 16.3, 16.4 |

The pipeline keeps its "degrade, never block" posture: every new failure resolves to a usable form, a usable grade, or a human-review route — never a trap or a crash that loses the user's evidence.

## Testing Strategy

### Dual approach
- **Property-based tests** verify Properties 1–11 across many generated inputs.
- **Unit/example tests** cover specific behaviors, prompt-rendering side effects, and the static API contract.
- **Integration/smoke tests** cover ML wiring, the stepper flow, and admin endpoints.

### Property-based testing
The high-value logic (schema normalization, view-scope enforcement, capture-mode/attempt/routing decisions, frame selection/diversity, step de-dup, prompt resolution, grade coercion) is pure and input-varying — a strong PBT fit. Gemini, AWS, and network are **mocked**; tests target the pure logic layer.

- **Libraries:** Python pure logic — `hypothesis`; Node pure logic — `fast-check`.
- **Configuration:** each property test runs a **minimum of 100 iterations**.
- **Tagging:** each property test references its design property in a comment:
  `# Feature: dynamic-stepper-evidence-grading, Property {n}: {property_text}` (Python) / `// ...` (Node).
- **Mapping (one PBT per property):**
  - Properties 1, 2, 3, 6, 7, 8, 11 → `hypothesis` against `form_generator._normalize_schema`, the `missing_views` filter / capture-mode resolver in `evidence_inspector`, `video_frame_selector` (select/diversify/continuity), and the montage selector.
  - Properties 4, 5, 9 → `fast-check` against the backend attempt/routing gate (`item.service`), the submit gate, and `prompt.service` resolution/validation.
  - Property 10 → `hypothesis` against `grade_validation.coerce_and_validate` with arbitrary/garbage raw dicts including `verifiability=none` summaries.

### Unit / example tests
- Pass-1 prompt renders steps + aspects + `required_views` for a phone "side body" reason and does **not** include front/back in that field's `required_views` (the original bug, as a regression guard).
- Apparel fit reason → schema contains condition aspects but **no** fit-verification aspect (**Req 3.5, 12** sample).
- `apparel` schema marks texture aspects `detail_level=high` and includes a `tags_label` critical aspect (**Req 12.1, 12.4**).
- DevTools montage toggle persists `'true'`/`'false'`; `getMontageMode()` maps correctly (**Req 10.1, 10.2**).
- `listPrompts` returns base + 4 categories + 4 templates with effective content (**Req 14.1**).

### Edge-case tests
- Single-side upload for a multi-view field → rejected with the missing side only when that side is in `required_views`; never rejected for front/back when not declared (**Req 2**).
- `verifiability=none` SSD claim → no impossible photo requested, `needsHumanReview` set immediately, Pass-2 records "cannot determine" (**Req 3**).
- Two failed verifies on a critical field → pass-through + human-review; on a minor field → silent pass-through (**Req 4**).
- Submit with a required field empty → blocked, names the field (**Req 4.6**).
- Color-mismatch apparel claim → soft signal only, no auto-reject/auto-grade (**Req 12.5**).

### Integration / smoke tests (1–3 each)
- Montage toggle on → `inspect_field` runs the two-pass montage path and logs the mode; off → single full-res pass (**Req 10**).
- Client-extracted video frames flow through the existing S3 + `inspect_field` path and synthesize a grade (**Req 9, 16**).
- Admin edits the `pass1_form` template → next form generation uses the edited template and logs that an admin asset was applied (**Req 14.2, 15.4**).
- Legacy flat `fields[]` schema renders as one step and grades end-to-end (**Req 16.4**).
