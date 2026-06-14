# Requirements Document

## Introduction

Phase 2 of the Second-Life Commerce Ecosystem implements the **AI Grading Pipeline** — the
technical centerpiece described in the authoritative v1.43 Grading System document. The pipeline
replaces manual product inspection with a hybrid AI flow: cheap specialized vision tools
(imagehash, Pillow/EXIF, OpenCV, CLIP, AWS Rekognition, AWS Textract) do the per-task work, and a
multimodal LLM on Amazon Bedrock runs only twice — once to generate a tailored evidence form
(Pass 1) and once to synthesize a canonical condition grade from a structured text summary
(Pass 2). The output is a Grade JSON (A/B/C/D plus quality score, defects, confidence, routing
hint, rationale) persisted with a full evidence bundle for dispute resolution.

This feature builds on the Phase 0 scaffolding already committed to the repository: a SCAFFOLDED
`grading` backend module, the committed `grade` and `lifecycleEvent` contracts, the S3 pre-signed
upload utility, and a FastAPI `ml-service` skeleton with Pydantic schemas, Bedrock/Rekognition/
Textract/OpenCV service wrappers, and CLIP stubs.

### Scope Boundary (Parallel-Work Constraint)

Phase 1 (Dual-Intake Entry Points) is being built simultaneously on a separate branch. To avoid
merge conflicts, this specification deliberately constrains Phase 2 ownership:

- **Phase 2 OWNS:** the `grading` backend module (`backend/src/modules/grading/`), the FastAPI
  grading + vision pipeline (`ml-service/app/`), and the `grades` collection.
- **Phase 2 DOES NOT OWN and MUST NOT define:** the `items` collection, the `returns`/`secondhand`
  modules, or the item lifecycle state machine. Those belong to Phase 1.
- **Integration contract (input):** when grading is triggered:
  - **Internal service call (Phase 1 → Phase 2):** Phase 1 calls
    `triggerGrading(itemId, { evidencePhotos, category, originalProductId })` directly on the
    exported `grading.service.js` function. This is the merge-contract agreed with the teammate.
  - **REST endpoint (external/test):** `POST /api/grading/trigger` accepts the full
    Grading_Request_Contract `{ itemId, userId, productId, reason, imageUrls[], intakePath,
    category }` for standalone testing and future use.
- **Lifecycle boundary (output):** Phase 2 emits a `GRADED` lifecycle event through an
  interface/stub (the Lifecycle_Event_Emitter) rather than owning the lifecycle event writer. The
  emitter dependency may be stubbed and coordinated with Phase 1.

### Out of Scope

- Computing user trust scores from fraud signals (Phase 3) — Phase 2 only annotates soft signals.
- Smart routing / disposition decisions (Phase 4) — Phase 2 only emits a `routingHint`.
- Ownership of the `items` collection and lifecycle state machine (Phase 1).
- AI listing generation, Health Card, demand registry, sustainability (Phases 5–8).

## Glossary

- **Grading_Backend**: The Express `grading` module (`backend/src/modules/grading/`) that exposes
  REST endpoints, validates inputs, calls the ML_Service, persists grades, and emits the `GRADED`
  lifecycle event. Controllers are thin; the `grading.service.js` holds orchestration logic.
- **ML_Service**: The Python FastAPI microservice (`ml-service/app/`) hosting the vision tools and
  Bedrock orchestration. Reachable by the Grading_Backend over HTTP at `ML_SERVICE_URL`.
- **Fraud_Preflight**: The ML_Service component running pre-flight fraud checks (imagehash, EXIF,
  Rekognition web/label signal) before any LLM call.
- **Form_Generator**: The ML_Service Bedrock Pass 1 component that produces a JSON evidence-form
  schema from the return reason, initial photos, product listing data, base prompt, and category
  prompt.
- **Photo_Validator**: The ML_Service component that validates a single uploaded photo using OpenCV
  (blur/lighting/resolution) and CLIP zero-shot subject match.
