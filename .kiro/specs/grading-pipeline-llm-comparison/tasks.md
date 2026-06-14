# Implementation Plan: Grading Pipeline LLM Comparison

## Overview

This plan extends the live Phase 2 AI Grading Pipeline with three capabilities (Rekognition-in-Pass-1, uncapped Pass 2 LLM analysis, a DevTools toggle) plus the persistence and surfacing needed to compare a standard run against an enhanced run for the same item.

The work is sequenced contract-first: the ML service request/response contract (`pass2_mode`, `rekognition_pass1_signals`) is established before the backend threads the mode through and consumes it; data models land before the persistence logic that writes them; persistence lands before the read API surfaces it. Three tracks (ML service / Python, backend / Node, frontend / React) can each make progress in parallel where dependencies allow.

Languages and test libraries follow the design:
- ML service pure logic — `hypothesis` (Python), minimum 100 iterations.
- Backend and frontend pure logic — `fast-check` (Node), minimum 100 iterations.
- Each property test is tagged: `// Feature: grading-pipeline-llm-comparison, Property {n}: {property_text}` (Python uses `# ...`).
- Each of Properties 1–11 is implemented by exactly one property-based test.

## Tasks

- [ ] 1. ML service contract foundations (config + schemas)
  - [ ] 1.1 Add uncapped Pass 2 config to `ml-service/app/config.py`
    - Add `pass2_uncapped_timeout_seconds: int = 90`, `pass2_uncapped_max_tokens: int = 8192`, and `pass2_standard_max_tokens: int = 2000`
    - Ensure both uncapped values are strictly greater than their standard counterparts (`pass2_timeout_seconds`, standard tokens) so config selection satisfies the ordering invariant
    - _Requirements: 2.2_

  - [ ] 1.2 Extend ML request/response schemas in `ml-service/app/schemas.py`
    - Add `pass2_mode: str = "standard"` to `GradingRequest`
    - Add optional `pass2_mode: str = "standard"` and `rekognition_applied: bool = False` to `GradingResponse`
    - Add optional `rekognition_pass1_signals: Dict[str, Any] = {}` to `FormResponse`
    - All additions defaulted so existing callers are unaffected
    - _Requirements: 2.1, 4.4, 1.5, 7.1_

- [ ] 2. ML service — Pass 1 Rekognition injection
  - [ ] 2.1 Provide/confirm byte-based label detection in `ml-service/app/services/rekognition.py`
    - Ensure `detect_labels_bytes(...)` returns labels and defect-candidate structures usable for prompt rendering
    - Keep it side-effect free for the caller (raises on AWS error so `form_generator` can catch)
    - _Requirements: 1.1_

  - [ ] 2.2 Inject Rekognition signals into Pass 1 prompt in `ml-service/app/services/form_generator.py`
    - When `initial_photos` is non-empty: fetch bytes (reuse `try_fetch_image_bytes`), call `rekognition_service.detect_labels_bytes(...)` per photo, build `Rekognition_Pass1_Signals = { labels, defect_candidates, applied: true }`, and render every label and defect candidate into the composed Pass 1 prompt text
    - When `initial_photos` is empty: skip the enhanced path, set `applied: false`, record an "initial photos required for enhanced Pass 1" note, and proceed with standard form generation
    - Wrap Rekognition in try/except: on any error discard all signals collected so far (`applied: false`, `degraded: true`, `warning: ...`) and proceed with non-enhanced form generation
    - _Requirements: 1.2, 1.3, 1.4_

  - [ ] 2.3 Wire signals through the `/form` route in `ml-service/app/routers/grading.py`
    - Return `rekognition_pass1_signals` (counts + payload) and trace on `FormResponse` so the backend can log counts and persist provenance
    - _Requirements: 1.5, 1.6_

  - [ ]* 2.4 Write property test for Pass 1 prompt injection (`hypothesis`)
    - **Property 5: Rekognition signals are injected into the Pass 1 prompt**
    - With a mocked `rekognition_service`, generate non-empty label/defect-candidate sets; assert the composed prompt contains a rendering of every provided label and defect candidate when ≥1 initial photo is present
    - **Validates: Requirements 1.2**

  - [ ]* 2.5 Write property test for Rekognition degradation (`hypothesis`)
    - **Property 6: Rekognition failure excludes all signals and proceeds with a warning**
    - Inject failures at arbitrary points (including after partial collection); assert signals passed to prompt composition are empty (`applied=false`), a degradation warning is recorded, and form generation still proceeds
    - **Validates: Requirements 1.3**

  - [ ]* 2.6 Write property test for Pass 1 signals provenance round-trip (`hypothesis`)
    - **Property 7: Pass 1 signals persistence round-trip**
    - Generate `Rekognition_Pass1_Signals` objects; assert serializing as form-generation provenance and reading back yields equivalent label count, defect-candidate count, and payload
    - **Validates: Requirements 1.6**

  - [ ]* 2.7 Write edge/integration tests for Pass 1 enhancement
    - Edge (1.4): empty `initial_photos` blocks the enhanced path and records the photos-required note
    - Integration (1.1): with a mocked `rekognition_service`, assert `detect_labels` is invoked before prompt composition when ≥1 initial photo is present
    - _Requirements: 1.1, 1.4_

