# Requirements Document

## Introduction

This feature enhances the existing Phase 2 AI Grading Pipeline so that grading results produced by the current ("baseline") pipeline can be compared against results produced by an "enhanced" pipeline. The enhancement adds three capabilities:

1. **Rekognition signals in Pass 1** — AWS Rekognition label detection runs on the initial/clarifying photos during Pass 1 (form generation), and those signals feed the Grading_LLM that generates the tailored evidence form.
2. **Uncapped Pass 2 LLM analysis mode** — Pass 2 (grade synthesis) gains an optional deeper analysis path where the Grading_LLM is permitted to run without the latency/output constraints of the standard path. The user has stated the extra latency is acceptable. This path exists to produce a richer grade for comparison against the standard path.
3. **A DevTools toggle** — a control in `frontend/src/components/shared/DevTools.jsx` that enables or disables the uncapped Pass 2 LLM analysis, persists like other DevTools state, and signals the backend/pipeline which mode to run.

The motivation is **comparison**: the developer wants to observe how grading results differ between the baseline pipeline and the enhanced pipeline (Rekognition-in-Pass-1 + uncapped Pass 2 LLM analysis), so comparison results must be persisted and surfaced.

**Terminology note (to confirm with the user):** The pipeline reference diagrams describe the LLM as "Gemini" conceptually, while the code path in `ml-service/app/services/gemini.py` and `grading.service.js` references Gemini model identifiers, and other project notes describe Amazon Nova Pro via AWS Bedrock. This document uses the neutral term **Grading_LLM** to refer to whichever multimodal LLM the pipeline is configured to call, independent of provider naming.

## Glossary

- **Grading_Pipeline**: The end-to-end Phase 2 system that turns evidence photos + a return reason into a Grade JSON, spanning the backend orchestrator (`grading.service.js`) and the ML service (`ml-service/app/`).
- **Pass_1**: The form-generation stage that produces a tailored evidence Form_Schema from the return reason, initial photos, and listing data.
- **Pass_2**: The grade-synthesis stage that reads the Analysis_Summary and produces the canonical Grade JSON (grade A/B/C/D, confidence, defects, routing hint, rationale).
- **Grading_LLM**: The multimodal large language model the pipeline calls for Pass_1 and Pass_2 (provider-neutral term; see terminology note).
- **Rekognition**: AWS Rekognition label-detection service, accessed via `ml-service/app/services/rekognition.py`.
- **Rekognition_Pass1_Signals**: The structured label/defect output produced by running Rekognition on the Pass_1 initial/clarifying photos.
- **Standard_Pass2_Mode**: The existing Pass_2 behavior, constrained by current token/latency settings.
- **Uncapped_Pass2_Mode**: An optional Pass_2 behavior in which the Grading_LLM runs a fuller analysis without the standard latency/output constraints.
- **LLM_Analysis_Toggle**: The DevTools control that enables or disables Uncapped_Pass2_Mode.
- **Analysis_Summary**: The structured text object assembled from the parallel specialized analyses and passed to Pass_2.
- **Grade_Result**: A persisted Grade document for one item, including the grade, confidence, defects, rationale, model versions, and Evidence_Bundle.
- **Comparison_Record**: A persisted record that pairs a Standard_Pass2_Mode result with an Uncapped_Pass2_Mode result (and/or with/without Rekognition_Pass1_Signals) for the same item so the two can be compared.
- **DevTools**: The developer control panel component at `frontend/src/components/shared/DevTools.jsx`.
- **Dev_Service**: The frontend service module `frontend/src/services/dev.service.js` used by DevTools to call the backend.
- **Standard_Response**: The backend's standard response envelope used across modules.

## Requirements

### Requirement 1: Rekognition Signals Feed Pass 1 Form Generation

**User Story:** As a developer evaluating grading quality, I want AWS Rekognition labels from the initial photos to inform Pass 1 form generation, so that the generated evidence form is shaped by detected objects and defects rather than the return reason alone.

#### Acceptance Criteria

