# Phase 2 v3.44 — Dynamic Form Integration & Claim-Specific Grading

> Supersedes the form-flow sections of `Phase2-AIGradingPipeline.md` and the v1.43
> grading doc. The two-pass pipeline, the vision tools, the fraud preflight, the
> trust integration — all of that stays. **This document is about one thing: making
> the dynamic, product-and-claim-specific evidence form the spine of the intake flow,
> instead of an orphaned capability bolted on the side.**
>
> **STATUS: IMPLEMENTED.** All 10 improvements below are built across the ML service,
> backend, and frontend. ML test suite green (20 passing). See "Implementation Status"
> at the end for the per-file change log.

---

## 0. TL;DR

- **What AI generates the dynamic form?** Google **Gemini** (`gemini-2.5-flash` primary,
  `gemini-2.5-flash-lite` fallback) via the `google-genai` SDK. This is Bedrock **Pass 1**
  in everything but the model — the codebase migrated off Amazon Nova/Bedrock to Gemini,
  and the older phase docs were never updated to match. v3.44 makes Gemini the documented
  truth.
- **The bug we're fixing:** Pass 1 (form generation) is *fully built* in both the
  ml-service and the backend — but **nothing in the live intake flow ever calls it.**
  The real path runs reason → photos → full analysis, with the dynamic form sitting unused.
- **The flow we want:**
  `claim text (+ optional clarifying photo)` → **generate a product- & claim-specific form**
  → user fills that form (targeted photos + fields) → analysis runs on *all* provided images.
- **The point:** every category — often every *product* — needs a different inspection.
  A DSLR return needs sensor + serial + all-ports shots. A shoe needs sole + upper + size
  label. A generic "upload 3 photos" form is the thing we're deleting.

---

## 1. What Already Exists (verified against the code)

I traced the real code paths. Here's the honest state, so we don't rebuild what's there.