- [ ] 3. ML service — uncapped Pass 2 mode
  - [ ] 3.1 Add mode-aware synthesis to `ml-service/app/services/grade_synthesizer.py`
    - `synthesize_grade(summary, category=None, mode="standard", trace=None)`: select `max_tokens` and `timeout_s` from uncapped vs standard config based on `mode`; default `standard`
    - Wrap `invoke_json` in `asyncio.wait_for(timeout_s)`; on `TimeoutError` raise `GradeSynthesisError("uncapped_pass2_timeout")`
    - Record `grade["pass2Mode"] = mode` in the result; ensure the result flows through `coerce_and_validate` regardless of mode
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ] 3.2 Wire `pass2_mode` through the `/grade/` route in `ml-service/app/routers/grading.py`
    - Read `pass2_mode` from `GradingRequest`, pass to `synthesize_grade(mode=...)`, and echo `pass2_mode` / `rekognition_applied` on `GradingResponse`
    - Map `GradeSynthesisError("uncapped_pass2_timeout")` to an HTTP 502 with trace so the backend can build its fallback
    - _Requirements: 2.5, 2.6, 4.4_

  - [ ]* 3.3 Write property test for grade contract validity (`hypothesis`)
    - **Property 3: Grade contract validity and backward-compatible shape**
    - Target `ml-service/app/services/grade_validation.coerce_and_validate` with generators producing well-formed, malformed, and partial raw dicts under either mode; assert `grade ∈ {A,B,C,D}`, `confidence ∈ {high,medium,low}`, `routingHint ∈ {resell,refurbish,donate,liquidate}`, `0 ≤ qualityScore ≤ 100`, `0.0 ≤ estimatedResalePct ≤ 1.0`, every defect severity `∈ {minor,moderate,major}`
    - **Validates: Requirements 2.6, 7.1, 7.3**

  - [ ]* 3.4 Write edge test for uncapped Pass 2 timeout
    - Inject an uncapped timeout; assert the router surfaces `uncapped_pass2_timeout` so the backend produces the manual-review fallback
    - _Requirements: 2.5_

- [ ] 4. Checkpoint — ML service
  - Ensure all ML-service tests pass, ask the user if questions arise.

- [ ] 5. Backend data models
  - [ ] 5.1 Add additive optional fields to `backend/src/modules/grading/grading.model.js`
    - Add `pass2Mode` (enum `['standard','uncapped']`, default `'standard'`), `rekognitionApplied` (Boolean, default false)
    - Add `rekognitionPass1Signals` sub-object (applied, labelCount, defectCandidateCount, labels, defectCandidates, degraded, warning)
    - Add `pass2ModeMeta` sub-object (maxTokens, timeoutMs, timedOut)
    - Preserve every existing required field unchanged; all new fields optional
    - _Requirements: 7.3, 1.6, 2.2, 2.3_

  - [ ] 5.2 Create `backend/src/modules/grading/comparison.model.js`
    - Define `resultSnapshotSchema` (gradeId, grade, qualityScore, confidence, routingHint, pass2Mode, rekognitionApplied) and `comparisonSchema` keyed by unique indexed `itemId`, with `standard`, `uncapped`, and `diffs` (grade/qualityScore/confidence/routingHint)
    - Export the `Comparison` model
    - _Requirements: 5.2, 5.3, 5.4_

