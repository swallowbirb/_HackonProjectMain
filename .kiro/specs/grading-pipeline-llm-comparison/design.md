# Design Document

## Overview

This feature extends the existing Phase 2 AI Grading Pipeline (already implemented and live in `backend/src/modules/grading/` and `ml-service/app/`) with three capabilities and the persistence/surfacing needed to **compare** a baseline grading run against an enhanced one:

1. **Rekognition signals in Pass 1** — run AWS Rekognition label detection on the Pass 1 initial/clarifying photos and feed the resulting `Rekognition_Pass1_Signals` into the Gemini form-generation prompt, with clean degradation and provenance persistence.
2. **Uncapped Pass 2 LLM analysis mode** — an optional Pass 2 path that runs the Grading_LLM with an increased output-token budget and an increased Pass 2 timeout, recorded in the persisted grade, falling back to a manual-review grade on timeout while still conforming to the canonical Grade JSON contract.
3. **A DevTools toggle** — `frontend/src/components/shared/DevTools.jsx` gains a localStorage-backed "Enable LLM Analysis in Pass 2" toggle that signals the backend which Pass 2 mode to run, hidden in production builds.

Plus the comparison machinery: persist a `Comparison_Record` linking a Standard_Pass2_Mode result and an Uncapped_Pass2_Mode result for the same item, and surface both (with per-field diffs) through the existing grading read API.

### Confirmed LLM Provider (terminology resolution)

The requirements flagged an ambiguity between "Gemini" (code) and "Amazon Nova Pro / Bedrock" (notes). **The code path actually uses Google Gemini.** Verified in the codebase:

- `ml-service/app/services/gemini.py` — `GeminiService` built on the unified Google Gen AI SDK (`from google import genai`), with `invoke` / `invoke_json` calling `client.models.generate_content(...)`.
- `ml-service/app/config.py` — `gemini_api_key`, `gemini_model_primary = "gemini-2.5-flash-lite"`, `gemini_model_fallback = "gemini-2.5-flash"`, plus `gemini_timeout_seconds = 10` and `pass2_timeout_seconds = 20`.
- `form_generator.py` (Pass 1) and `grade_synthesizer.py` (Pass 2) both call `gemini_service.invoke_json(...)`.
- `backend/src/modules/grading/grading.service.js` references `GEMINI_MODEL_PRIMARY` / `GEMINI_MODEL_FALLBACK` for logging.

There is **no `gemini.py` Bedrock client and no active Nova/Bedrock code path** in the running pipeline; the Bedrock references in `Phase2-AIGradingPipeline.md` describe a superseded design. This design uses the provider-neutral term **Grading_LLM** in requirements-facing language but designs concretely against **Gemini** as implemented.

### Design Principles

- **Additive, non-breaking.** All new persisted fields are optional. `triggerGrading(itemId, { evidencePhotos, category, originalProductId })` keeps its signature. The `GRADED` lifecycle emit path is untouched for non-flagged grades.
- **Mode is a parameter, not a fork.** Pass 2 mode (`standard` | `uncapped`) flows as a single resolved value from the client toggle → backend → ML payload, defaulting to `standard` when absent.
- **Degrade, never block.** Rekognition failure in Pass 1 drops all signals and proceeds; uncapped Pass 2 timeout falls back to the existing manual-review grade.

## Architecture

### End-to-end data flow

```mermaid
flowchart TD
    subgraph FE["Frontend"]
        DT["DevTools.jsx\nLLM_Analysis_Toggle\nlocalStorage: dev_llm_analysis_pass2"]
        EV["ItemEvidencePage\n→ submitReturnEvidence /\n   submitSecondhandEvidence"]
        DS["dev.service.js\ngetPass2Mode() reads localStorage"]
    end

    subgraph BE["Backend (Express)"]
        RC["returns/secondhand controller\n+ evidence body { pass2Mode }"]
        IS["item.service.attachEvidence\n(threads pass2Mode through)"]
        GS["grading.service.triggerGrading\n(resolve mode, default standard)"]
        CMP["comparison persistence\n(Grade + Comparison_Record)"]
        API["grading.controller.getGrade\n→ comparison-aware response"]
    end

    subgraph ML["ML Service (FastAPI)"]
        P1["form_generator.generate_form\n+ Rekognition_Pass1_Signals"]
        REK["rekognition.detect_labels_bytes"]
        P2["grade_synthesizer.synthesize_grade\n(mode: standard | uncapped)"]
    end

    DT -->|persist toggle| DS
    EV -->|read mode| DS
    EV -->|POST evidence + pass2Mode| RC
    RC --> IS --> GS
    GS -->|POST /grade/ { pass2_mode }| P2
    GS -.->|POST /grade/form| P1
    P1 --> REK
    GS --> CMP
    API -->|GET /api/grading/:itemId| CMP
```

