# Implementation Plan: Dynamic Stepper Evidence Grading

## Overview

This plan reworks the Phase 2 evidence flow into a structured, multi-step, context-aware verification & grading flow built additively on the live pipeline. Work is sequenced **contract-first**: the ML `Form_Schema` aspect/step shape and inspection contract are established before the inspector enforces them, before the backend threads context and tracks verification, before the frontend renders steps. Three tracks (ML service / Python, backend / Node, frontend / React) progress in parallel where dependencies allow.

Languages and test libraries follow the design:
- ML service pure logic — `hypothesis` (Python), minimum 100 iterations.
- Backend and frontend pure logic — `fast-check` (Node), minimum 100 iterations.
- Each property test is tagged: `# Feature: dynamic-stepper-evidence-grading, Property {n}: {property_text}` (Python) / `// ...` (Node).
- Each of Properties 1–11 is implemented by exactly one property-based test.

## Tasks

- [x] 1. ML service — aspect-model schema foundations
  - [x] 1.1 Define the structured aspect/step shape and bump `schemaVersion` to 3 in `ml-service/app/services/form_generator.py`
    - Document the field `aspects[]` shape (`id`, `kind`, `verifiability`, `importance`, `detail_level`, `expected_subject`, `required_views`, `validation_criteria`) and the `steps[]` layer (`id`, `title`, `purpose`, `fields[]`)
    - Set `SCHEMA_VERSION = 3`; keep flat `fields[]` accepted as input
    - _Requirements: 1.1, 1.4_

  - [x] 1.2 Extend `_normalize_schema` to backfill, clamp, and assemble steps in `form_generator.py`
    - Backfill missing aspect attributes with safe defaults (`kind=region`, `verifiability=photo`, `importance=standard`, `detail_level=normal`, `expected_subject` from label, `required_views=[expected_subject]`, `validation_criteria`)
    - Clamp photo/video field count to `MAX_PHOTO_FIELDS`; stamp `schemaVersion`
    - Assemble `steps[]` when only `fields[]` returned (group by emitted `step` hint, else single step); de-duplicate aspects whose `(kind, normalized expected_subject)` already appeared
    - Resolve `capture_mode`: `text` when all aspects `verifiability=none`, honor explicit `video`, else `photo`
    - _Requirements: 1.3, 1.4, 5.1, 5.3, 6.1, 6.2, 6.6_

  - [x]* 1.3 Write property test for aspect normalization (`hypothesis`)
    - **Property 1: Aspect normalization yields complete, valid aspects**
    - Generate well-formed/partial/missing-attribute schemas; assert every photo/video field has ≥1 aspect, every aspect has valid enums + non-empty `expected_subject` + `required_views`, field count ≤ `MAX_PHOTO_FIELDS`, `schemaVersion` stamped
    - **Validates: Requirements 1.1, 1.3, 1.4**

  - [x]* 1.4 Write property test for capture-mode assignment (`hypothesis`)
    - **Property 3: Capture-mode assignment respects verifiability**
    - Generate fields with varying aspect verifiabilities; assert all-`none` ⇒ `capture_mode=text` and a `text` field carries no media requirement
    - **Validates: Requirements 5.1, 5.3**

  - [x]* 1.5 Write property test for step composition (`hypothesis`)
    - **Property 8: Step composition is ordered and de-duplicated**
    - Generate schemas with overlapping aspects across fields; assert ordered non-empty steps, no `(kind, expected_subject)` aspect duplicated across fields, and a step-less schema becomes exactly one implicit step
    - **Validates: Requirements 6.1, 6.2, 6.6, 16.4**