- **Analysis_Orchestrator**: The ML_Service component that fans out the parallel specialized
  analysis (OpenCV color/histogram, CLIP similarity, Rekognition labels, Textract OCR) using
  `asyncio.gather` and assembles a single structured Analysis_Summary.
- **Grade_Synthesizer**: The ML_Service Bedrock Pass 2 component that converts the
  Analysis_Summary (text only, no raw images) into a canonical Grade JSON.
- **Bedrock_Client**: The `BedrockService` wrapper (`ml-service/app/services/bedrock.py`) used for
  both Bedrock passes, with primary model `amazon.nova-pro-v1:0` and a fallback model.
- **Lifecycle_Event_Emitter**: The interface/stub the Grading_Backend calls to append a `GRADED`
  lifecycle event. Owned in implementation by Phase 1; consumed via interface by Phase 2.
- **Grade_JSON**: The canonical grade record defined by the v1.43 contract and the committed
  `grade.contract.js` (fields: `grade`, `qualityScore`, `confidence`, `defects[]`,
  `missingEvidence[]`, `returnClaimVerified`, `estimatedResalePct`, `routingHint`, `rationale`,
  `modelVersions`).
- **Form_Schema**: The Pass 1 output JSON describing the evidence fields and photo guidance.
- **Analysis_Summary**: The structured JSON assembled in step 8, the sole input to Pass 2.
- **Evidence_Bundle**: The full persisted record: prompts, S3 image URLs, Analysis_Summary, Pass 1
  Form_Schema, final Grade_JSON, model versions, and timestamps.
- **Pass_1_Cache**: The cache keyed by `hash(productId + normalized_reason)` storing Form_Schemas.
- **Soft_Fraud_Signal**: A weak fraud indicator (annotated for the Phase 3 trust layer, does not
  stop the pipeline).
- **Hard_Fraud_Signal**: A strong fraud indicator that short-circuits the pipeline before any LLM
  call.
- **Grading_Request_Contract**: The REST endpoint input shape
  `{ itemId, userId, productId, reason, imageUrls[], intakePath, category }`.
- **Service_Call_Contract**: The direct function-call interface exported by `grading.service.js` —
  `triggerGrading(itemId, { evidencePhotos, category, originalProductId })` — called by Phase 1
  code. `evidencePhotos` is an array of S3 URL strings (equivalent to `imageUrls`),
  `originalProductId` is equivalent to `productId`.
- **Standard_Response**: The backend response envelope — success `{ "success": true, "data": {} }`,
  failure `{ "success": false, "message": "" }`.

## Requirements

### Requirement 1: Grading Trigger Endpoint and Integration Contract

**User Story:** As an upstream intake flow (returns or sell-used), I want to trigger grading with a
well-defined payload, so that an item submitted by a user is graded without Phase 2 owning the item
record.

#### Acceptance Criteria

1. WHEN a `POST /api/grading/trigger` request is received, THE Grading_Backend SHALL validate, before
   invoking any business logic, that the request body matches the Grading_Request_Contract with
   `itemId` (non-empty string), `userId` (non-empty string), `productId` (non-empty string),
   `reason` (non-empty string), `imageUrls` (array of HTTPS URL strings), `intakePath` (one of
   `returns` or `sell-used`), and `category` (non-empty string).
2. IF a `POST /api/grading/trigger` request is missing a required Grading_Request_Contract field, or
   contains a field whose type or value violates the contract, THEN THE Grading_Backend SHALL respond
   with HTTP 400 and the failure Standard_Response indicating which validation failed, and SHALL NOT
   invoke the ML_Service.
3. IF `imageUrls` contains fewer than 1 or more than 10 entries, THEN THE Grading_Backend SHALL
   respond with HTTP 400 and the failure Standard_Response.
4. WHEN input validation succeeds, THE Grading_Backend SHALL invoke the ML_Service grading pipeline
   with the validated payload and SHALL await its response for up to 30 seconds.
5. WHEN the ML_Service returns a successful grade result, THE Grading_Backend SHALL respond with the
   success Standard_Response containing the grade result.