### Component ownership (where each requirement lands)

| Requirement | Primary location(s) |
|---|---|
| 1. Rekognition in Pass 1 | `ml-service/app/services/form_generator.py`, `rekognition.py`, `routers/grading.py` (`/form`), `schemas.py` (`FormRequest`/`FormResponse`); `backend grading.service.js` `startFormGeneration` (logging + provenance persist) |
| 2. Uncapped Pass 2 mode | `ml-service/app/services/grade_synthesizer.py`, `config.py` (uncapped token/timeout), `routers/grading.py` (`/grade/`), `schemas.py` (`GradingRequest`/`GradingResponse`) |
| 3. DevTools toggle | `frontend/src/components/shared/DevTools.jsx`, `frontend/src/services/dev.service.js` |
| 4. Toggle → backend | `dev.service.js`, evidence services/controllers (returns/secondhand), `item.service.attachEvidence`, `grading.service.triggerGrading` |
| 5. Comparison persistence | `backend/src/modules/grading/grading.model.js` (or a new `comparison.model.js`), `grading.service.js` |
| 6. Surfacing comparison | `grading.service.getGradeByItemId`, `grading.controller.getGrade` |
| 7. Backward compatibility | all of the above — additive only |

### Pass 2 mode resolution chain

The mode is resolved exactly once, on the backend, and defaults to `standard`:

```
client toggle (localStorage) 
  → evidence request body { pass2Mode?: 'standard'|'uncapped' }
  → attachEvidence(..., { pass2Mode })
  → triggerGrading(itemId, { ..., pass2Mode })
  → resolvedMode = (pass2Mode === 'uncapped') ? 'uncapped' : 'standard'   // default standard
  → ML payload { pass2_mode: resolvedMode }
  → grade_synthesizer.synthesize_grade(summary, mode=resolvedMode)
```

`resolvedMode` is logged via `ItemLogger` and persisted on the grade as `pass2Mode`.

## Components and Interfaces

### 1. Frontend — DevTools toggle (`DevTools.jsx`)

Add an `LLM_Analysis_Toggle` to the existing dev panel, following the established `localStorage` + `useState` pattern already used for `mock_clerk_id`.

```jsx
// constant shared with dev.service.js
const LLM_ANALYSIS_KEY = 'dev_llm_analysis_pass2';

// init from storage on mount (default disabled)
const [llmAnalysis, setLlmAnalysis] = useState(
  () => localStorage.getItem(LLM_ANALYSIS_KEY) === 'true'
);

const toggleLlmAnalysis = () => {
  const next = !llmAnalysis;
  setLlmAnalysis(next);
  localStorage.setItem(LLM_ANALYSIS_KEY, String(next)); // persist enabled/disabled
};
```

- The whole `DevTools` component is already production-gated: `const isDev = process.env.NODE_ENV !== 'production' || import.meta.env?.DEV; if (!isDev) return null;`. The toggle inherits this gate, satisfying "not rendered in production" (Req 3.7).
- Rendered as a labeled switch in a new "Grading Pipeline" section of the panel; label text indicates it enables LLM analysis in Pass 2 (Req 3.1).

### 2. Frontend — `dev.service.js`

Expose a small helper so evidence-submission code can read the resolved mode without duplicating the storage key:

```js
const LLM_ANALYSIS_KEY = 'dev_llm_analysis_pass2';

// Returns the Pass 2 mode the client is requesting based on the DevTools toggle.
export const getPass2Mode = () =>
  (localStorage.getItem(LLM_ANALYSIS_KEY) === 'true' ? 'uncapped' : 'standard');
```

Evidence submission (`return.service.submitReturnEvidence`, `secondhand.service.submitSecondhandEvidence`) includes `pass2Mode: getPass2Mode()` in the request body (Req 4.1). When the toggle is off, the value is `'standard'` (or may be omitted; the backend defaults to standard either way — Req 4.3).