- [x] 2. ML service — Pass 1 prompt rewrite
  - [x] 2.1 Rewrite `ml-service/app/prompts/pass1_form_generation.txt` to emit steps + aspects
    - Emit ordered steps composed from identity/overall (base), category checks, reason-specific defect
    - Emit explicit `required_views` per angle/region aspect using precise terms (forbid "sides")
    - Mark non-photo-verifiable claims `verifiability=none` and prefer `capture_mode=text`; emit no fit-verification aspect for fit/size reasons (condition aspects only)
    - Weight `importance` by the stated reason; mark clarifying-photo-satisfied aspects `satisfied: true`
    - Prefer `capture_mode=video` when one short video covers multiple `required_views`; state pan instructions in guidance
    - _Requirements: 1.6, 3.1, 3.5, 5.1, 5.2, 5.4, 5.5, 8.1, 8.2_

  - [x] 2.2 Pass trust/value/context into Pass 1 in `form_generator.generate_form` and `FormRequest`
    - Add optional `trust_tier`, `item_value` to `FormRequest` (`schemas.py`); thread into the prompt; scale aspect count/strictness by value + trust
    - _Requirements: 6.5, 8.5_

- [x] 3. ML service — inspector enforces declared aspects
  - [x] 3.1 Extend `FieldInspectionRequest` in `ml-service/app/models/schemas.py`
    - Add optional `aspects`, `required_views`, `sibling_fields`, `capture_mode`, `detail_level`
    - Add optional `liveness`, `flagged_cells` to `FieldInspectionResponse`
    - _Requirements: 2.1, 2.4_

  - [x] 3.2 Rewrite `ml-service/app/prompts/evidence_inspection.txt` for declared-scope enforcement
    - Constrain `missing_views` to a subset of `required_views`; forbid inventing any view not declared; out-of-scope concerns go to `observations` only
    - List `sibling_fields` so the model does not demand evidence another field covers
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 3.3 Enforce scope deterministically in `evidence_inspector.inspect_field`
    - After the LLM call, filter `missing_views` to the declared `required_views`; if the only rejection cause is a missing view and the filtered set is empty, mark `accepted=true` and clear `reupload_reason`
    - Thread `sibling_fields`/`aspects` into the prompt; preserve accept-with-warning on LLM failure and the phash short-circuit
    - _Requirements: 2.1, 2.2, 2.3, 2.6_

  - [x]* 3.4 Write property test for view-scope enforcement (`hypothesis`)
    - **Property 2: Inspector never reports an undeclared missing view**
    - Generate declared `required_views` + arbitrary raw inspector outputs; assert normalized `missing_views ⊆ required_views`, and a missing-view-only rejection with empty filtered set becomes accepted
    - **Validates: Requirements 2.1, 2.2, 2.3**

- [x] 4. ML service — video frame selection + liveness
  - [x] 4.1 Create `ml-service/app/services/video_frame_selector.py`
    - `extract_frames(video_bytes, fps)` via `cv2.VideoCapture`; reuse `opencv_utils` blur/brightness scoring
    - `phash_diversify(frames, max_n)` using `imagehash` to drop near-duplicates; discard blur/exposure failures; cap at `max_frames`
    - Keep frames for `detail_level=high` aspects full-resolution
    - `phash_continuity(frames)` — deterministic, LLM-free liveness classification; flag hard discontinuities
    - _Requirements: 9.1, 9.2, 9.3, 9.5, 11.1, 11.3, 11.4_

  - [x] 4.2 Reuse catalog phash theft check for video frames
    - Run the existing `fraud_preflight` catalog phash against selected frames; raise the HARD stock-photo signal on match
    - _Requirements: 11.2_

  - [x]* 4.3 Write property test for frame selection (`hypothesis`)
    - **Property 6: Frame selection bounds, quality, and diversity**
    - Generate candidate frame sets; assert no blur/exposure failure retained, no two selected within the phash duplicate threshold, size ≤ `max_frames`, and high-detail frames kept full-res
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.5**

  - [x]* 4.4 Write property test for liveness determinism (`hypothesis`)
    - **Property 11: Video liveness signals are deterministic and LLM-free**
    - Generate ordered frame sequences; assert `phash_continuity` is stable across repeated runs with no LLM call, and a hard-discontinuity sequence is flagged
    - **Validates: Requirements 11.1, 11.3, 11.4**