### Built and working
| Capability | Location | State |
|---|---|---|
| Pass 1 form generator (Gemini, multimodal, JSON) | `ml-service/.../form_generator.py` | ✅ Works, cached by `hash(productId+reason)` |
| Pass 1 HTTP endpoint | `ml-service/.../routers/grading.py` → `POST /grade/form` | ✅ Returns `Form_Schema` + trace |
| Pass 1 prompt | `ml-service/.../prompts/pass1_form_generation.txt` | ✅ Emits `{title, fields[], photo_guidance}` |
| Backend Pass 1 trigger + readiness store | `grading.service.js` → `startFormGeneration` / `getForm` | ✅ In-memory `_formState` map |
| Backend Pass 1 routes | `grading.routes.js` → `POST/GET /api/grading/form/:itemId` | ✅ Exposed |
| Per-photo validation (OpenCV + CLIP subject match) | `ml-service/.../routers/vision.py` → `POST /vision/validate-photo` | ✅ Honors `expected_subject` |
| Full two-pass pipeline (fraud → analysis → Pass 2) | `grading.service.js` → `triggerGrading`, `routers/grading.py` → `POST /grade/` | ✅ Works |
| Generic fallback schema | both `form_generator.py` and `grading.service.js` | ✅ Duplicated (see improvement #6) |

### The gap — Pass 1 is orphaned
The live intake path **never touches Pass 1**:

```
initiateReturn / initiateFromOrder   (return.service.js / secondhand.service.js)
        │  captures reasonCode + reasonText, creates Item (status INITIATED)
        ▼
submitEvidence(userId, itemId, photos)
        │  just a flat photo array — no form, no field mapping
        ▼
itemService.attachEvidence(itemId, photos, actor)
        │  INITIATED → EVIDENCE_PENDING → GRADING
        ▼
gradingService.triggerGrading(...)   ← runs the WHOLE pipeline (fraud + analysis + Pass 2)
```

`startFormGeneration` / `getForm` are wired to routes but **no service calls them, and no
state transition depends on them.** The evidence form the user actually sees is a static
placeholder. That is the entire problem.

### Doc vs reality discrepancies to correct in v3.44
1. **Model:** docs say "Amazon Nova Pro / Bedrock"; code uses Gemini. → Document Gemini.
2. **Flow:** docs *describe* progressive dynamic forms but the integration was never done. → This doc does it.
3. **`expected_subject`:** `GradingRequest` carries it, `validate-photo` honors it, but the form fields' `expected_subject` is never threaded into per-photo validation at upload time. → Wire it (improvement #2).

---

## 2. Target Flow (what we're building)

```
┌─ STEP A — CLAIM ────────────────────────────────────────────────┐
│ User initiates return/sell-used.                                 │
│ Provides: reason (dropdown + free text), OPTIONALLY 1–2 photos   │
│ to explain the issue. Item created → status INITIATED.           │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ STEP B — DYNAMIC FORM GENERATION (Gemini Pass 1) ──────────────┐
│ Backend kicks off Pass 1 immediately on initiation, using:       │
│   • reasonText  • category  • catalog listing data               │
│   • the optional clarifying photo(s) (multimodal)                │
│ Gemini returns a Form_Schema tailored to THIS product + claim.   │
│ New item status: AWAITING_EVIDENCE (form pending → ready).       │
│ Generic fields show instantly; AI fields swap in on arrival.     │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ STEP C — TARGETED EVIDENCE CAPTURE ────────────────────────────┐
│ User fills the AI form: each field has an id, label, guidance,   │
│ and expected_subject. As each photo uploads → /vision/validate-  │
│ photo runs with THAT field's expected_subject (right part? sharp?)│
│ Inline feedback; user retakes before submitting.                 │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ STEP D — ANALYSIS ON ALL IMAGES (Pass 2 pipeline) ─────────────┐
│ On submit: INITIATED→EVIDENCE_PENDING→GRADING, then triggerGrading│
│ runs fraud preflight + parallel analysis + Gemini Pass 2 over    │
│ EVERY provided image (clarifying + all field photos), with the   │
│ field→image mapping carried into the Analysis_Summary so Pass 2  │
│ knows which photo answers which question.                        │
└──────────────────────────────────────────────────────────────────┘
```

The difference from today: **Step B is inserted and made mandatory**, Step C maps uploads
to named fields (not a flat array), and the field/claim structure flows all the way into Pass 2.

---

## 3. AI Tool Decision — Gemini for Pass 1 (with rationale)

**Decision: keep Gemini as the form generator. Do not reintroduce Bedrock for this.**

| Why Gemini works for dynamic forms | Detail |
|---|---|
| Multimodal | Accepts the optional clarifying photo(s) as inline parts, so the form can react to what it *sees*, not just the text claim. |
| Native JSON mode | `response_mime_type=application/json` → deterministic `Form_Schema`, low parse-failure rate. |
| Already integrated + traced | `gemini.py` has retry, fallback, full prompt/response tracing into the dev-log sidebar. Zero new infra. |
| Cheap + fast | `flash` tier is well under the latency budget; Pass 1 is cached by `hash(productId+reason)` so repeat claims cost nothing. |

**Provider abstraction (improvement #1):** the rest of the pipeline only depends on
`invoke_json()` / `GeminiError`. We keep that seam clean so a future swap (back to Bedrock
Nova, or to a cheaper text model for Pass 2) is a one-file change. We document Gemini as the
current provider but do **not** hard-couple business logic to it.

---

## 4. Suggested Improvements (beyond just wiring it up)

These are the "smart and robust" pieces you asked for. Ranked by leverage.

1. **Provider seam stays explicit.** One `llm_provider` indirection so model choice is config,
   not code. Reconcile the docs to Gemini but keep the door open.

2. **Thread `expected_subject` from form field → upload validation.** Right now the form
   *can* declare `expected_subject` per field but the upload validator is never called with it
   in the real flow. Wire each field's `expected_subject` into `/vision/validate-photo` so
   "you photographed the box, not the sole" feedback actually fires. This is the single
   biggest quality win for cheap.

3. **Field→image mapping into Pass 2.** Stop sending a flat photo array. Submit
   `{ fieldId → [imageUrls] }` so the Analysis_Summary (and Pass 2 rationale) can say
   "sole_photo shows heavy wear" instead of "image 3 shows wear." Makes grades explainable
   and dispute-proof.

4. **Persist the Form_Schema on the Item, not just an in-memory map.** `_formState` is a
   process-local `Map` — it evaporates on restart and breaks across multiple backend
   instances. Store the generated schema + readiness on the Item (or a small `evidenceForm`
   sub-doc) so it survives restarts and is the source of truth for the status page and
   the Evidence_Bundle.

5. **Make the form a real state-machine stop.** Add an explicit `AWAITING_EVIDENCE` state
   (or reuse `EVIDENCE_PENDING` with a `formReady` flag) between `INITIATED` and `GRADING`,
   so the flow *cannot* skip the dynamic form. Today nothing enforces it.

6. **De-duplicate the generic fallback schema.** It's defined twice (ml-service
   `_generic_default_schema` and backend `GENERIC_FORM_FIELDS`) and they've already drifted
   (backend lacks the `label_photo` field). Single source: ml-service owns it, backend reads
   it via the Pass 1 response. One schema, one shape.

7. **Required-field gating on submit.** Validate that every `required:true` field has at
   least one uploaded image before allowing `submitEvidence`, with a clear list of what's
   missing. Prevents half-empty submissions that waste a Pass 2 call and land in human review.

8. **Cache key hardening.** Current key is `hash(productId + normalized_reason)`. Two issues:
   (a) for "I bought it elsewhere" there's no catalog `productId` — fall back to
   `hash(category + normalized_reason)`; (b) normalize aggressively (lowercase, trim, collapse
   whitespace, strip punctuation) so "Too tight!" and "too tight" share a schema.

9. **Schema versioning + sane field caps.** Stamp `schemaVersion` and clamp Gemini to a
   reasonable field count (e.g. ≤ 8 photos) so a hallucinated 30-field form can't wreck the UX.

10. **Seller custom prompt hook (from the existing TODO).** Leave a documented insertion
    point for a seller-supplied category/product prompt overlay (base → category → seller-custom).
    Not built in v3.44, but the prompt_loader composition should reserve the slot.

---

## 5. Implementation Plan

Ordered, dependency-correct. Each task names the files it touches. **No Phase 1 state-machine
ownership is violated — we extend it, coordinating the one new state.**

### Task 1 — Persist the evidence form on the Item (improvement #4, #5)
- Add an `evidenceForm` sub-document to `item.model.js`:
  `{ status: 'none'|'pending'|'ready'|'fallback', schema: Mixed, schemaVersion, generatedAt, provider }`.
- Add state `AWAITING_EVIDENCE` to `ITEM_STATUSES` and to `ALLOWED_TRANSITIONS`
  (`INITIATED → AWAITING_EVIDENCE → EVIDENCE_PENDING → GRADING`).
- Migrate `getForm`/`startFormGeneration` in `grading.service.js` to read/write the Item
  instead of the in-memory `_formState` map (keep the map only as a fast cache, not source of truth).

### Task 2 — Trigger Pass 1 at initiation (the core wiring)
- In `return.service.js#initiateReturn` and `secondhand.service.js#initiateFromOrder`,
  after the Item is created, fire-and-forget `gradingService.startFormGeneration(itemId, {...})`
  with `productId, reasonText, category, initialPhotos`.
- Transition `INITIATED → AWAITING_EVIDENCE`.
- Accept the optional clarifying photo(s) at initiation (new optional `clarifyingPhotos` field
  on the initiate payloads) and pass them as `initial_photos` to Pass 1 (multimodal context).

### Task 3 — Optional clarifying-photo capture at claim step
- Extend the initiate request validation + controllers to accept 0–2 `clarifyingPhotos`
  (S3 URLs from the existing pre-signed upload utility).
- Store them on the Item (e.g. `clarifyingPhotos[]`) and merge into `evidencePhotos`
  at grading time so Pass 2 sees them too.

### Task 4 — Frontend: claim → dynamic form → capture
- **Claim screen:** reason dropdown + free text + optional "add a photo to explain" uploader.
- **Evidence screen:** poll `GET /api/grading/form/:itemId`; render generic fields immediately,
  swap to AI schema on `ready`. Render each field by `type` (photo/text/boolean/select) using
  `label` + `guidance`.
- **Per-upload validation:** on each photo upload, call `/vision/validate-photo` with the
  field's `expected_subject`; show inline issues (`blurry`, `dark`, `wrong_subject`) and allow retake.

### Task 5 — Field→image mapping through submit and into Pass 2 (improvement #3)
- Change `submitEvidence` (both services) to accept `{ fieldId: [imageUrls] }` instead of a flat
  array (accept the flat array too, for backward compatibility / standalone testing).
- `attachEvidence` stores the mapping on the Item and passes it through `triggerGrading`.
- In the ml-service, carry the mapping into `GradingRequest` and surface it in the
  `Analysis_Summary` so Pass 2's prompt can reference fields by name.

### Task 6 — Required-field gating (improvement #7)
- Before `attachEvidence` flips to `GRADING`, validate all `required:true` fields are satisfied
  against the persisted schema; return a 400 with the missing field labels if not.

### Task 7 — Schema fallback de-dup + cache hardening (improvements #6, #8, #9)
- Delete `GENERIC_FORM_FIELDS` from the backend; always source the generic schema from the
  Pass 1 response (`generic_default` status).
- Update `cache_key` to fall back to `category` when `productId` is absent; strengthen
  normalization; add `schemaVersion` + a field-count clamp in `form_generator.py`.

### Task 8 — Prompt + provider polish (improvements #1, #10)
- Reconcile prompt docs to Gemini; reserve the seller-custom prompt slot in `prompt_loader.compose`.
- Confirm the `llm_provider` seam: business logic depends only on `invoke_json`/typed errors.

### Task 9 — Tests
- **PBT / unit:** cache-key determinism & category fallback; schema shape validation;
  required-field gating; field→image mapping round-trips into the summary; fallback schema is
  served on Gemini failure; `AWAITING_EVIDENCE` transition legality.
- **Integration:** one run per persona (Priya→C shoes, Rahul→B baby monitor, Anjali→A DSLR)
  proving the form is product/claim-specific and the grade references named fields.

---

## 6. Execution Order

```
Task 1 (persist form + state) ─► Task 2 (trigger Pass 1 at init) ─► Task 4 (frontend form)
        │                                                               │
        ├─► Task 3 (clarifying photos) ────────────────────────────────┤
        │                                                               ▼
        └─► Task 5 (field→image mapping) ─► Task 6 (required gating) ─► Task 9 (tests)
Task 7 (fallback/cache) and Task 8 (prompt/provider) can run in parallel anytime after Task 1.
```

**Critical path:** Task 1 → Task 2 → Task 4 → Task 5 → Task 6 → Task 9.

---

## 7. Phase 1 Boundary (don't break the merge)

v3.44 touches files Phase 1 owns (`item.model.js`, `item.service.js`, the intake services).
That's unavoidable because the dynamic form *is* an intake-flow change. Coordinate explicitly:

- The **one new state** (`AWAITING_EVIDENCE`) and the `evidenceForm` sub-doc are the only schema
  additions — additive, no renames, no removals.
- The lifecycle event writer stays Phase 1's; we only call `appendEvent` through the existing
  interface for the new transition.
- `triggerGrading`'s existing `triggerGrading(itemId, { evidencePhotos, category, originalProductId })`
  contract is preserved; the field→image mapping is an *additive* optional argument.

---

## 8. Definition of Done

1. ✅ Initiating a return/sell-used immediately kicks off Gemini Pass 1; the item enters
   `AWAITING_EVIDENCE`.
2. ✅ The user is shown a **product- and claim-specific** form (generic instant → AI swap),
   not a static placeholder.
3. ✅ Optional clarifying photo(s) at the claim step feed Pass 1 (multimodal) and Pass 2.
4. ✅ Each photo upload validates against its field's `expected_subject` with inline feedback.
5. ✅ Submit is gated on required fields; uploads are mapped field→image and that mapping
   reaches Pass 2's Analysis_Summary.
6. ✅ The generated schema is persisted on the Item (survives restart); the in-memory map is
   only a cache.
7. ✅ One generic fallback schema, sourced from the ml-service; cache key handles the
   no-catalog-product case.
8. ✅ Docs reconciled: Gemini is the documented Pass 1 provider; provider seam intact.
9. ✅ Persona integration runs prove the form differs by product/claim and the grade rationale
   references named fields.
10. ✅ No Phase 1 renames/removals; the branch merges with only additive schema changes.

---

## Implementation Status (change log)

All 10 improvements are implemented. The dynamic form is now the spine of intake:
`claim (+ optional clarifying photo)` → **Gemini Pass 1 tailored form** (state
`AWAITING_EVIDENCE`) → targeted, per-field, validated capture → analysis on all images
with a field→image map carried into Pass 2.

### ML service (Python)
- `services/ttl_cache.py` — `cache_key(product_id, reason, category)` now falls back to
  `category` when there's no catalog product; `normalize_reason` strips punctuation so
  "Too tight!" == "too tight" (improvement #8).
- `services/prompt_loader.py` — `compose(..., seller_prompt=None)` reserves the
  seller-custom prompt slot: base → category → seller-custom → body (improvement #10).
- `prompts/pass1_form_generation.txt` — emits `expected_subject` per photo field, caps at
  8 photo fields, reacts to clarifying photos (improvements #2/#9).
- `services/form_generator.py` — `SCHEMA_VERSION`, `_normalize_schema` (clamp + backfill
  expected_subject), category-aware cache key, single source of the generic schema
  (improvements #2/#6/#9). `generate_form` accepts `seller_prompt`.
- `models/schemas.py` — `GradingRequest.field_images`, `FormRequest.product_id` optional +
  `seller_prompt`.
- `services/analysis_orchestrator.py` — `run_analysis(..., field_images=...)` surfaces
  `field_images`/`evidence_fields` in the Analysis_Summary (improvement #3).
- `routers/grading.py` — threads `seller_prompt`, `field_images`, hardened cache lookup.
- `prompts/pass2_grade_synthesis.txt` — instructs Pass 2 to reference findings by named
  field and put the field name in each defect's `location`.

### Backend (Node)
- `modules/items/item.model.js` — new `AWAITING_EVIDENCE` status; persisted `evidenceForm`
  sub-doc (status/schema/version/source/provider/generatedAt); `clarifyingPhotos`;
  `evidenceFieldImages` (improvements #4/#5).
- `modules/items/item.service.js` — `AWAITING_EVIDENCE` transitions; new
  `requestEvidenceForm()` (fires Pass 1 at claim step, moves to AWAITING_EVIDENCE);
  `attachEvidence(..., { fieldImages })` with required-field gating (improvement #7),
  merges clarifying photos into the grading payload, passes `fieldImages` through.
  Status endpoint now returns `evidenceForm` + `clarifyingPhotos`.
- `modules/grading/grading.service.js` — form schema persisted to the Item (source of
  truth) with the in-memory map as a cache; generic schema sourced from the ML response
  (no duplicate copy — improvement #6); `fieldImages` forwarded to ML; new `validatePhoto`
  proxy. `getForm` is now async (reads Item on cache miss).
- `modules/grading/{controller,routes}.js` — `await getForm`; new
  `POST /api/grading/validate-photo`.
- `modules/returns/*`, `modules/secondhand/*` — initiate accepts `clarifyingPhotos` and
  fires `requestEvidenceForm`; `submitEvidence(..., fieldImages)`; controllers surface the
  400 missing-required-fields error.
- `contracts/lifecycleEvent.contract.js` — added `AWAITING_EVIDENCE` event type (additive).

### Frontend (React)
- `services/item.service.js` — `getEvidenceForm`, `validateEvidencePhoto`.
- `services/return.service.js`, `services/secondhand.service.js` — `clarifyingPhotos` on
  initiate, `fieldImages` on submit.
- `pages/ItemEvidencePage.jsx` — full rewrite: polls the dynamic form (generic instant →
  AI swap), renders each field by type, uploads per field, runs inline per-photo validation
  against `expected_subject`, gates required fields, submits the field→image map.
- `components/shared/DeveloperLogsSidebar.jsx` — healthy-cycle reference + failure footnote
  updated to Gemini and the new dynamic-form / field-map steps (keeps the sidebar aligned
  with the real pipeline; see `Meta/DevTools/DeveloperLogsSidebar.md`).

### Developer-logs alignment
New step keys flow through the existing logger/trace plumbing and render correctly:
- `STATUS_UPDATE → AWAITING_EVIDENCE` (server, phase `pass1`).
- `EVIDENCE_INCOMPLETE` (server, phase `evidence`, level `warn`) — required-field gate.
- `ANALYSIS_FIELD_MAP` (ML trace, phase `analysis`) — field→image mapping.
- `PASS1_*` now report `gemini` provider and `expected_subject`-bearing schemas.

### Tests
- ML suite: 20 passing (added cache category-fallback, punctuation normalization, schema
  clamp/backfill, generic-schema expected_subject, field_images surfacing).
- Backend grading validation: 8 passing.

### Follow-ups (not blocking)
- Wire a real seller-supplied prompt into `compose(..., seller_prompt)` when the seller
  custom-grader UI lands (slot is ready).
- Optionally persist text-field answers into the Evidence_Bundle for provenance.