### 3. Backend — evidence path threading

`return.service.submitEvidence` / `secondhand` equivalent and `item.service.attachEvidence` accept an optional `pass2Mode` in their options and forward it into `triggerGrading`. This is additive — existing callers that pass nothing get `standard`.

```js
// item.service.attachEvidence(itemId, photos, actor, opts)
//   opts now may include { fieldImages, pass2Mode }
gradingService.triggerGrading(item._id.toString(), {
  userId, evidencePhotos: allPhotos, fieldImages: item.evidenceFieldImages || {},
  category: item.category, reason: ..., intakePath: ...,
  originalProductId: ...,
  pass2Mode: opts.pass2Mode,   // NEW (optional)
});
```

### 4. Backend — `grading.service.js`

**`triggerGrading`** resolves the mode and passes it to the ML call:

```js
const resolvedPass2Mode = options.pass2Mode === 'uncapped' ? 'uncapped' : 'standard';
// log resolved mode (Req 4.5)
await ItemLogger.log(itemId, 'PASS2_MODE',
  `🎚️ Resolved Pass 2 mode: ${resolvedPass2Mode}`, { phase: 'request', pass2Mode: resolvedPass2Mode });
```

**`callMlGrade`** adds `pass2_mode: resolvedPass2Mode` to the ML request body (Req 4.2, 4.4).

**`mapMlResponseToGrade`** carries through the new optional fields the ML service returns: `pass2Mode` (echoed/resolved), `rekognitionApplied`, and the `pass2_mode_meta` (timeout/token budget used).

**`persistGrade`** — see Comparison logic below.

**`buildFallbackGrade`** — extended so the uncapped-timeout fallback path (Req 2.5) produces the existing manual-review grade with `pass2Mode: 'uncapped'` recorded and a `reviewReason: 'uncapped_pass2_timeout'`.

**`startFormGeneration`** — logs the Rekognition_Pass1_Signals label/defect counts returned by the ML `/form` response (Req 1.5) and persists them to the item's form provenance (Req 1.6).

#### Comparison persistence (Req 5)

After a grade is mapped but within a single transaction:

```js
const persistGradeAndComparison = async ({ payload, ml, resolvedPass2Mode, rekognitionApplied }) => {
  const session = await mongoose.startSession();
  try {
    let saved, comparison = null;
    await session.withTransaction(async () => {
      // Look up an existing baseline (standard) grade for this item BEFORE upsert.
      const prior = await Grade.findOne({ itemId: payload.itemId }).session(session).lean();

      saved = await Grade.findOneAndUpdate(
        { itemId: payload.itemId },
        { $set: buildGradeDoc({ payload, ml, resolvedPass2Mode, rekognitionApplied }) },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true, session }
      );

      if (resolvedPass2Mode === 'uncapped' && prior && prior.pass2Mode !== 'uncapped') {
        // Baseline exists → build + persist Comparison_Record (Req 5.1–5.4)
        comparison = await Comparison.findOneAndUpdate(
          { itemId: payload.itemId },
          { $set: buildComparisonRecord({ itemId: payload.itemId, standard: prior, uncapped: saved }) },
          { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true, session }
        );
      }
      // Else: no baseline → persist grade + note "no baseline available" atomically (Req 5.5).
      // The withTransaction wrapper guarantees all-or-nothing.
    });
    return { saved, comparison };
  } finally {
    session.endSession();
  }
};
```

The transaction guarantees that if either the grade write or the comparison write fails, neither is committed (Req 5.5).

### 5. Backend — comparison surfacing (`grading.controller.getGrade`)

`getGradeByItemId` is extended to also fetch any `Comparison_Record` and shape the response:

- Grade exists + comparison exists → return both results + per-field diffs, `comparisonAvailable: true` (Req 6.1, 6.2).
- Grade exists, no comparison → return the single grade, `comparisonAvailable: false` (Req 6.3).
- No grade → `404` in the Standard_Response envelope (Req 6.4).

```js
// getGrade controller, standard envelope already in use:
//   found:    res.status(200).json({ success: true, data: { grade, comparison?, comparisonAvailable } })
//   not found: res.status(404).json({ success: false, message: 'Grade not found for this item' })
```