- [ ] 5. ML service — montage triage path
  - [-] 5.1 Add montage tiling + two-pass inspection to `evidence_inspector.inspect_field`
    - Accept a `montage` flag; when on, build a low-res contact sheet (`montage_utils.tile`), one overview call returning `flagged_cells`, then a full-res follow-up only for flagged frames
    - Exclude `detail_level=high` aspects from the low-res montage (always full-res); when off, single full-res pass, no montage
    - Log the video-inspection mode per call
    - _Requirements: 10.3, 10.4, 10.5, 10.6_

  - [x]* 5.2 Write property test for montage fidelity (`hypothesis`)
    - **Property 7: Montage mode preserves high-detail fidelity**
    - Generate fields with mixed `detail_level`; assert montage-on keeps every `detail_level=high` aspect full-res and out of the low-res montage, and montage-off produces no montage pass
    - **Validates: Requirements 10.3, 10.4, 10.5**

- [ ] 6. ML service — Pass 2 honesty + template overrides
  - [ ] 6.1 Surface aspects/verifiability in the Analysis_Summary and Pass-2 prompt
    - Extend `build_analysis_summary` to carry each field's aspects + `verifiability`
    - Update `pass2_grade_synthesis.txt` to record "cannot be determined from the provided media" for material `verifiability=none` claims instead of a confident grade; keep the canonical Grade JSON contract
    - _Requirements: 3.3, 16.2_

  - [ ] 6.2 Add template-override plumbing across ML schemas and `prompt_loader`
    - Add optional `pass1_template`, `pass2_template`, `inspection_template`, `montage_template` to `FormRequest`/`GradingRequest`/`FieldInspectionRequest`
    - `prompt_loader.load_template` prefers a supplied override over the bundled file
    - _Requirements: 14.2, 14.3_

  - [x]* 6.3 Write property test for grade contract preservation (`hypothesis`)
    - **Property 10: Grade contract preserved across the rework**
    - Target `grade_validation.coerce_and_validate` with arbitrary/garbage summaries including `verifiability=none`; assert `grade ∈ {A,B,C,D}`, `confidence ∈ {high,medium,low}`, `routingHint ∈ {resell,refurbish,donate,liquidate}`, `0 ≤ qualityScore ≤ 100`, `0.0 ≤ estimatedResalePct ≤ 1.0`, defect severities valid
    - **Validates: Requirements 16.2, 16.3, 16.5**

  - [x]* 6.4 Write unit/regression tests for ML behavior
    - Side-body reason → that field's `required_views` excludes front/back (original bug regression guard)
    - Apparel fit reason → condition aspects present, no fit-verification aspect; texture aspects `detail_level=high`; `tags_label` critical aspect present
    - _Requirements: 2, 3.5, 12.1, 12.4_

- [ ] 7. Checkpoint — ML service
  - Ensure all ML-service tests pass; ask the user if questions arise.

- [x] 8. Backend — prompt template scope
  - [x] 8.1 Extend `PromptConfig` and `prompt.service.js` for the `template` scope
    - Add `'template'` to the `scope` enum (`prompt.model.js`); keys `pass1_form`, `pass2_synthesis`, `evidence_inspection`, `montage`
    - Add shipped defaults + `listPrompts` returning base + categories + templates with effective content; `upsertPrompt` rejects empty/unreadable saves and retains prior content
    - _Requirements: 13.1, 14.1, 14.4, 14.5_

  - [x] 8.2 Resolve and thread template overrides in `_resolvePrompts` / `grading.service.js`
    - Resolve template overrides from `PromptConfig` and include them in `/form`, `/grade/`, and `/vision/inspect-field` request bodies; log when an admin-edited asset is applied
    - _Requirements: 14.2, 15.4_

  - [x]* 8.3 Write property test for prompt-asset resolution (`fast-check`)
    - **Property 9: Prompt-asset resolution precedence**
    - Generate present/absent DB override × present/absent file for base/category/template; assert effective content is the DB override when non-empty else file/default, and an empty/unreadable save is rejected leaving prior content unchanged
    - **Validates: Requirements 13.1, 13.3, 14.2, 14.3, 14.5**