6. IF the ML_Service does not respond within 30 seconds, is unreachable, or returns a non-success
   response, THEN THE Grading_Backend SHALL respond with the failure Standard_Response indicating the
   grading pipeline is unavailable, and SHALL NOT persist a partial grade as final.
7. THE Grading_Backend SHALL return all responses in the Standard_Response envelope
   (`{ success, data }` on success, `{ success, message }` on failure).
8. THE Grading_Backend SHALL NOT define, create, or write to the `items` collection.

### Requirement 2: Pre-flight Fraud Checks

**User Story:** As the platform, I want cheap fraud checks to run before any paid LLM call, so that
fraudulent submissions are rejected early and downstream cost is saved.

#### Acceptance Criteria

1. WHEN a grading pipeline run begins, THE Fraud_Preflight SHALL run the perceptual-hash check
   (imagehash vs catalog photo hashes), the EXIF camera-metadata check (Pillow), and the
   Rekognition web/label signal before any Bedrock call.
2. THE Fraud_Preflight SHALL classify the outcome as a Hard_Fraud_Signal when a submitted photo's
   perceptual hash is within a Hamming distance of 10 (inclusive) of any catalog photo hash, and as a
   Soft_Fraud_Signal when, with no Hard_Fraud_Signal present, EXIF camera metadata (make, model, or
   timestamp) is absent or a Rekognition web match is reported.
3. IF the Fraud_Preflight detects a Hard_Fraud_Signal, THEN THE ML_Service SHALL short-circuit the
   pipeline, skip both Bedrock passes, persist no final grade, and return a fraud-rejection result
   identifying the triggering signal.
4. WHEN the Fraud_Preflight detects a Soft_Fraud_Signal and no Hard_Fraud_Signal is present, THE
   ML_Service SHALL annotate the Analysis_Summary with the soft signal and continue the pipeline.
5. THE ML_Service SHALL record the fraud-check outcome (`phash_match` boolean, `exif_has_camera_data`
   boolean, `rekognition_web_match` boolean, and the resulting classification) in the
   Analysis_Summary.
6. IF any individual fraud check fails to execute or its dependency is unavailable, THEN THE
   Fraud_Preflight SHALL treat that check as not-detected, log a warning, and continue the remaining
   checks and the pipeline.
7. THE Fraud_Preflight SHALL NOT compute a user trust score.

### Requirement 3: Bedrock Pass 1 — Form Generation with Caching

**User Story:** As a user starting a return, I want a tailored evidence form generated for my
specific item and reason, so that I am asked only for the photos and details needed to verify my
claim.

#### Acceptance Criteria

1. WHEN Pass 1 runs, THE Form_Generator SHALL send the user reason, initial photos, product listing
   data, the base prompt, and the category prompt to the Bedrock_Client and SHALL produce a
   Form_Schema as valid JSON.
2. THE Form_Generator SHALL compute the Pass_1_Cache key as `hash(productId + normalized_reason)`,
   where `normalized_reason` is the user reason converted to lowercase, trimmed of leading and
   trailing whitespace, with internal whitespace runs collapsed to a single space.
3. WHEN a Pass 1 request has a Pass_1_Cache key that already exists in the Pass_1_Cache and the
   cached entry is younger than `GRADE_CACHE_TTL_SECONDS` (default 3600), THE Form_Generator SHALL
   return the cached Form_Schema without invoking the Bedrock_Client.
4. WHEN two Pass 1 requests have identical `productId` and identical normalized reason, THE
   Form_Generator SHALL produce identical Pass_1_Cache keys.
5. IF the Bedrock_Client returns output that is not valid JSON matching the Form_Schema structure,
   THEN THE Form_Generator SHALL apply the fallback defined in Requirement 11.
6. IF a Pass_1_Cache entry matching the key is older than `GRADE_CACHE_TTL_SECONDS`, THEN THE
   Form_Generator SHALL treat the request as a cache miss and regenerate the Form_Schema via the
   Bedrock_Client.
7. WHEN the Form_Generator generates a new Form_Schema via the Bedrock_Client, THE Form_Generator
   SHALL store it in the Pass_1_Cache under its Pass_1_Cache key with the time of storage.

### Requirement 4: Progressive Form Rendering API