### 6. ML Service — Pass 1 Rekognition (`form_generator.py`, `routers/grading.py`)

`FormRequest` already carries `initial_photos` and `listing_image_urls`. Add Rekognition to `generate_form`:

- **Req 1.4 (block when no photos):** if a Rekognition-enhanced Pass 1 is requested but `initial_photos` is empty, do **not** run the enhanced path; record that initial photos are required and proceed with the standard (non-enhanced) form generation.
- **Req 1.1/1.2:** when ≥1 initial photo is present, fetch bytes (reuse `try_fetch_image_bytes`) and call `rekognition_service.detect_labels_bytes(...)` for each, building `Rekognition_Pass1_Signals = { labels: [...], defect_candidates: [...], applied: true }`, then inject a compact text rendering of those signals into the composed Pass 1 prompt.
- **Req 1.3 (clean fallback):** wrap Rekognition in try/except; on any error, discard **all** signals collected so far (`applied: false`, `degraded: true`, `warning: ...`) and proceed with form generation without them.
- **Req 1.5/1.6:** the `FormResponse` returns `rekognition_pass1_signals` (counts + payload) and the `trace`, so the backend logs counts and persists provenance.

`FormResponse` gains an optional `rekognition_pass1_signals: Dict[str, Any] = {}`.

### 7. ML Service — uncapped Pass 2 (`grade_synthesizer.py`, `config.py`, `routers/grading.py`)

`GradingRequest` gains `pass2_mode: str = "standard"`. `synthesize_grade` accepts `mode`:

```python
# config.py additions
pass2_uncapped_timeout_seconds: int = 90     # increased Pass 2 budget (Req 2.2)
pass2_uncapped_max_tokens: int = 8192        # increased output-token budget (Req 2.2)
pass2_standard_max_tokens: int = 2000        # existing behavior

async def synthesize_grade(summary, category=None, mode="standard", trace=None):
    uncapped = (mode == "uncapped")
    max_tokens = settings.pass2_uncapped_max_tokens if uncapped else settings.pass2_standard_max_tokens
    timeout_s  = settings.pass2_uncapped_timeout_seconds if uncapped else settings.pass2_timeout_seconds
    # invoke_json wrapped in asyncio.wait_for(timeout_s); on TimeoutError raise GradeSynthesisError("uncapped_pass2_timeout")
    ...
    grade["pass2Mode"] = mode  # recorded in result (Req 2.3)
```

- **Req 2.1/2.4:** mode selects uncapped vs standard config; default standard.
- **Req 2.2:** uncapped uses larger `max_tokens` and a larger timeout.
- **Req 2.5:** on uncapped timeout, the router maps the `GradeSynthesisError` to the backend, which produces the manual-review fallback grade (existing `buildFallbackGrade`) and logs the timeout reason.
- **Req 2.6:** the result still flows through `coerce_and_validate` (`grade_validation.py`), so the canonical Grade JSON contract (enums + numeric bounds) holds regardless of mode.

`GradingResponse` gains optional `pass2_mode: str = "standard"` and `rekognition_applied: bool = False`.

## Data Models

### `grades` collection — additive optional fields (`grading.model.js`)

All existing required fields (`itemId`, `grade`, `qualityScore`, `confidence`, `defects`, `missingEvidence`, `returnClaimVerified`, `estimatedResalePct`, `routingHint`, `rationale`, `modelVersions`, `evidenceBundle`, `flaggedForReview`, `reviewReason`, `lifecycleEmission`, `status`) are preserved unchanged (Req 7.3). New **optional** fields:

```js
// added to gradingSchema
pass2Mode: { type: String, enum: ['standard', 'uncapped'], default: 'standard' },
rekognitionApplied: { type: Boolean, default: false },

// Pass 1 Rekognition provenance (Req 1.6)
rekognitionPass1Signals: {
  applied:           { type: Boolean, default: false },
  labelCount:        { type: Number,  default: 0 },
  defectCandidateCount: { type: Number, default: 0 },
  labels:            { type: [mongoose.Schema.Types.Mixed], default: [] },
  defectCandidates:  { type: [mongoose.Schema.Types.Mixed], default: [] },
  degraded:          { type: Boolean, default: false },
  warning:           { type: String },
},

// Pass 2 mode metadata (Req 2.2/2.3)
pass2ModeMeta: {
  maxTokens:    { type: Number },
  timeoutMs:    { type: Number },
  timedOut:     { type: Boolean, default: false },
},
```