- [x] 9. Backend — item model + verification/routing
  - [x] 9.1 Add additive fields to `backend/src/modules/items/item.model.js`
    - `evidenceForm.fieldState` (Mixed: per-field `verifyAttempts`, `status`, `highestImportance`), `needsHumanReview` (Boolean), `humanReviewReasons` (String[]), `videoEvidence` (Mixed)
    - Extend `evidenceFragments` with optional `aspects`, `captureMode`, `liveness`; preserve all existing fields
    - _Requirements: 16.3, 16.5_

  - [x] 9.2 Track verify attempts + two-attempt pass-through in `grading.service.verifyField`
    - Increment `evidenceForm.fieldState[fieldId].verifyAttempts`; on the 2nd failed verify mark `status='unverified'` and allow pass-through
    - Thread `aspects`/`required_views`/`sibling_fields`/`capture_mode` into the `/vision/inspect-field` body; persist `liveness` onto the fragment
    - _Requirements: 4.1, 2.4_

  - [x] 9.3 Implement importance-based human-review routing in `item.service`
    - Passed-through field with highest importance `critical` → set `needsHumanReview` + reason; `minor` → proceed silently
    - Any material `verifiability=none` aspect → set `needsHumanReview` immediately (no attempts)
    - At submit, a required field with uploads but no successful verify → one inline verify before the rule; a required field with no evidence → block submit naming the field
    - Carry `needsHumanReview` into `triggerGrading` → persist via `flaggedForReview`/`reviewReason`; emit routing signal
    - _Requirements: 3.4, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x]* 9.4 Write property test for pass-through + routing (`fast-check`)
    - **Property 4: Two-attempt pass-through and importance routing**
    - Generate verify-outcome sequences + importance/verifiability configs; assert pass-through after exactly two failures, and human-review set iff (passed-through critical) OR (material `verifiability=none`, without requiring two attempts)
    - **Validates: Requirements 3.4, 4.1, 4.2, 4.3, 4.4**

  - [x]* 9.5 Write property test for the submit gate (`fast-check`)
    - **Property 5: Required-field submit gate**
    - Generate form states; assert submission blocked iff some required field has no evidence, and a required field with evidence but no successful verify triggers exactly one inline verify before pass-through
    - **Validates: Requirements 4.5, 4.6**

- [ ] 10. Backend — context threading + video/montage
  - [x] 10.1 Thread trust tier, item value, and clarifying photos into `startFormGeneration`
    - Resolve trust tier (snapshot) and item value; pass `trust_tier`/`item_value` to the ML `/form` body; continue passing clarifying photos
    - _Requirements: 6.5, 8.2, 8.5_

  - [ ] 10.2 Accept video frame sets and the montage flag on verify/evidence paths
    - Accept client-extracted frame URLs for `capture_mode=video` fields (reuse the S3 upload + fragment path); forward the `montage` flag from the request into `/vision/inspect-field`
    - _Requirements: 9.4, 10.3_

- [ ] 11. Checkpoint — backend
  - Ensure all backend tests pass; ask the user if questions arise.

