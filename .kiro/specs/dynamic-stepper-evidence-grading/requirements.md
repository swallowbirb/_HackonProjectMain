# Requirements Document

## Introduction

This feature reworks the Phase 2 dynamic evidence form into a **flexible, robust, context-aware multi-step verification & grading flow**. It replaces the current flat, free-text-inferred field form (which over-asks, under-explains, and is poorly suited to the dominant return category — clothing) with a structured model that the AI generates but the inspector strictly enforces.

The rework spans five themes plus three platform-level asks:

1. **Structured inspection aspects** — every photo/evidence requirement becomes a typed aspect with an explicit `kind`, `verifiability`, `importance`, and `detail_level`, so the inspector enforces only what was declared and can no longer invent requirements (the root cause of the "Side Body Condition demands front/back" bug).
2. **Knowing its limits** — claims a camera cannot verify (internal/functional/odor/intermittent, or simply the user's accepted reason) are not photo-graded; they are captured where possible and routed to human/warehouse verification instead of receiving a fabricated grade.
3. **Never trapping the user** — after two failed verification attempts a field passes through, tagged; what happens next is decided by the aspect's importance (minor passes silently, critical passes but routes to human review).
4. **Efficiency-first capture** — the AI decides per aspect whether to request a short video (preferred where it captures more in one action), photos, or just a text answer, based on the reason and the product, and states that choice to the user in plain text.
5. **Clothing-aware inspection** — the dominant return mix gets first-class treatment: tags-attached anti-wardrobing anchor, wear-pattern aspects, fabric-aware checks, detail-preserving (full-res) texture inspection, color treated as a soft signal, drape coached not rejected, and fit/size accepted as a valid reason that needs no verification.

Platform asks:

6. **Dynamic multi-step flow** — the whole verification/grading process is laid out as ordered, dynamically generated steps with a horizontal progress stepper; each step groups only the aspects it needs.
7. **Admin prompt & template console** — every prompt and template sent to the LLM (base prompt, per-category prompts, the Pass-1 / Pass-2 / inspection templates, and the montage prompt) is visible and editable from the admin dashboard, DB-backed with file fallback.
8. **Two-pass montage toggle** — a Developer Tools toggle that switches video-frame inspection between full-resolution frames (fidelity-first default) and a two-pass montage triage (quota-saving).

This document is provider-neutral: the multimodal model is referred to as **Grading_LLM** regardless of vendor naming (the code currently calls Gemini).

## Glossary

- **Grading_Pipeline**: The end-to-end Phase 2 system spanning the backend orchestrator (`grading.service.js`, intake services) and the ML service (`ml-service/app/`).
- **Grading_LLM**: The multimodal large language model the pipeline calls (provider-neutral; currently Gemini).
- **Pass_1**: The form-generation stage that produces the tailored evidence schema.
- **Inspector**: The Pass-1.5 per-field evidence inspection stage (`evidence_inspector.py`) that judges whether an uploaded evidence set satisfies a field's requirement.
- **Pass_2**: The grade-synthesis stage that produces the canonical Grade JSON.
- **Form_Schema**: The structured evidence form produced by Pass_1 and rendered by the frontend.
- **Step**: A named, ordered group of one or more fields within a Form_Schema, presented as a single screen in the stepper. Steps are dynamically generated.
- **Field**: A single evidence requirement within a Step (e.g. "Tags & label", "Sole close-up").
- **Aspect**: The structured descriptor of what a photo/evidence field must capture, carrying `kind`, `verifiability`, `importance`, `detail_level`, and acceptance text. A field contains one or more aspects.
- **Aspect.kind**: One of `angle` (a geometric view), `region` (a specific area/feature), `label` (text/serial/size tag, OCR-verifiable), or `functional` (a behavioral/non-visual claim).
- **Aspect.verifiability**: One of `photo`, `ocr`, or `none` (cannot be confirmed from captured media).
- **Aspect.importance**: One of `critical`, `standard`, or `minor`.
- **Aspect.detail_level**: One of `high` (texture/defect detail; must not be downscaled or montaged) or `normal`.
- **Capture_Mode**: The evidence method chosen for a field: `video`, `photo`, or `text`.
- **Required_Views**: The explicit list of views/regions an aspect declares as necessary; the Inspector computes `missing_views` only against this list.
- **Verify_Action**: The user-triggered (or submit-time implicit) request that runs the Inspector over a field's evidence set.
- **Two_Attempt_Passthrough**: The rule that a field auto-passes (tagged `unverified`) after two failed Verify_Actions.
- **Frame_Selection**: The deterministic (non-LLM) process that extracts and selects the best diverse frames from an uploaded video.
- **Montage_Toggle**: The Developer Tools control switching video inspection between full-resolution frames and two-pass montage triage.
- **Montage_Triage**: A two-pass video-inspection mode: a low-resolution contact-sheet (grid) overview call, followed by full-resolution follow-up only on flagged regions.
- **Prompt_Asset**: Any text sent to the Grading_LLM that an admin can edit: the base prompt, a category prompt, a task template (Pass-1, Pass-2, inspection), or the montage prompt.
- **Admin_Prompt_Console**: The admin dashboard surface listing and editing all Prompt_Assets.
- **Human_Review_Route**: A routing outcome that sends an item to warehouse/human functional inspection rather than auto-grading.
- **Developer_Logs**: The live trace sidebar (`DeveloperLogsSidebar.jsx`) narrating pipeline steps.
- **Standard_Response**: The backend's standard response envelope used across modules.

## Requirements

### Requirement 1: Structured Inspection Aspects

**User Story:** As a platform operator, I want every evidence field to declare exactly what it requires as structured aspects, so that the inspection is precise per product and cannot drift into vague or contradictory demands.

#### Acceptance Criteria

1. WHEN Pass_1 generates a Form_Schema, THE Grading_Pipeline SHALL emit, for each photo/video field, one or more Aspects each carrying `kind`, `verifiability`, `importance`, `detail_level`, an `expected_subject`, and explicit `required_views`.
2. WHEN Pass_1 emits an Aspect of `kind` `angle` or `region`, THE Grading_Pipeline SHALL populate `required_views` with the specific views/regions that make the field complete.
3. IF Pass_1 returns a field missing any required Aspect attribute, THEN THE Grading_Pipeline SHALL backfill that attribute with a safe default (`kind=region`, `verifiability=photo`, `importance=standard`, `detail_level=normal`, `expected_subject` from the field label) before the schema is persisted.
4. THE Grading_Pipeline SHALL clamp the number of photo/video fields per Form_Schema to a configured maximum and SHALL stamp a `schemaVersion` on every generated Form_Schema.
5. WHERE listing data or reference images identify a specific product, THE Grading_Pipeline SHALL tailor Aspects to that product rather than to the category alone.
6. THE Grading_Pipeline SHALL ensure each field's label, guidance, `expected_subject`, and `required_views` describe a mutually consistent scope, and SHALL avoid overloaded view terms (e.g. "sides") in favor of precise terms (e.g. "left edge", "right edge").

### Requirement 2: Inspector Enforces Declared Aspects Only

**User Story:** As a returning customer, I want to be asked only for what the field actually says it needs, so that I am not rejected for failing to provide views that were never requested.

#### Acceptance Criteria

1. WHEN the Inspector evaluates a field's evidence set, THE Grading_Pipeline SHALL compute `missing_views` only against that field's declared `required_views`.
2. THE Inspector SHALL NOT reject a field for the absence of any view that is not present in that field's `required_views`.
3. WHEN the Inspector believes an out-of-scope view is relevant, THE Grading_Pipeline SHALL record it as an observation only and SHALL NOT add it to `missing_views` or use it as a rejection reason.
4. WHEN the Inspector evaluates a field, THE Grading_Pipeline SHALL provide the Inspector with the labels and `expected_subject` of sibling fields in the same Form_Schema so it does not demand evidence covered by another field.
5. WHEN the Inspector rejects a field, THE Grading_Pipeline SHALL produce a single field-level reupload instruction naming the specific missing `required_views`.
6. IF the Grading_LLM is unavailable during inspection, THEN THE Grading_Pipeline SHALL accept the field with a warning rather than block the user.

### Requirement 3: Verifiability and AI Limits

**User Story:** As a platform operator, I want the AI to admit when a claim cannot be verified from captured media, so that it routes those items to human inspection instead of fabricating a grade.

#### Acceptance Criteria

1. WHEN Pass_1 detects that the stated reason or a required check is not verifiable from photos or video (internal component failure, intermittent fault, odor, software behavior), THE Grading_Pipeline SHALL mark the corresponding Aspect `verifiability=none`.
2. WHERE an Aspect is `verifiability=none`, THE Grading_Pipeline SHALL NOT request media that purports to prove that claim, and SHALL instead request only the evidence that media can legitimately show (e.g. identity, exterior, a visible error message).
3. WHEN an item carries at least one `verifiability=none` Aspect that is material to the stated reason, THE Pass_2 stage SHALL record that the claim cannot be determined from the provided media rather than assigning a confident grade for that claim.
4. WHEN an item has a material `verifiability=none` claim, THE Grading_Pipeline SHALL emit a Human_Review_Route signal for that item.
5. WHERE the user's stated reason is fit/size (e.g. "too small", "did not fit"), THE Grading_Pipeline SHALL treat the reason as accepted and SHALL NOT generate any Aspect attempting to verify the fit claim, while still generating condition-grading Aspects for resale.

### Requirement 4: Importance-Based Gating and Two-Attempt Pass-Through

**User Story:** As a returning customer, I want to never get stuck on a field I cannot satisfy, while the platform still protects itself on the checks that matter.

#### Acceptance Criteria

1. WHEN a field has been the subject of two failed Verify_Actions, THE Grading_Pipeline SHALL allow the field to pass and SHALL tag it `unverified`.
2. WHERE a passed-through field's highest aspect importance is `minor`, THE Grading_Pipeline SHALL allow the flow to proceed with no further action.
3. WHERE a passed-through field's highest aspect importance is `critical`, THE Grading_Pipeline SHALL allow the flow to proceed AND SHALL emit a Human_Review_Route signal for the item.
4. WHERE an Aspect is `verifiability=none`, THE Grading_Pipeline SHALL apply the Human_Review_Route decision immediately without requiring two failed attempts.
5. WHEN the user reaches submit with a required field that has uploads but no successful verification, THE Grading_Pipeline SHALL run one inline Verify_Action before applying the Two_Attempt_Passthrough rule.
6. WHEN a required field has no evidence at all, THE Grading_Pipeline SHALL block submission and SHALL name the missing field.

### Requirement 5: Efficiency-First Capture Mode Selection

**User Story:** As a returning customer, I want each step to ask for the least effort that still proves the point, so that I can wave a short video where that captures everything or just answer a question where a photo is unnecessary.

#### Acceptance Criteria

1. WHEN Pass_1 generates a field, THE Grading_Pipeline SHALL assign a Capture_Mode of `video`, `photo`, or `text` based on the reason and the product.
2. WHERE a single short video can capture multiple `required_views` of a field in one action, THE Grading_Pipeline SHALL prefer Capture_Mode `video` for that field.
3. WHERE a claim or check can be satisfied by a written answer (a `verifiability=none` claim, a yes/no condition, a self-declared note), THE Grading_Pipeline SHALL prefer Capture_Mode `text` and SHALL NOT request media for it.
4. WHEN a field is assigned Capture_Mode `video`, THE Grading_Pipeline SHALL state in the field guidance, in plain language, what the user should pan across or show.
5. THE Grading_Pipeline SHALL ensure each step requests the minimum set of fields needed to satisfy that step's purpose, avoiding duplicate requests already satisfied by clarifying photos or earlier steps.

### Requirement 6: Dynamic Multi-Step Flow

**User Story:** As a returning customer, I want the verification laid out as a short sequence of clear steps rather than one long form, so that I always know what this step is for and how far I have to go.

#### Acceptance Criteria

1. WHEN Pass_1 generates a Form_Schema, THE Grading_Pipeline SHALL organize the fields into an ordered list of named Steps.
2. THE Grading_Pipeline SHALL compose Steps from base, category, and reason sources and SHALL de-duplicate aspects that overlap across those sources so the user is asked for each thing once.
3. WHEN a Step's required fields are all satisfied or passed-through, THE Grading_Pipeline SHALL allow advancement to the next Step.
4. WHILE a Step has an unsatisfied required field, THE Grading_Pipeline SHALL prevent advancement past that Step and SHALL indicate which field is incomplete.
5. THE Grading_Pipeline SHALL scale the number and strictness of Steps and fields by item value and customer trust tier, requesting more for high-value or low-trust cases and less for low-value or high-trust cases.
6. WHERE a Form_Schema has no explicit Steps (legacy or fallback schema), THE frontend SHALL treat the entire field list as a single implicit Step.
7. WHEN the Inspector surfaces a high-signal ambiguity during a Step, THE Grading_Pipeline MAY append at most one targeted follow-up field to that Step, subject to the per-schema field cap.

### Requirement 7: Step Progress Indicator (Stepper UI)

**User Story:** As a returning customer, I want a progress bar across the top showing the steps and where I am, so that the process feels bounded and clear.

#### Acceptance Criteria

1. THE frontend SHALL display a horizontal stepper showing each Step as an evenly spaced point in order.
2. THE frontend SHALL visually highlight the Step the user is currently on and distinguish completed Steps from upcoming Steps.
3. WHEN the user advances or returns between Steps, THE frontend SHALL update the highlighted current Step accordingly.
4. WHEN the number of Steps changes due to a dynamically appended follow-up field, THE frontend SHALL update the stepper to reflect the new Step count.
5. THE frontend SHALL allow returning to a previously completed Step to review or edit its evidence.

### Requirement 8: Context-Aware Form Generation

**User Story:** As a platform operator, I want the form shaped tightly by the specific reason, product, trust, and any clarifying media, so that it asks the few highest-signal things and nothing redundant.

#### Acceptance Criteria

1. WHEN Pass_1 generates the Form_Schema, THE Grading_Pipeline SHALL weight aspect importance by the stated reason, raising the importance of aspects directly related to the reason and lowering unrelated ones.
2. WHERE clarifying photos provided at claim time already show a required aspect clearly, THE Grading_Pipeline SHALL mark that aspect satisfied and SHALL NOT re-request it.
3. WHEN a product carries a serial/IMEI/size identifier, THE Grading_Pipeline SHALL include one identity-anchor Aspect of `kind=label` and `verifiability=ocr`.
4. WHEN the user self-declares a condition, THE Grading_Pipeline SHALL frame inspection as confirming or contradicting that declaration rather than grading from scratch, and SHALL record any contradiction as a signal.
5. THE Grading_Pipeline SHALL pass the resolved reason, category, listing data, trust tier, and item value into Pass_1 form generation.

### Requirement 9: Video Frame Selection

**User Story:** As a platform operator, I want uploaded videos reduced to a few good frames before any LLM call, so that video support costs no more LLM budget than photos while still capturing all angles.

#### Acceptance Criteria

1. WHEN a video is provided for a field, THE Grading_Pipeline SHALL extract candidate frames and select frames using deterministic, non-LLM checks for sharpness, exposure, and perceptual-hash diversity.
2. THE Grading_Pipeline SHALL cap the number of selected frames per field at a configured maximum.
3. WHEN frames are selected, THE Grading_Pipeline SHALL discard frames that are blurred, poorly exposed, or near-duplicates of an already selected frame.
4. WHILE the Montage_Toggle is off, THE Grading_Pipeline SHALL submit the selected frames to the Inspector at full resolution.
5. THE Grading_Pipeline SHALL preserve full resolution for any frame answering an Aspect with `detail_level=high` and SHALL NOT downscale or montage such frames.

### Requirement 10: Two-Pass Montage Toggle

**User Story:** As a developer running demos on a limited quota, I want to switch video inspection into a montage-triage mode, so that I spend detail tokens only where a problem might be.

#### Acceptance Criteria

1. THE Developer_Logs sidebar SHALL display a Montage_Toggle control whose state persists across sessions.
2. WHEN the Montage_Toggle mounts, THE frontend SHALL initialize it from persisted state, defaulting to off.
3. WHILE the Montage_Toggle is on, THE Grading_Pipeline SHALL run Montage_Triage: first a low-resolution contact-sheet overview call, then a full-resolution follow-up call only for regions the overview flagged.
4. WHILE the Montage_Toggle is on, THE Grading_Pipeline SHALL exclude any Aspect with `detail_level=high` from low-resolution montage and SHALL inspect it at full resolution.
5. WHILE the Montage_Toggle is off, THE Grading_Pipeline SHALL inspect selected frames directly at full resolution with no montage pass.
6. THE Grading_Pipeline SHALL record in the Developer_Logs which video-inspection mode ran for each Verify_Action.

### Requirement 11: Video Liveness and Anti-Fraud Signals

**User Story:** As a platform operator, I want cheap deterministic liveness signals from video, so that a video proves a real, continuous capture of the actual item without extra LLM cost.

#### Acceptance Criteria

1. WHEN a video is provided, THE Grading_Pipeline SHALL compute frame-to-frame perceptual-hash continuity as a non-LLM signal of a single continuous capture.
2. WHEN selected video frames perceptually match a catalog/reference image within the configured threshold, THE Grading_Pipeline SHALL raise the existing stock-photo-theft (HARD) signal.
3. WHEN liveness signals indicate hard discontinuities or splicing, THE Grading_Pipeline SHALL record an anti-fraud annotation for the item.
4. THE Grading_Pipeline SHALL compute all liveness signals without invoking the Grading_LLM.

### Requirement 12: Clothing-Aware Inspection

**User Story:** As a platform operator whose returns are mostly clothing, I want apparel handled with checks that match how clothes actually fail and get abused, so that grading and fraud detection are accurate for the dominant category.

#### Acceptance Criteria

1. WHERE the category is apparel, THE Grading_Pipeline SHALL include a tags/label Aspect (`kind=label`) as a critical identity and freshness anchor for in-window returns.
2. WHERE the category is apparel and the reason or scrutiny level warrants it, THE Grading_Pipeline SHALL include wear-pattern region Aspects (e.g. inner collar, underarms, cuffs, seat/knees).
3. WHEN generating apparel Aspects, THE Grading_Pipeline SHALL tailor checks to the garment material and sub-type (e.g. pilling/holes for knitwear, fade/seam stress for denim, snags/pulls for silk, print cracking for printed garments).
4. THE Grading_Pipeline SHALL mark texture/defect apparel Aspects (pilling, stains, weave) as `detail_level=high`.
5. WHEN a color-mismatch claim is made, THE Grading_Pipeline SHALL treat any color-difference measurement as an advisory soft signal and SHALL NOT auto-reject or auto-grade solely on it.
6. WHEN garment drape obscures evidence, THE Grading_Pipeline SHALL coach the user toward a flat-lay or hung shot in guidance rather than hard-rejecting the field.
7. WHERE an apparel claim is non-visual (odor, shrinkage, feel), THE Grading_Pipeline SHALL mark it `verifiability=none` and apply the Requirement 3 routing.

### Requirement 13: Prompt Architecture — Base and Category Split

**User Story:** As a platform operator, I want platform-wide rules in a base prompt and category-specific rules in category prompts, so that behavior is consistent yet specialized and easy to maintain.

#### Acceptance Criteria

1. THE Grading_Pipeline SHALL compose prompts in the order base prompt, then category prompt, then any seller overlay, then the task body.
2. THE Grading_Pipeline SHALL provide maintained category prompts for at least apparel/clothing and electronics.
3. WHERE no category prompt exists for a given category, THE Grading_Pipeline SHALL compose using the base prompt alone without error.
4. THE Grading_Pipeline SHALL keep platform-wide grading rules in the base prompt and category-distinct rules in the respective category prompt, avoiding duplication of category rules in the base prompt.
5. IF the base prompt cannot be loaded, THEN THE Grading_Pipeline SHALL raise a clear error for that grading run.

### Requirement 14: Admin Prompt and Template Console

**User Story:** As an admin, I want every prompt and template the system sends to the LLM to be visible and editable in the dashboard, so that I can tune behavior without code changes.

#### Acceptance Criteria

1. THE Admin_Prompt_Console SHALL list every Prompt_Asset: the base prompt, each category prompt, the Pass-1 form-generation template, the Pass-2 grade-synthesis template, the inspection template, and the montage prompt.
2. WHEN an admin edits and saves a Prompt_Asset, THE Grading_Pipeline SHALL persist the edited version and SHALL use it on subsequent grading runs in place of the bundled file.
3. WHERE no admin-edited version of a Prompt_Asset exists, THE Grading_Pipeline SHALL fall back to the bundled file content.
4. THE Admin_Prompt_Console SHALL display the current effective content of each Prompt_Asset, whether from the persisted edit or the file fallback.
5. WHEN an admin saves an empty or unreadable Prompt_Asset, THE Grading_Pipeline SHALL reject the save and SHALL retain the previous effective content.
6. THE Grading_Pipeline SHALL restrict Prompt_Asset editing to admin-authorized users.

### Requirement 15: Developer Logs Alignment

**User Story:** As a developer, I want the live trace to narrate the new flow accurately, so that demos and debugging reflect what actually ran.

#### Acceptance Criteria

1. WHEN the flow advances through Steps, THE Grading_Pipeline SHALL emit Developer_Logs entries naming the current Step.
2. WHEN a Verify_Action runs, THE Grading_Pipeline SHALL log the field, its Capture_Mode, the video-inspection mode (if video), and the accept/reject outcome with any missing views.
3. WHEN the Two_Attempt_Passthrough or a Human_Review_Route fires, THE Grading_Pipeline SHALL log the trigger and the affected field or item.
4. WHEN a Prompt_Asset edited in the Admin_Prompt_Console is used for a run, THE Grading_Pipeline SHALL log that an admin-edited asset was applied.

### Requirement 16: Backward Compatibility and Non-Regression

**User Story:** As a maintainer, I want existing intake, grading, and stored data to keep working as the new model rolls out, so that the branch merges with only additive change.

#### Acceptance Criteria

1. THE Grading_Pipeline SHALL preserve the existing `triggerGrading(itemId, { evidencePhotos, category, originalProductId })` call signature, accepting the new fields as additive optional arguments.
2. THE Pass_2 stage SHALL continue to produce the canonical Grade JSON contract (grade in {A,B,C,D}, valid confidence, valid routing hint, numeric bounds).
3. WHEN existing evidence fragments (per-photo or per-field) are present for an item, THE Grading_Pipeline SHALL synthesize a grade from them without requiring the new aspect/step structure.
4. WHEN a Form_Schema lacks Steps or Aspects, THE Grading_Pipeline SHALL render and evaluate it as a single implicit Step of plain photo fields.
5. THE Grading_Pipeline SHALL introduce all new persisted shape (aspects, steps, capture mode, unverified tags, human-review signal) as additive fields without renaming or removing existing fields.
6. THE Grading_Pipeline SHALL continue to emit the existing lifecycle events through the existing emitter interface.