`reviewReason` enum-free String already exists, so `'uncapped_pass2_timeout'` requires no schema change (Req 2.5).

### `Comparison_Record` — new model (`comparison.model.js`)

Keyed by `itemId` (Req 5.4), one comparison document per item, upserted.

```js
const resultSnapshotSchema = new mongoose.Schema({
  gradeId:            { type: mongoose.Schema.Types.ObjectId, ref: 'Grade' },
  grade:              { type: String, enum: ['A','B','C','D'] },
  qualityScore:       { type: Number },
  confidence:         { type: String, enum: ['high','medium','low'] },
  routingHint:        { type: String, enum: ['resell','refurbish','donate','liquidate'] },
  pass2Mode:          { type: String, enum: ['standard','uncapped'] },
  rekognitionApplied: { type: Boolean, default: false },
}, { _id: false });

const comparisonSchema = new mongoose.Schema({
  itemId:   { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
  standard: { type: resultSnapshotSchema },   // baseline result (Req 5.2)
  uncapped: { type: resultSnapshotSchema },   // enhanced result (Req 5.2)
  diffs: {                                     // Req 5.3 / 6.2
    grade:        { from: String, to: String, changed: Boolean },
    qualityScore: { from: Number, to: Number, delta: Number },
    confidence:   { from: String, to: String, changed: Boolean },
    routingHint:  { from: String, to: String, changed: Boolean },
  },
}, { timestamps: true });
```

Each result snapshot includes grade, qualityScore, confidence, routingHint, pass2Mode, and rekognitionApplied per Req 5.2.

### Item `evidenceForm` provenance (Pass 1 signals)

`startFormGeneration` already persists `evidenceForm` to the Item. Add an optional `evidenceForm.rekognitionPass1Signals` sub-object (counts + payload) so Pass 1 provenance is retrievable on the item too (Req 1.6). This mirrors what is stored on the grade and requires only an additive Mixed/sub-doc field on the item's `evidenceForm`.

### API / payload changes (summary)

| Surface | Change | Direction |
|---|---|---|
| Evidence request body (`/returns/:id/evidence`, `/secondhand/:id/evidence`) | `+ pass2Mode?: 'standard'\|'uncapped'` | FE → BE |
| ML `GradingRequest` | `+ pass2_mode: str = "standard"` | BE → ML |
| ML `GradingResponse` | `+ pass2_mode`, `+ rekognition_applied` | ML → BE |
| ML `FormResponse` | `+ rekognition_pass1_signals: {}` | ML → BE |
| `GET /api/grading/:itemId` | `data` may include `comparison` + `comparisonAvailable` | BE → FE |

All additions are optional/defaulted; existing consumers are unaffected (Req 7).

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

The properties below are derived from the prework analysis. Several acceptance criteria were consolidated where one property subsumes another (mode-selection criteria 2.1/2.2/2.4/4.2/4.3/4.4 into a single resolution property; diff criteria 5.3/6.2; response-shaping 6.1/6.3; contract/shape 2.6/7.1/7.3). Criteria classified as INTEGRATION (1.1, 3.5, 3.6), SMOKE (3.7), EXAMPLE (1.5, 3.1–3.3, 4.5, 7.2, 7.4), and EDGE_CASE (1.4, 2.5, 5.5, 6.4) are covered by the Testing Strategy rather than as universal properties.

### Property 1: Pass 2 mode resolution and config selection

*For any* value of the incoming Pass 2 mode signal (including `'uncapped'`, `'standard'`, `undefined`, `null`, empty string, or arbitrary garbage), the backend SHALL resolve to `'uncapped'` if and only if the signal equals `'uncapped'`, otherwise `'standard'`; the resolved mode SHALL be the value placed in the ML request payload; and the configuration selected for `'uncapped'` SHALL have both a strictly greater output-token budget and a strictly greater Pass 2 timeout than the `'standard'` configuration.

**Validates: Requirements 2.1, 2.2, 2.4, 4.2, 4.3, 4.4**

### Property 2: Toggle-to-mode mapping

*For any* string value stored under the DevTools toggle localStorage key (including absent), the resolved client request mode (`getPass2Mode()`) SHALL be `'uncapped'` if and only if the stored value is exactly `'true'`, and the initialized toggle display state SHALL be enabled under exactly the same condition, defaulting to disabled/standard otherwise.