- [ ] 12. Frontend — stepper flow + capture modes
  - [ ] 12.1 Create the `EvidenceStepper` component
    - Evenly spaced horizontal `1—…—N` bar; highlight current step; distinguish complete vs upcoming; update on navigation and on dynamic step-count change
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ] 12.2 Refactor `frontend/src/pages/ItemEvidencePage.jsx` into a step machine
    - Poll the dynamic form; render the current step's fields by `capture_mode` (video recorder / photo uploader / text input); keep per-field Verify inside the step
    - Gate "Next" on the step's required fields being verified or passed-through; name the incomplete field; allow revisiting completed steps; append follow-up fields dynamically
    - Render a schema without `steps` as a single implicit step
    - _Requirements: 5.4, 6.3, 6.4, 6.6, 6.7, 7.5, 16.4_

  - [ ] 12.3 Add client-side video frame extraction
    - Capture/record video, sample frames via `<canvas>`, upload selected JPEGs through the existing evidence upload path
    - _Requirements: 9.1, 9.4_

  - [x]* 12.4 Write unit tests for the stepper + gating
    - Stepper highlights current/complete/upcoming; "Next" disabled while a required field is unsatisfied and names it; step-less schema renders one step
    - _Requirements: 6.4, 6.6, 7.1, 7.2_

- [ ] 13. Frontend — montage toggle
  - [ ] 13.1 Add `getMontageMode` to `frontend/src/services/dev.service.js`
    - Export `getMontageMode()` returning `true` iff `localStorage.getItem('dev_montage_triage') === 'true'` (default off); share the key constant; include the flag in verify requests
    - _Requirements: 10.2_

  - [ ] 13.2 Add the montage toggle to `frontend/src/components/shared/DeveloperLogsSidebar.jsx`
    - Labeled switch using the existing localStorage pattern; init from `dev_montage_triage` (default off); persist on toggle
    - _Requirements: 10.1, 10.2_

  - [x]* 13.3 Write unit test for montage toggle mapping
    - Toggle persists `'true'`/`'false'`; `getMontageMode()` maps correctly; defaults off
    - _Requirements: 10.1, 10.2_

- [ ] 14. Frontend — admin prompt & template console
  - [ ] 14.1 Build the admin Prompt Console page
    - List every Prompt_Asset (base, each category, the four templates) with current effective content, an editor, save, and reset, using the extended `/api/prompts` endpoints; admin-gated
    - _Requirements: 14.1, 14.4, 14.6_

- [ ] 15. Integration and final checkpoint
  - [x]* 15.1 Write integration/smoke tests
    - Montage toggle on → `inspect_field` runs the two-pass path and logs the mode; off → single full-res pass
    - Client-extracted video frames flow through S3 + `inspect_field` and synthesize a grade
    - Admin edits the `pass1_form` template → next form generation uses it and logs the applied asset
    - Legacy flat `fields[]` schema renders as one step and grades end-to-end
    - _Requirements: 9, 10, 14.2, 15.4, 16.4_

  - [ ] 15.2 Final checkpoint — ensure all tests pass
    - Ensure all tests pass; ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; they will not be auto-implemented.
- Each task references the specific requirements (and, for property tests, the design property) it implements for traceability.
- PBT scope: Gemini, AWS, network, and React rendering are mocked/out of scope; property tests target the pure logic layer (schema normalization, view-scope enforcement, capture-mode/attempt/routing decisions, frame selection/diversity, step de-dup, prompt resolution, liveness, grade coercion).
- Property tests run a minimum of 100 iterations and are tagged `Feature: dynamic-stepper-evidence-grading, Property {n}: ...`.
- All new persisted fields, schema fields, and payload fields are optional/defaulted, preserving backward compatibility (Requirement 16). Legacy flat schemas render as a single implicit step; legacy fragments still synthesize.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1", "4.1", "8.1", "9.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.2", "4.2", "4.3", "4.4", "8.2", "9.2"] },
    { "id": 2, "tasks": ["1.3", "1.4", "1.5", "2.2", "3.3", "5.1", "8.3", "9.3", "10.1"] },
    { "id": 3, "tasks": ["3.4", "5.2", "6.1", "6.2", "9.4", "9.5", "10.2"] },
    { "id": 4, "tasks": ["6.3", "6.4", "12.1", "13.1"] },
    { "id": 5, "tasks": ["12.2", "12.3", "13.2", "14.1"] },
    { "id": 6, "tasks": ["12.4", "13.3", "15.1"] },
    { "id": 7, "tasks": ["15.2"] }
  ]
}
```