**User Story:** As a user, I want the evidence form to appear instantly with generic fields and then
refine into AI-tailored fields, so that I never stare at a blank loading spinner.

#### Acceptance Criteria

1. WHEN the frontend requests a form for an item before Pass 1 has completed, THE Grading_Backend
   SHALL return a generic field set together with a readiness status of `pending`, within the
   5-second initial-response target of Requirement 12.
2. WHEN Pass 1 has completed for an item, THE Grading_Backend SHALL return the AI-tailored
   Form_Schema together with a readiness status of `ready`.
3. WHEN the frontend requests a form for an item, THE Grading_Backend SHALL include the readiness
   status (`pending` or `ready`) in every such response so the frontend can poll for readiness and
   swap generic fields for AI-tailored fields without a full page reload.
4. WHEN the first form request for an item arrives after Pass 1 has completed, THE Grading_Backend
   SHALL transition the reported readiness status from `pending` to `ready` and return the
   AI-tailored Form_Schema.
5. IF Pass 1 fails irrecoverably for an item, THEN THE Grading_Backend SHALL return the generic
   default Form_Schema defined in Requirement 11 with a readiness status of `ready` so the frontend
   does not remain in `pending` indefinitely.

### Requirement 5: Per-Photo Real-Time Validation

**User Story:** As a user uploading photos, I want immediate feedback when a photo is unusable or
shows the wrong subject, so that I can correct it before submitting the form.

#### Acceptance Criteria

1. WHEN a `POST /vision/validate-photo` request is received with a photo S3 URL, THE Photo_Validator
   SHALL run the OpenCV blur check (Laplacian variance, fail when below 100), brightness check (fail
   when mean brightness is outside the 40 to 220 inclusive range), and resolution check (fail when
   width is below 800 pixels or height is below 600 pixels), and SHALL return a
   PhotoValidationResponse containing `photo_url`, `is_valid`, `issues`, `blur_score`, and
   `brightness_score` within 5 seconds of receiving the request.
2. WHERE the validation request includes an `expected_subject` value, THE Photo_Validator SHALL run a
   CLIP zero-shot subject match against that expected subject and SHALL record a subject-match
   failure in the `issues` array when the match confidence is below the configured subject-match
   threshold (default 0.25).
3. IF a photo fails the blur, brightness, resolution, or subject-match check, THEN THE
   Photo_Validator SHALL return `is_valid: false` and SHALL list one entry per failed check in the
   `issues` array identifying which check failed.
4. WHEN a photo passes all configured checks, THE Photo_Validator SHALL return `is_valid: true` with
   an empty `issues` array.
5. IF the photo cannot be retrieved from the provided S3 URL or cannot be decoded as a valid image,
   THEN THE Photo_Validator SHALL return `is_valid: false` with an `issues` entry indicating the
   photo could not be processed, and SHALL not perform the blur, brightness, resolution, or
   subject-match checks.

### Requirement 6: Submit — Parallel Specialized Analysis

**User Story:** As the platform, I want all specialized vision analyses to run concurrently after
form submission, so that the structured summary is assembled quickly and cheaply.

#### Acceptance Criteria

1. WHEN a completed form is submitted, THE Analysis_Orchestrator SHALL run the OpenCV color and
   histogram-delta analysis, the CLIP visual-similarity analysis, the Rekognition label detection,
   and the Textract OCR analysis concurrently using `asyncio.gather`, and SHALL cancel and treat as
   failed any analysis that has not completed within 60 seconds.
2. WHEN the Rekognition label detection completes, THE Analysis_Orchestrator SHALL record each
   detected defect whose confidence is at least 50 (on a 0–100 scale) in the Analysis_Summary with
   its label, confidence value, and bounding-box location.
3. WHEN the Textract OCR completes, THE Analysis_Orchestrator SHALL record the extracted text values
   (serials, brand labels, care tags) in the Analysis_Summary.
4. WHEN every specialized analysis has completed (or been treated as failed), THE
   Analysis_Orchestrator SHALL assemble all outputs into a single structured Analysis_Summary JSON
   that mirrors the v1.43 intermediate-summary shape.