**Validates: Requirements 3.4, 4.1**

### Property 3: Grade contract validity and backward-compatible shape

*For any* raw model output (well-formed, malformed, or partial) processed under either Pass 2 mode, the resulting Grade_Result SHALL satisfy the canonical contract — `grade ∈ {A,B,C,D}`, `confidence ∈ {high,medium,low}`, `routingHint ∈ {resell,refurbish,donate,liquidate}`, `0 ≤ qualityScore ≤ 100`, `0.0 ≤ estimatedResalePct ≤ 1.0`, every defect severity `∈ {minor,moderate,major}` — and the persisted document SHALL contain all pre-enhancement required fields, with any newly added fields being optional.

**Validates: Requirements 2.6, 7.1, 7.3**

### Property 4: Persisted grade records its resolved Pass 2 mode

*For any* grading run with a resolved Pass 2 mode and a valid grade result, the persisted grade document's `pass2Mode` SHALL equal the resolved mode used for that run.

**Validates: Requirements 2.3**

### Property 5: Rekognition signals are injected into the Pass 1 prompt

*For any* non-empty set of Rekognition_Pass1_Signals (labels and defect candidates), when at least one initial photo is present, the composed Pass 1 prompt text supplied to the Grading_LLM SHALL contain a rendering of every provided label and defect candidate.

**Validates: Requirements 1.2**

### Property 6: Rekognition failure excludes all signals and proceeds with a warning

*For any* point of failure during Pass 1 Rekognition (including after some partial signals have been collected), the signals passed into prompt composition SHALL be empty (`applied = false`), a degradation warning SHALL be recorded, and Pass 1 form generation SHALL still proceed.

**Validates: Requirements 1.3**

### Property 7: Pass 1 signals persistence round-trip

*For any* Rekognition_Pass1_Signals object produced by Pass 1, persisting it as form-generation provenance and reading it back SHALL yield equivalent label count, defect-candidate count, and payload.

**Validates: Requirements 1.6**

### Property 8: Comparison record construction is complete and item-keyed

*For any* pair of a standard-mode result and an uncapped-mode result for the same item, the constructed Comparison_Record SHALL be keyed by that `itemId`, and each of its two result snapshots SHALL contain the grade, quality score, confidence, routing hint, Pass 2 mode, and Rekognition-applied flag equal to the corresponding source result.

**Validates: Requirements 5.2, 5.4**

### Property 9: Comparison diffs are correct

*For any* pair of compared results, the recorded differences SHALL satisfy: `grade.changed` is true iff the grades differ, `confidence.changed` is true iff the confidences differ, `routingHint.changed` is true iff the routing hints differ, and `qualityScore.delta` equals the uncapped quality score minus the standard quality score.

**Validates: Requirements 5.3, 6.2**

### Property 10: Comparison is persisted only when a standard baseline exists

*For any* completed uncapped-mode run, a Comparison_Record SHALL be produced if and only if a prior standard-mode Grade_Result already exists for that item; when no such baseline exists, the new Grade_Result SHALL be persisted and marked as having no baseline available.

**Validates: Requirements 5.1**

### Property 11: Comparison-aware response shaping

*For any* requested item that has a Grade_Result, the surfaced Standard_Response SHALL include both result sets and the per-field diffs with `comparisonAvailable = true` when a Comparison_Record exists, and SHALL include the single Grade_Result with `comparisonAvailable = false` when no Comparison_Record exists.

**Validates: Requirements 6.1, 6.3**

## Error Handling