1. WHEN Pass_1 form generation is requested AND at least one initial photo is provided, THE Grading_Pipeline SHALL run Rekognition label detection on the provided initial photos before composing the Pass_1 prompt.
2. WHEN Rekognition label detection completes for Pass_1, THE Grading_Pipeline SHALL include the Rekognition_Pass1_Signals in the prompt context supplied to the Grading_LLM for form generation.
3. IF Rekognition is unavailable OR returns an error during Pass_1, THEN THE Grading_Pipeline SHALL exclude all Rekognition_Pass1_Signals (including any partial signals collected before the failure) and SHALL proceed with Pass_1 form generation while recording a warning describing the degradation.
4. IF no initial photo is provided to a Rekognition-enhanced Pass_1 request, THEN THE Grading_Pipeline SHALL block the Rekognition-enhanced form generation and SHALL record that initial photos are required for the enhanced Pass_1 path.
5. WHEN Rekognition_Pass1_Signals are used in Pass_1, THE Grading_Pipeline SHALL record a developer log entry stating the number of labels and defect candidates detected.
6. THE Grading_Pipeline SHALL persist the Rekognition_Pass1_Signals as part of the form-generation provenance for the item.

### Requirement 2: Uncapped Pass 2 LLM Analysis Mode

**User Story:** As a developer comparing grading depth, I want an optional uncapped Pass 2 analysis path, so that I can see whether a fuller LLM analysis produces a different grade than the standard constrained path.

#### Acceptance Criteria

1. WHERE Uncapped_Pass2_Mode is enabled for a grading run, THE Grading_Pipeline SHALL execute Pass_2 using the uncapped analysis configuration instead of Standard_Pass2_Mode.
2. WHILE Uncapped_Pass2_Mode is active, THE Grading_Pipeline SHALL allow Pass_2 to use an increased output-token budget and an increased Pass_2 request timeout relative to Standard_Pass2_Mode.
3. WHEN Uncapped_Pass2_Mode produces a Grade_Result, THE Grading_Pipeline SHALL record which mode (Standard_Pass2_Mode or Uncapped_Pass2_Mode) produced the Grade_Result in the persisted record.
4. WHERE Uncapped_Pass2_Mode is disabled for a grading run, THE Grading_Pipeline SHALL execute Pass_2 using Standard_Pass2_Mode.
5. IF Uncapped_Pass2_Mode exceeds the configured uncapped Pass_2 timeout, THEN THE Grading_Pipeline SHALL fall back to a manual-review grade and record the timeout reason in the developer log.
6. THE Grade_Result produced by Uncapped_Pass2_Mode SHALL conform to the same canonical Grade JSON contract (grade in {A,B,C,D}, valid confidence, valid routing hint, numeric bounds) as Standard_Pass2_Mode.

### Requirement 3: DevTools Toggle for LLM Analysis

**User Story:** As a developer, I want a toggle in DevTools labeled for enabling LLM analysis in Pass 2, so that I can switch the enhanced grading mode on or off without changing code.

#### Acceptance Criteria

1. THE DevTools SHALL display an LLM_Analysis_Toggle control labeled to indicate that it enables LLM analysis in Pass 2.
2. WHEN the developer activates the LLM_Analysis_Toggle, THE DevTools SHALL persist the enabled state in browser localStorage.
3. WHEN the developer deactivates the LLM_Analysis_Toggle, THE DevTools SHALL persist the disabled state in browser localStorage.
4. WHEN DevTools mounts, THE DevTools SHALL initialize the LLM_Analysis_Toggle display from the persisted localStorage state, defaulting to disabled when no state is stored.
5. WHILE the LLM_Analysis_Toggle is enabled, THE Grading_Pipeline SHALL run Uncapped_Pass2_Mode for grading runs initiated from the client.
6. WHILE the LLM_Analysis_Toggle is disabled, THE Grading_Pipeline SHALL run Standard_Pass2_Mode for grading runs initiated from the client.
7. WHERE the application is built for production, THE DevTools SHALL NOT render the LLM_Analysis_Toggle.

### Requirement 4: Toggle State Reaches the Backend Pipeline