5. IF one or more specialized analyses fail while at least one succeeds, THEN THE
   Analysis_Orchestrator SHALL mark each failed analysis with a warning in the Analysis_Summary
   identifying the failed analysis, SHALL retain the successful outputs unchanged, and SHALL continue
   assembling the summary.
6. IF every specialized analysis fails, THEN THE Analysis_Orchestrator SHALL assemble an
   Analysis_Summary recording all analyses as failed so that downstream handling (Requirement 11)
   can apply.

### Requirement 7: Bedrock Pass 2 — Grade Synthesis

**User Story:** As the platform, I want a canonical condition grade synthesized from the structured
analysis, so that grading is objective, cheap, and consistent.

#### Acceptance Criteria

1. WHEN the Analysis_Summary text has been assembled, THE Grade_Synthesizer SHALL send the
   Analysis_Summary text and the base and category prompts to the Bedrock_Client, and the request
   SHALL NOT include raw images or image URLs.
2. THE Grade_Synthesizer SHALL produce a Grade_JSON whose `grade` value is exactly one of `A`, `B`,
   `C`, `D`.
3. THE Grade_Synthesizer SHALL produce a Grade_JSON whose `confidence` value is exactly one of
   `high`, `medium`, `low` and whose `routingHint` value is exactly one of `resell`, `refurbish`,
   `donate`, `liquidate`.
4. THE Grade_Synthesizer SHALL produce a Grade_JSON whose `qualityScore` is an integer between 0 and
   100 inclusive and whose `estimatedResalePct` is a number between 0.0 and 1.0 inclusive.
5. IF the Analysis_Summary indicates insufficient evidence for a required field, THEN THE
   Grade_Synthesizer SHALL include that field name in the `missingEvidence` array and SHALL set
   `confidence` to `medium` or `low` (never `high`).
6. WHEN the Grade_Synthesizer returns a Grade_JSON, THE Grade_JSON SHALL conform to the schema
   defined in `grade.contract.js` and the `grades` Mongoose model, including each `defects[]` entry
   having a `severity` of `minor`, `moderate`, or `major`, a boolean `returnClaimVerified`, a
   non-empty `rationale`, and a populated `modelVersions` object (`pass1Model`, `pass2Model`,
   `rekognitionVersion`).
7. IF the Bedrock_Client does not return a response within the configured Pass 2 request timeout
   (default 20 seconds), THEN THE Grade_Synthesizer SHALL retry once against the configured fallback
   model, and if that retry also fails THE Grade_Synthesizer SHALL return a failure response
   indicating the synthesis error and SHALL NOT persist a partial Grade_JSON as final.
8. IF the Bedrock_Client response cannot be parsed into a valid Grade_JSON, or violates the enum or
   numeric-bound constraints, THEN THE Grade_Synthesizer SHALL reject the response, SHALL return a
   failure response indicating the validation error, and SHALL NOT persist the invalid result.

### Requirement 8: Evidence Bundle Persistence

**User Story:** As an operator resolving disputes, I want the full provenance of every grade stored,
so that any grade can be audited and the models can be retrained later.

#### Acceptance Criteria

1. WHEN a Grade_JSON is produced, THE Grading_Backend SHALL persist exactly one grade document in the
   `grades` collection keyed by `itemId`, where `itemId` is unique such that at most one grade
   document exists per item.
2. WHEN persisting a grade document, THE Grading_Backend SHALL include a complete Evidence_Bundle
   containing all of the following fields, each non-empty: the prompts used for Pass 1 and Pass 2,
   the S3 image URLs, the Analysis_Summary, the Pass 1 Form_Schema, the final Grade_JSON, the
   modelVersions, and the timestamps.
3. WHEN persisting the modelVersions field, THE Grading_Backend SHALL record a non-empty string value
   for each of the Pass 1 model, the Pass 2 model, and the Rekognition version used.
4. WHEN persisting a grade document, THE Grading_Backend SHALL record a creation timestamp in UTC
   ISO 8601 format.