| Failure | Detection | Handling | Requirement |
|---|---|---|---|
| Rekognition unavailable/errors in Pass 1 | try/except around `detect_labels_bytes` in `form_generator` | Discard all signals (`applied=false`, `degraded=true`), record warning, proceed with non-enhanced form generation | 1.3 |
| No initial photos for enhanced Pass 1 | empty `initial_photos` check | Skip enhanced path, record "initial photos required", proceed with standard form generation | 1.4 |
| Uncapped Pass 2 exceeds uncapped timeout | `asyncio.wait_for(timeout_s)` in `synthesize_grade` → `GradeSynthesisError("uncapped_pass2_timeout")` → HTTP 502 with trace | Backend `buildFallbackGrade` produces manual-review grade (`grade=C`, `confidence=low`, `flaggedForReview=true`, `reviewReason='uncapped_pass2_timeout'`); timeout reason logged via `ItemLogger` | 2.5 |
| ML returns invalid grade shape | existing `isValidMlResponse` + `coerce_and_validate` | Fallback grade; contract still enforced by `coerce_and_validate` | 2.6 |
| Comparison transaction partial failure | `session.withTransaction` | All-or-nothing: neither grade nor comparison committed on error | 5.5 |
| Requested item has no Grade_Result | `getGradeByItemId` returns null | 404 in Standard_Response envelope (`success:false`) | 6.4 |
| Lifecycle emitter unavailable | existing `emitGraded` returns `status:'pending'` | Grade persists; emission marked pending (unchanged behavior) | 7.4 |

The pipeline preserves the existing "degrade, never block" posture: every new failure mode resolves to a usable grade or a clear not-found, never an unhandled crash that loses the user's evidence.

## Testing Strategy

### Dual approach

- **Property-based tests** verify the universal properties above across many generated inputs.
- **Unit/example tests** cover specific behaviors, logging side-effects, and the static API contract.
- **Integration/smoke tests** cover external-service wiring and environment gates.

### Property-based testing

PBT **is** appropriate here: the high-value logic (mode resolution, grade coercion/validation, diff computation, comparison construction, prompt composition, response shaping) consists of pure, input-varying functions with large input spaces. To keep PBT cheap and deterministic, AWS (Rekognition) and Gemini are **mocked**; tests target the pure logic layer, not the I/O layer.

- **Libraries:**
  - ML service (Python) pure logic — `hypothesis`.
  - Backend (Node) pure logic — `fast-check`.
- **Configuration:** each property test runs a **minimum of 100 iterations**.
- **Tagging:** each property test is tagged with a comment referencing its design property, in the format:
  `// Feature: grading-pipeline-llm-comparison, Property {number}: {property_text}`
- **Mapping:** each of Properties 1–11 is implemented by exactly **one** property-based test.
  - Properties 3 (grade contract validity) target `ml-service/app/services/grade_validation.coerce_and_validate` with `hypothesis` generators producing arbitrary/garbage raw dicts.
  - Properties 1, 2, 4, 8, 9, 10, 11 (backend logic — mode resolution, toggle mapping, mode persistence, comparison build/diff/persist condition, response shaping) use `fast-check`.
  - Properties 5, 6, 7 (Pass 1 prompt composition, degradation, provenance round-trip) use `hypothesis` against the form-generation logic with a mocked `rekognition_service`.

### Unit / example tests

- **1.5** — given signals with N labels / M defects, assert the dev-log entry records those counts.
- **3.1–3.3** — render `DevTools` in dev mode: toggle present with the expected label; clicking persists `'true'`/`'false'` to localStorage.
- **4.5** — assert `ItemLogger.log` is called with the resolved Pass 2 mode for a run.
- **7.2** — call `triggerGrading(itemId, { evidencePhotos, category, originalProductId })` with the exact documented signature (ML mocked) and assert it works unchanged.
- **7.4** — non-flagged `ok` grade → `emitGraded` invoked; flagged grade → emission skipped (regression guard).

### Edge-case tests

- **1.4** — empty `initial_photos` blocks the enhanced Pass 1 path and records the photos-required note.
- **2.5** — injected uncapped timeout yields the manual-review fallback grade with `reviewReason='uncapped_pass2_timeout'` and a logged reason.
- **5.5** — forced mid-transaction failure commits neither the grade nor the comparison.
- **6.4** — request for an item with no Grade_Result returns the 404 Standard_Response envelope.

### Integration / smoke tests (1–3 examples each)

- **1.1** — with a mocked `rekognition_service`, verify `detect_labels` is invoked before Pass 1 prompt composition when ≥1 initial photo is present.
- **3.5 / 3.6** — toggle enabled → submitted evidence run carries `pass2_mode='uncapped'` to the ML payload; disabled → `'standard'`.
- **3.7** — rendering with a production environment flag yields no DevTools / no toggle.
- **End-to-end comparison** — run a standard grade then an uncapped grade for the same item and assert a `Comparison_Record` is persisted and surfaced through `GET /api/grading/:itemId`.