- [ ] 6. Backend — grading service mode + comparison logic
  - [ ] 6.1 Resolve Pass 2 mode and forward it to the ML service in `grading.service.js`
    - In `triggerGrading`, accept optional `options.pass2Mode`; compute `resolvedPass2Mode = options.pass2Mode === 'uncapped' ? 'uncapped' : 'standard'`
    - Log the resolved mode via `ItemLogger` (`PASS2_MODE`)
    - In `callMlGrade`, add `pass2_mode: resolvedPass2Mode` to the ML request body
    - Keep the exported `triggerGrading(itemId, { evidencePhotos, category, originalProductId })` signature intact (additive options only)
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 2.1, 2.4, 7.2_

  - [ ]* 6.2 Write property test for mode resolution + config selection (`fast-check`)
    - **Property 1: Pass 2 mode resolution and config selection**
    - Generate arbitrary signals (`'uncapped'`, `'standard'`, undefined, null, '', garbage); assert resolved mode is `'uncapped'` iff signal `=== 'uncapped'`, the resolved value is what lands in the ML payload, and the uncapped config has strictly greater token budget and timeout than standard
    - **Validates: Requirements 2.1, 2.2, 2.4, 4.2, 4.3, 4.4**

  - [ ] 6.3 Map ML response and extend fallback in `grading.service.js`
    - `mapMlResponseToGrade` carries through `pass2Mode`, `rekognitionApplied`, and `pass2ModeMeta`
    - `buildFallbackGrade` handles the uncapped-timeout path: manual-review grade with `pass2Mode: 'uncapped'`, `flaggedForReview: true`, `reviewReason: 'uncapped_pass2_timeout'`, and a logged timeout reason
    - _Requirements: 2.3, 2.5_

  - [ ]* 6.4 Write property test for persisted mode (`fast-check`)
    - **Property 4: Persisted grade records its resolved Pass 2 mode**
    - Generate resolved modes + valid grade results; assert the built/persisted grade document `pass2Mode` equals the resolved mode for that run
    - **Validates: Requirements 2.3**

  - [ ] 6.5 Persist Pass 1 provenance + log counts in `startFormGeneration` (`grading.service.js`)
    - Log the label / defect-candidate counts from the ML `/form` response
    - Persist `rekognitionPass1Signals` to the item's `evidenceForm` provenance and onto the grade
    - _Requirements: 1.5, 1.6_

  - [ ] 6.6 Add comparison build + diff helpers in `grading.service.js`
    - `buildComparisonRecord({ itemId, standard, uncapped })` builds the two result snapshots (grade, qualityScore, confidence, routingHint, pass2Mode, rekognitionApplied)
    - Compute diffs: `grade.changed`/`confidence.changed`/`routingHint.changed` (changed iff values differ), `qualityScore.delta = uncapped - standard`
    - _Requirements: 5.2, 5.3, 6.2_

  - [ ]* 6.7 Write property test for comparison construction (`fast-check`)
    - **Property 8: Comparison record construction is complete and item-keyed**
    - Generate standard/uncapped result pairs for an item; assert the record is keyed by `itemId` and each snapshot's grade, quality score, confidence, routing hint, pass2Mode, and rekognitionApplied equal the source
    - **Validates: Requirements 5.2, 5.4**

  - [ ]* 6.8 Write property test for comparison diffs (`fast-check`)
    - **Property 9: Comparison diffs are correct**
    - Generate result pairs; assert `grade.changed`/`confidence.changed`/`routingHint.changed` are true iff values differ and `qualityScore.delta` equals uncapped minus standard
    - **Validates: Requirements 5.3, 6.2**

  - [ ] 6.9 Implement transactional persist in `grading.service.js`
    - `persistGradeAndComparison`: open a session, `withTransaction` upsert the grade keyed by `itemId`; look up prior baseline before upsert; when `resolvedPass2Mode === 'uncapped'` and a prior non-uncapped grade exists, upsert the `Comparison_Record`; otherwise persist grade and mark "no baseline available" — all-or-nothing
    - _Requirements: 5.1, 5.4, 5.5_

  - [ ]* 6.10 Write property test for persist condition (`fast-check`)
    - **Property 10: Comparison is persisted only when a standard baseline exists**
    - Generate runs with/without a prior standard baseline; assert a Comparison_Record is produced iff a prior standard-mode grade exists, else the grade is persisted and marked no-baseline
    - **Validates: Requirements 5.1**

  - [ ]* 6.11 Write unit/regression tests for service contract
    - 7.2: call `triggerGrading(itemId, { evidencePhotos, category, originalProductId })` with the exact documented signature (ML mocked) and assert unchanged behavior
    - 7.4: non-flagged `ok` grade invokes `emitGraded`; flagged grade skips emission
    - _Requirements: 7.2, 7.4_

- [ ] 7. Backend — evidence path threading
  - [ ] 7.1 Accept `pass2Mode` in evidence controllers/services
    - Returns and secondhand evidence controllers/services read optional `pass2Mode: 'standard'|'uncapped'` from the request body and forward it; missing value defaults to standard
    - _Requirements: 4.1, 4.3_

  - [ ] 7.2 Thread `pass2Mode` through `item.service.attachEvidence`
    - Accept optional `opts.pass2Mode` and forward it into `gradingService.triggerGrading(..., { pass2Mode })`; additive so existing callers get standard
    - _Requirements: 4.2_