5. IF persistence of the grade document or its Evidence_Bundle fails such that any required field is
   absent or the write does not complete, THEN THE Grading_Backend SHALL not store a partial grade
   document, SHALL leave any previously persisted grade for that `itemId` unchanged, and SHALL return
   the failure Standard_Response with an error indicating persistence failed.
6. IF a Grade_JSON is produced for an `itemId` that already has a persisted grade document, THEN THE
   Grading_Backend SHALL replace the existing grade document with the new one so that exactly one
   grade document remains for that `itemId`.
7. WHEN a `GET /api/grading/:itemId` request is received for an item that has a persisted grade, THE
   Grading_Backend SHALL return the grade document including its Evidence_Bundle in the success
   Standard_Response within 2000 milliseconds.
8. IF a `GET /api/grading/:itemId` request is received for an item that has no persisted grade, THEN
   THE Grading_Backend SHALL respond with HTTP 404 and the failure Standard_Response with an error
   indicating the grade was not found.

### Requirement 9: Human-Review Escalation

**User Story:** As an operator, I want low-confidence or incomplete grades flagged for human review,
so that uncertain items are not auto-routed.

#### Acceptance Criteria

1. WHEN a Grade_JSON is persisted with `confidence` equal to `low`, THE Grading_Backend SHALL set
   that grade's review state to flagged-for-human-review.
2. WHEN a Grade_JSON is persisted with a `missingEvidence` array containing one or more entries, THE
   Grading_Backend SHALL set that grade's review state to flagged-for-human-review.
3. WHILE a grade's review state is flagged-for-human-review, THE Grading_Backend SHALL withhold the
   auto-routing trigger for that grade such that no auto-routing decision is produced for it.
4. WHEN an authenticated seller who owns the associated listing, or an authenticated admin, requests
   flagged grades, THE Grading_Backend SHALL return through a query readable by the seller/admin
   dashboard all grades whose review state is flagged-for-human-review that the requester is
   authorized to view.
5. IF an unauthenticated requester, or a seller who does not own the associated listing, requests
   flagged grades, THEN THE Grading_Backend SHALL deny the request, return no flagged-grade data, and
   return an authorization error indicating access is not permitted.

### Requirement 10: GRADED Lifecycle Event Emission (Phase 1 Boundary)

**User Story:** As the platform, I want a `GRADED` lifecycle event emitted when grading completes,
so that the item lifecycle advances without Phase 2 owning the lifecycle writer.

#### Acceptance Criteria

1. WHEN a grade is successfully persisted and the grade is not flagged for human review, THE
   Grading_Backend SHALL emit exactly one `GRADED` event through the Lifecycle_Event_Emitter
   interface within 5 seconds of grade persistence completing.
2. THE Grading_Backend SHALL emit the `GRADED` event using the `GRADED` event type value defined in
   the `EVENT_TYPES` list of `lifecycleEvent.contract.js`.
3. THE Grading_Backend SHALL invoke the Lifecycle_Event_Emitter only through its interface or stub
   and SHALL NOT perform any direct write to the lifecycle event collection owned by Phase 1.
4. IF the Lifecycle_Event_Emitter is unavailable or its invocation fails, THEN THE Grading_Backend
   SHALL retain the persisted grade unchanged, SHALL set the grade record's lifecycle emission status
   to `pending`, and SHALL return a response indicating the grade was persisted with emission
   deferred.
5. WHILE a grade record's lifecycle emission status is `pending`, THE Grading_Backend SHALL NOT
   re-attempt emission as part of the grading request and SHALL leave the `pending` status observable
   for later reconciliation.

### Requirement 11: Graceful Degradation and Fallbacks

**User Story:** As a user, I want grading to degrade gracefully when an AI dependency is down, so
that I still receive a usable result instead of a hard failure.

#### Acceptance Criteria

1. IF the Bedrock_Client primary model invocation returns an error or does not return a response
   within 10 seconds, THEN THE Bedrock_Client SHALL retry the invocation exactly once using the
   fallback model.