**User Story:** As a developer, I want the toggle state to actually control the pipeline on the backend, so that the frontend choice determines which Pass 2 mode runs.

#### Acceptance Criteria

1. WHEN a grading run is initiated from the client WHILE the LLM_Analysis_Toggle is enabled, THE Dev_Service SHALL signal the backend that Uncapped_Pass2_Mode is requested for that run.
2. WHEN the backend receives a grading request carrying the Uncapped_Pass2_Mode signal, THE Grading_Pipeline SHALL pass the uncapped mode flag through to the ML service Pass_2 stage.
3. IF a grading request arrives without an explicit Pass_2 mode signal, THEN THE Grading_Pipeline SHALL default to Standard_Pass2_Mode.
4. WHEN the backend forwards a grading request to the ML service, THE Grading_Pipeline SHALL include the resolved Pass_2 mode in the request payload to the ML service.
5. THE Grading_Pipeline SHALL record the resolved Pass_2 mode in the developer log for each grading run.

### Requirement 5: Comparison Result Persistence

**User Story:** As a developer, I want comparison results between the baseline and enhanced grading to be stored, so that I can review how the two pipelines differ for the same item.

#### Acceptance Criteria

1. WHEN a grading run completes under Uncapped_Pass2_Mode for an item that already has a Standard_Pass2_Mode Grade_Result, THE Grading_Pipeline SHALL persist a Comparison_Record linking the two results for that item.
2. THE Comparison_Record SHALL include, for each compared result, the grade, quality score, confidence, routing hint, the Pass_2 mode used, and whether Rekognition_Pass1_Signals were applied.
3. WHEN a Comparison_Record is persisted, THE Grading_Pipeline SHALL record the differences in grade, quality score, and confidence between the two results.
4. THE Grading_Pipeline SHALL key persisted Grade_Results and Comparison_Records by item identifier so that results for one item are retrievable together.
5. IF a grading run completes under Uncapped_Pass2_Mode for an item that has no prior Standard_Pass2_Mode Grade_Result, THEN THE Grading_Pipeline SHALL persist the Grade_Result and record that no baseline result was available as a single atomic operation, such that if either action fails neither is committed.

### Requirement 6: Surfacing Comparison Results

**User Story:** As a developer, I want to retrieve and view the comparison between baseline and enhanced grades, so that I can evaluate the impact of the enhancements.

#### Acceptance Criteria

1. WHEN a developer requests grading results for an item that has a Comparison_Record, THE Grading_Pipeline SHALL return both the Standard_Pass2_Mode result and the Uncapped_Pass2_Mode result in a single Standard_Response.
2. THE Grading_Pipeline SHALL include the per-field differences (grade, quality score, confidence, routing hint) in the returned comparison data.
3. WHEN a developer requests grading results for an item that has no Comparison_Record, THE Grading_Pipeline SHALL return the available single Grade_Result and indicate that no comparison is available.
4. IF the requested item has no Grade_Result, THEN THE Grading_Pipeline SHALL return a not-found response in the Standard_Response envelope, including when the item also has no Comparison_Record.

### Requirement 7: Backward Compatibility and Non-Regression

**User Story:** As a maintainer, I want the existing baseline pipeline to behave exactly as before when the enhancements are off, so that current grading results remain valid.

#### Acceptance Criteria

1. WHILE the LLM_Analysis_Toggle is disabled AND no initial photos drive Rekognition_Pass1_Signals, THE Grading_Pipeline SHALL produce a Grade_Result equivalent in shape and contract to the pre-enhancement pipeline.
2. THE Grading_Pipeline SHALL continue to export `triggerGrading(itemId, { evidencePhotos, category, originalProductId })` with its existing call signature.
3. WHEN the enhanced features are disabled, THE Grading_Pipeline SHALL preserve all existing required fields of the `grades` collection document shape produced by Standard_Pass2_Mode, while permitting new optional fields to be added.
4. THE Grading_Pipeline SHALL continue to emit the existing `GRADED` lifecycle event through the existing Lifecycle_Event_Emitter interface for non-flagged grades.