- [ ] 8. Backend — comparison surfacing
  - [ ] 8.1 Extend `getGradeByItemId` to fetch and shape comparison data (`grading.service.js`)
    - Fetch any `Comparison_Record` for the item; when present return both result sets plus per-field diffs with `comparisonAvailable: true`; when absent return the single grade with `comparisonAvailable: false`; when no grade return null
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ] 8.2 Shape the response in `grading.controller.getGrade`
    - Found → `200 { success: true, data: { grade, comparison?, comparisonAvailable } }`
    - Not found → `404 { success: false, message: 'Grade not found for this item' }` in the Standard_Response envelope
    - _Requirements: 6.1, 6.3, 6.4_

  - [ ]* 8.3 Write property test for response shaping (`fast-check`)
    - **Property 11: Comparison-aware response shaping**
    - Generate items with a grade and with/without a comparison; assert response includes both result sets + diffs with `comparisonAvailable=true` when a record exists, and the single grade with `comparisonAvailable=false` otherwise
    - **Validates: Requirements 6.1, 6.3**

  - [ ]* 8.4 Write edge test for missing grade
    - Request an item with no Grade_Result; assert the 404 Standard_Response envelope (including when no comparison exists)
    - _Requirements: 6.4_

- [ ] 9. Checkpoint — backend
  - Ensure all backend tests pass, ask the user if questions arise.

- [ ] 10. Frontend — DevTools toggle and mode signalling
  - [ ] 10.1 Add `getPass2Mode` helper to `frontend/src/services/dev.service.js`
    - Export `getPass2Mode()` returning `'uncapped'` iff `localStorage.getItem('dev_llm_analysis_pass2') === 'true'`, else `'standard'`; share the storage key constant
    - _Requirements: 3.4, 4.1_

  - [ ]* 10.2 Write property test for toggle-to-mode mapping (`fast-check`)
    - **Property 2: Toggle-to-mode mapping**
    - Generate arbitrary stored values (including absent); assert `getPass2Mode()` is `'uncapped'` iff stored value is exactly `'true'`, and the initialized toggle display state is enabled under the same condition, defaulting to disabled/standard otherwise
    - **Validates: Requirements 3.4, 4.1**

  - [ ] 10.3 Add the LLM Analysis toggle to `frontend/src/components/shared/DevTools.jsx`
    - Add a labeled switch in a "Grading Pipeline" section using the existing `localStorage` + `useState` pattern; init from `dev_llm_analysis_pass2` (default disabled); persist `'true'`/`'false'` on toggle
    - Inherit the existing production gate so the toggle is not rendered in production builds
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.7_

  - [ ]* 10.4 Write unit tests for DevTools rendering
    - Render in dev mode: toggle present with the expected label; clicking persists `'true'`/`'false'` to localStorage
    - _Requirements: 3.1, 3.2, 3.3_

  - [ ] 10.5 Include `pass2Mode` in evidence submission services
    - `return.service.submitReturnEvidence` and `secondhand.service.submitSecondhandEvidence` add `pass2Mode: getPass2Mode()` to the request body
    - _Requirements: 3.5, 3.6, 4.1_

  - [ ]* 10.6 Write integration tests for toggle → payload and production gate
    - Toggle enabled → submitted run carries `pass2Mode='uncapped'`; disabled → `'standard'` (3.5/3.6)
    - Production environment flag → no DevTools / no toggle rendered (3.7)
    - _Requirements: 3.5, 3.6, 3.7_

- [ ] 11. Integration and final checkpoint
  - [ ]* 11.1 Write end-to-end comparison integration test
    - Run a standard grade then an uncapped grade for the same item; assert a `Comparison_Record` is persisted and surfaced through `GET /api/grading/:itemId`
    - _Requirements: 5.1, 6.1, 6.2_

  - [ ] 11.2 Final checkpoint — Ensure all tests pass
    - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; they will not be auto-implemented.
- Each task references the specific requirements (and, for property tests, the design property) it implements for traceability.
- PBT scope: AWS Rekognition and Gemini are mocked; property tests target the pure logic layer (mode resolution, grade coercion/validation, diff computation, comparison construction, prompt composition, response shaping).
- Property tests run a minimum of 100 iterations and are tagged `Feature: grading-pipeline-llm-comparison, Property {n}: ...`.
- All new persisted fields and payload fields are optional/defaulted, preserving backward compatibility (Requirement 7).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "5.1", "5.2", "10.1"] },
    { "id": 1, "tasks": ["2.2", "3.1", "3.3", "6.1", "7.1", "10.2", "10.3"] },
    { "id": 2, "tasks": ["2.3", "2.4", "6.2", "6.3", "7.2", "10.4", "10.5"] },
    { "id": 3, "tasks": ["3.2", "2.5", "2.6", "6.4", "6.5", "10.6"] },
    { "id": 4, "tasks": ["3.4", "2.7", "6.6"] },
    { "id": 5, "tasks": ["6.7", "6.8", "6.9"] },
    { "id": 6, "tasks": ["6.10", "6.11", "8.1"] },
    { "id": 7, "tasks": ["8.2", "8.3"] },
    { "id": 8, "tasks": ["8.4", "11.1"] }
  ]
}
```