2. IF both the Bedrock_Client primary and fallback model invocations return an error or fail to
   return a response within 10 seconds each, THEN THE Bedrock_Client SHALL raise a
   Bedrock-unavailable error after no more than 2 total invocation attempts.
3. IF Bedrock is unavailable during Pass 1 and a cached Form_Schema exists for the Pass_1_Cache key,
   THEN THE Form_Generator SHALL return the cached Form_Schema together with a status indicating the
   form was served from cache due to degraded AI availability.
4. IF Bedrock is unavailable during Pass 1 and no cached Form_Schema exists for the Pass_1_Cache key,
   THEN THE Form_Generator SHALL return a generic default Form_Schema together with a status
   indicating the AI-tailored form is unavailable.
5. IF Rekognition is unavailable during the parallel analysis, THEN THE Analysis_Orchestrator SHALL
   assemble the Analysis_Summary with a Rekognition-unavailable warning and SHALL continue using the
   successful analyses.
6. WHEN the Analysis_Summary contains a Rekognition-unavailable warning, THE Grade_Synthesizer SHALL
   list each field that depended on Rekognition evidence in `missingEvidence` and SHALL set
   `confidence` to no higher than `medium`.
7. IF a grading run fails irrecoverably (the Grade_Synthesizer cannot produce a valid Grade_JSON
   after the primary and fallback Bedrock attempts, or the ML_Service is unreachable), THEN THE
   Grading_Backend SHALL respond with the failure Standard_Response containing a message indicating
   that grading could not be completed.
8. WHEN a grading run fails irrecoverably, THE Grading_Backend SHALL NOT persist any partial or
   incomplete grade as a final grade in the `grades` collection.

### Requirement 12: Performance Targets

**User Story:** As a user, I want fast feedback during grading, so that the experience feels
responsive.

#### Acceptance Criteria

1. WHEN a user requests the evidence form, THE Grading_Backend SHALL return an initial response
   containing at least one of generic form fields, a cached Form_Schema, or a progressive render
   state within 5 seconds, measured from request receipt to first byte of the response, for at least
   95% of requests under normal operating conditions.
2. WHEN a completed form is submitted, THE ML_Service SHALL return the full Grade_JSON within 20
   seconds under normal operating conditions, where normal operating conditions are defined as all
   external dependencies (Bedrock, Rekognition, Textract) reachable and responding, no fallback model
   or fallback schema triggered, and no fraud short-circuit active, measured from submission receipt
   to Grade_JSON response, for at least 95% of submissions.
3. WHEN a Pass_1_Cache hit occurs for an identical hash of productId and normalized reason, THE
   Form_Generator SHALL return the cached Form_Schema within 1 second and SHALL issue zero outbound
   Bedrock requests for that response.
4. IF full Grade_JSON generation does not complete within 20 seconds, THEN THE ML_Service SHALL
   return a failure Standard_Response indicating a timeout, and SHALL NOT persist a partial grade as
   the final grade.
5. IF Bedrock is unreachable or returns invalid output during form generation, THEN THE
   Form_Generator SHALL return a generic default Form_Schema within 5 seconds and SHALL include an
   indication that a fallback schema was served.

### Requirement 13: Prompt Architecture

**User Story:** As a developer, I want grading prompts organized as a base prompt plus per-category
prompt files, so that grading rules are consistent and category behavior is configurable.

#### Acceptance Criteria

1. WHEN the ML_Service initiates the Pass 1 Bedrock call and WHEN the ML_Service initiates the Pass 2
   Bedrock call, THE ML_Service SHALL include the full text of the base prompt in each call.
2. WHERE a category-specific prompt file exists for the item category (one of the supported
   categories: apparel, electronics, footwear), THE ML_Service SHALL include the category prompt text
   in the Bedrock call positioned after the base prompt text so that category instructions overlay
   the base prompt.
3. IF no category-specific prompt file exists for the item category, THEN THE ML_Service SHALL
   proceed using the base prompt alone without raising an error.
4. THE base prompt SHALL instruct the model to return only a valid JSON object matching the provided
   schema, with no additional text outside the JSON object.
5. IF the base prompt cannot be loaded (missing or unreadable), THEN THE ML_Service SHALL abort the
   grading call, return an error indicating the base prompt is unavailable, and SHALL NOT submit any
   Bedrock call for that item.

### Requirement 14: Express ↔ FastAPI Integration

**User Story:** As the Grading_Backend, I want a reliable HTTP contract with the ML_Service, so that
orchestration is decoupled and resilient.

#### Acceptance Criteria

1. WHEN the Grading_Backend calls the ML_Service, THE Grading_Backend SHALL send the request to the
   configured `ML_SERVICE_URL` with a request timeout of 30 seconds.
2. THE ML_Service SHALL accept the grading request matching the `GradingRequest` Pydantic schema and
   SHALL respond with a payload matching the `GradingResponse` Pydantic schema.
3. IF the ML_Service returns an HTTP status outside the 200–299 range, or the connection fails, or
   the 30-second request timeout is exceeded, THEN THE Grading_Backend SHALL apply the degradation
   behavior of Requirement 11 and SHALL return the failure Standard_Response when no result can be
   produced.
4. IF the ML_Service returns a 200–299 status with a body that does not match the `GradingResponse`
   Pydantic schema, THEN THE Grading_Backend SHALL treat the response as a failed grading attempt,
   apply the degradation behavior of Requirement 11, and SHALL NOT persist a partial grade as final.
5. WHEN a `GET /api/grading/health` request is received, THE Grading_Backend SHALL return a health
   status in the Standard_Response envelope that indicates whether the ML_Service at `ML_SERVICE_URL`
   is reachable.

## Correctness Properties (for Property-Based Testing)

These properties are intended to be verified later with property-based tests. Each maps to acceptance
criteria above.

1. **Grade schema validity (invariant):** For all completed pipeline runs, the produced Grade_JSON
   conforms to the `grade.contract.js` schema and the `grades` Mongoose model. (Req 7.6)
2. **Grade domain (invariant):** For all produced grades, `grade ∈ {A, B, C, D}`, `confidence ∈
   {high, medium, low}`, `routingHint ∈ {resell, refurbish, donate, liquidate}`, `0 ≤ qualityScore
   ≤ 100`, and `0.0 ≤ estimatedResalePct ≤ 1.0`. (Req 7.2, 7.3, 7.4)
3. **Low-confidence always flagged (metamorphic):** For all grades where `confidence == low` or
   `missingEvidence` is non-empty, the grade is flagged for human review and auto-routing is
   withheld. (Req 9.1, 9.2, 9.3)
4. **Hard fraud short-circuits (invariant):** For all inputs producing a Hard_Fraud_Signal, neither
   Bedrock pass is invoked and the pipeline returns a fraud-rejection result. (Req 2.2)
5. **Pass 1 cache determinism (idempotence / round-trip):** For all pairs of requests with identical
   `productId` and identical normalized reason, the Pass_1_Cache key is identical and the second
   request returns the cached Form_Schema without a Bedrock call. (Req 3.2, 3.3, 3.4)
6. **Form schema round-trip:** For all generated Form_Schemas, parsing then serializing then parsing
   the schema produces an equivalent schema. (Req 3.1)
7. **Input validation rejects malformed requests (error condition):** For all trigger payloads
   missing a required field, of the wrong type, or with empty `imageUrls`, the Grading_Backend
   responds with HTTP 400 and the failure Standard_Response. (Req 1.2, 1.3)
8. **Partial-failure resilience (metamorphic):** For all runs where one specialized analysis fails
   while others succeed, an Analysis_Summary is still assembled with a warning for the failed
   analysis. (Req 6.5, 11.4)

## Persona Acceptance Realism

The pipeline must produce grades consistent with the demo personas:

- **Priya** (worn shoes, returns path) → Grade C with visible-wear defects and a `routingHint` that
  reflects low resale value.
- **Rahul** (used baby monitor, returns or sell-used) → Grade B with minor cosmetic wear and verified
  function.
- **Anjali** (DSLR, sell-used) → Grade A with no visible defects.
- **Small seller** (bulk) → each submitted item is graded independently through the same pipeline.
