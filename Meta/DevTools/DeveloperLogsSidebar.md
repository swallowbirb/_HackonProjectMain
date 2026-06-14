# Developer Logs — Technical Reference

> **Purpose:** Total, second-by-second visibility into the intake → grading
> pipeline. Shows exactly what happened (or failed) at **every** step — including
> the ML service's internal work that used to be invisible: each S3 image fetch,
> each Bedrock model attempt (with the real AWS error), each vision call. If a
> model "just isn't working," this tool tells you precisely why, inline.

---

## What changed (and why it's 10× better)

The original sidebar only showed what the **Node backend** could see. The entire
FastAPI / ML pipeline was a **black box**: its internal steps were *reconstructed
after the fact* from the final response. So when a model call failed, all you got
was a generic `ML service returned HTTP 502` and a fallback grade — the real cause
(an expired S3 URL, `AccessDeniedException`, a model that wasn't enabled, a prompt
sent without its required images) was swallowed into a Python console warning and
never reached the browser.

The new design fixes that at the root:

| # | Upgrade | Effect |
|---|---------|--------|
| 1 | **`PipelineTrace` in the ML service** | Every internal step is recorded with phase, severity, latency, and metadata. |
| 2 | **Trace returned on EVERY response** — success, fraud-reject, *and failure* (carried inside the HTTP error detail) | The backend always gets the full internal story, even when Pass 2 crashes. |
| 3 | **`ItemLogger.ingestTrace`** | The ML trace is replayed verbatim into the same `itemLogs` stream the sidebar reads. |
| 4 | **Every image fetch is logged** | The #1 silent failure — "model ran but got no image" — is now a visible red line with the HTTP status. |
| 5 | **Every Bedrock attempt is logged** | Model id, family, prompt/image counts, latency, and the exact AWS error code per attempt (primary → fallback). |
| 6 | **Severity (`level`) + `phase` + `durationMs` + `source`** on every entry | Drives colour, the timeline, latency chips, and the server-vs-ML badge. |
| 7 | **Rebuilt UI** | Run summary, macro phase tracker, error spotlight, search, copy/export, and a **healthy-cycle reference** to compare against. |

---

## Architecture

```
┌───────────────────────────── Frontend (React) ─────────────────────────────┐
│ DeveloperLogsSidebar.jsx                                                    │
│   • Polls GET /api/items/:itemId/logs every 1.5s                            │
│   • Run summary (status · elapsed · errors · model · grade)                 │
│   • Macro phase tracker (Intake→Trust→Form→Evidence→Analysis→Grade→Result)  │
│   • Chronological timeline, coloured by severity, grouped by phase           │
│   • Latency chips, source badges (SRV / ML), expandable metadata + stacks    │
│   • Error spotlight banner · search · level filter · copy · export JSON      │
│   • "Reference" tab = annotated healthy return cycle                         │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ HTTP GET (auth-gated: owner or admin)
                                   ▼
┌───────────────────────────── Backend (Express) ────────────────────────────┐
│ GET /api/items/:itemId/logs → ItemLogger.getLogs(itemId)                    │
│                                                                             │
│ ItemLogger (backend/src/utils/itemLogger.js)                                │
│   .log(itemId, step, message, metadata)   — derives level/phase from step   │
│   .error(itemId, step, error, extra)                                        │
│   .ingestTrace(itemId, trace, { source }) — bulk-insert ML trace entries    │
│   .getLogs(itemId, limit=500)             — sort { timestamp, seq, _id }     │
│                                                                             │
│ MongoDB "itemlogs" collection                                               │
│   • fields: step, message, level, phase, source, durationMs, seq, metadata  │
│   • TTL index: auto-expire after 7 days                                     │
│   • index { itemId, timestamp, seq }                                        │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ ml.trace[]  (in the response body, OR in
                                   │             err.response.data.detail.trace)
                                   ▼
┌───────────────────────────── ML service (FastAPI) ─────────────────────────┐
│ PipelineTrace (ml-service/app/services/trace.py)                            │
│   threaded through: grading router → fraud_preflight → analysis_orchestrator│
│   → grade_synthesizer (Pass 2) → bedrock → image_utils                      │
│   form router → form_generator (Pass 1) → bedrock → image_utils             │
│                                                                             │
│ Each step: { seq, source:"ml", phase, code, level, message, ts,             │
│              since_start_ms, duration_ms?, meta? }                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## File locations

| Component | Path |
|-----------|------|
| Sidebar React component | `frontend/src/components/shared/DeveloperLogsSidebar.jsx` |
| Frontend service (getLogs) | `frontend/src/services/item.service.js` |
| ItemLogger utility | `backend/src/utils/itemLogger.js` |
| ItemLog Mongoose model | `backend/src/modules/items/itemLog.model.js` |
| Routes / controller (GET /logs) | `backend/src/modules/items/item.routes.js`, `item.controller.js` |
| Backend log emission (items) | `backend/src/modules/items/item.service.js` |
| Backend log emission + trace ingest (grading) | `backend/src/modules/grading/grading.service.js` |
| **ML PipelineTrace utility** | `ml-service/app/services/trace.py` |
| ML instrumentation | `bedrock.py`, `image_utils.py`, `fraud_preflight.py`, `analysis_orchestrator.py`, `grade_synthesizer.py`, `form_generator.py`, `routers/grading.py` |

---

## Log entry schema (MongoDB)

```js
{
  itemId:     ObjectId,   // the item this log belongs to
  step:       String,     // machine key, e.g. "BEDROCK_INVOKE"
  message:    String,     // plain-English message with emoji prefix
  level:      String,     // info | success | warn | error | debug
  phase:      String,     // init|trust|pass1|evidence|request|fraud|
                          // analysis|pass2|persist|lifecycle|complete|error
  source:     String,     // server | ml | client
  durationMs: Number,     // latency of a timed step (optional)
  seq:        Number,     // ordering tiebreaker for same-ms entries
  metadata:   Object,     // structured payload (expandable in sidebar)
  timestamp:  Date        // indexed; TTL auto-deletes after 7 days
}
```

**Backward compatible.** `level`/`phase` are auto-derived from the `step` key when
a caller doesn't set them, so existing `ItemLogger.log(...)` calls still work.

---

## Severity levels

| Level | Colour | Meaning |
|-------|--------|---------|
| `error` | 🔴 red, red left-border, red tint, **auto-expanded detail** | A step failed (image fetch, Bedrock, persistence). |
| `warn` | 🟠 amber | Degraded but recoverable (fallback served, analysis skipped, missing reference). |
| `success` | 🟢 emerald | A step completed cleanly. |
| `info` | 🔵 sky | Normal progress / a step starting. |
| `debug` | ⚪ zinc (muted) | Fine-grained detail (span starts). Hidden by the "Key" filter. |

---

## Pipeline phases (the macro tracker)

`Intake → Trust → Form (Pass 1) → Evidence → Analysis → Grade (Pass 2) → Result`

Each pill lights green when reached, **pulses blue** when it's the current phase
during a live run, and turns **red** if any error occurred in it.

---

## Complete step catalogue

### Backend (`source: server`)

| Step | Phase | Typical message |
|------|-------|-----------------|
| `INITIATE` | init | 🚀 Return / Sell-used initiated by user |
| `TRUST_COMPLETE` | trust | ✅ Trust tier: STANDARD |
| `ITEM_CREATED` | init | ✅ Item record created in database |
| `PASS1_START` | pass1 | 📝 Pass 1 form generation requested |
| `PASS1_COMPLETE` | pass1 | ✅ Pass 1 form ready in 3120ms (status=ai, 5 field(s)) |
| `PASS1_FALLBACK` | pass1 | ⚠️ Pass 1 failed; serving generic default form |
| `EVIDENCE_SUBMIT` | evidence | 📤 Evidence submitted: N photo(s) |
| `STATUS_UPDATE` | evidence/complete | 📊 Status changed to EVIDENCE_PENDING / GRADING → GRADED |
| `PASS2_START` | request | ⚙️ Starting AI grading analysis… |
| `ANALYSIS_WARNING` | request | ⚠️ No listing reference photos — visual comparison skipped |
| `FRAUD_CHECK` | request | 🛡️ ML pipeline started… |
| `GRADING_REQUEST` | request | 📡 POST /grade/ … / 📡 ML responded in 1842ms (HTTP 200) |
| `ML_UNAVAILABLE` | request | 🔌 ML pipeline did not complete. Falling back… *(error)* |
| `ML_INVALID_RESPONSE` | request | ⚠️ ML response failed shape validation |
| `PERSIST_GRADE` | persist | 💾 Persisting grade to MongoDB (grade=B, score=78…) |
| `LIFECYCLE_EMIT` | persist | ⛓️ Lifecycle GRADED emission: … |
| `GRADE_ASSIGNED` | complete | 🎯 Grade B assigned (78/100, confidence high)… |
| `GRADE_REJECTED` | complete | 🚫 Item rejected by fraud checks *(error)* |
| `REVIEW_FLAGGED` | complete | ⚠️ Flagged for human review (low_confidence) |
| `FLOW_COMPLETE` | complete | ✨ Grading complete. Ready for routing. |
| `ERROR` | error | ❌ … (carries `error` stack in metadata) |

### ML service (`source: ml`, replayed via the trace)

| Step | Phase | What it tells you |
|------|-------|-------------------|
| `GRADE_RECEIVED` / `FORM_RECEIVED` | request/pass1 | ML received the request; photo + reference counts. |
| `IMAGE_FETCH` | (any) | 📥 Fetched image (KB + content-type + latency) — or ❌ **403/404/timeout**, with a hint that the model will run without it. |
| `FRAUD_PREFLIGHT` / `FRAUD_RESULT` | fraud | Which signals ran; CLEAN / SOFT / HARD classification. |
| `ANALYSIS_FANOUT` | analysis | 🔬 4 parallel analyses starting. |
| `ANALYSIS_OPENCV` | analysis | 🎨 Colour/histogram delta vs listing (or skipped reason). |
| `ANALYSIS_CLIP` | analysis | 🧠 Visual similarity % (or unavailable reason). |
| `ANALYSIS_REKOGNITION` | analysis | 🏷️ Label count, defect candidates, top labels. |
| `ANALYSIS_TEXTRACT` | analysis | 🔤 OCR line count + sample. |
| `ANALYSIS_COMPLETE` | analysis | 🔬 Finished in Xms (+ any warnings). |
| `PASS1_CACHE` / `PASS1_IMAGES` / `PASS1_COMPLETE` / `PASS1_FALLBACK` | pass1 | Cache hit, images attached, schema generated, or fallback. |
| `PASS2_PROMPT` | pass2 | 📝 Prompt composed (chars, category). |
| **`BEDROCK_INVOKE`** | pass1/pass2 | 🤖 Per-attempt: model id, family, image count, prompt chars, max_tokens. On success: latency + response chars. **On failure: the exact AWS error code** (`AccessDeniedException`, `ValidationException`, `ResourceNotFoundException`, …) and whether it's retrying on the fallback model. |
| `BEDROCK_PARSE` | pass2 | ❌ Model returned non-JSON (with a raw preview). |
| `PASS2_GRADE` | pass2 | 🎯 Grade synthesized (grade/score/confidence/routing/model). |
| `PASS2_FAILED` / `PASS2_VALIDATION` | pass2 | ❌ Pass 2 failed or returned JSON that failed grade validation. |
| `GRADE_SHORTCIRCUIT` | response | 🚫 Hard fraud signal — rejected before grading. |
| `GRADE_DONE` | response | 🏁 Pipeline complete in Xms (N errors along the way). |
| `PROMPT_UNAVAILABLE` | request/pass1 | ❌ Base prompt could not be loaded (503). |

---

## Frontend features

- **Run summary** — status pill (Idle / Running… / Completed / Completed w/ errors
  / Needs review / Rejected), total elapsed time, error & warning counts, the
  Bedrock model actually used, and the final grade + score.
- **Macro phase tracker** — the seven-stage strip described above.
- **Error spotlight** — when a run has errors, a red banner shows the count and the
  first error message; click it to scroll straight to that log row.
- **Chronological timeline** — strict order; a thin phase-label divider appears
  whenever the phase changes. Error rows are tinted red with their detail
  auto-expanded.
- **Latency chips** — per-step `durationMs` rendered as a colour-coded chip
  (green < 0.8s, amber < 4s, red ≥ 4s).
- **Source badges** — `SRV` (backend) vs `ML` (FastAPI trace) on every row.
- **Search + level filter** — All / Key / Warn+ / Errors, plus free-text search
  over step, message, and phase.
- **Copy / Export** — copy the filtered logs as text, or download the full run as
  JSON for sharing in a bug report.
- **Auto-follow** — sticks to the newest log while you're at the bottom; the moment
  you scroll up to inspect, it disengages. Toggle it off entirely with the ↧ button.
- **Reference tab** — an annotated, in-order example of a *healthy* return cycle so
  you can eyeball exactly where a real run diverges or stalls.
- **Collapsed rail** — even when minimised to the 12px rail, a red badge shows the
  error count and a spinner shows a run in progress.

---

## What a successful cycle looks like

The **Reference** tab renders this live; here it is for quick scanning. A clean
return run produces (roughly) this sequence, in ~10–20s end to end:

```
🚀 init     INITIATE          Return initiated by user
✅ trust    TRUST_COMPLETE    Trust tier: STANDARD
📝 pass1    PASS1_START       Pass 1 form generation requested
🤖 pass1    BEDROCK_INVOKE    Calling Pass 1 form generator → amazon.nova-pro-v1:0 (primary)
✅ pass1    BEDROCK_INVOKE    Pass 1 responded in 2310ms (842 chars)
✅ pass1    PASS1_COMPLETE    Pass 1 form ready (status=ai, 5 fields)
📤 evidence EVIDENCE_SUBMIT   Evidence submitted: 3 photo(s)
📊 evidence STATUS_UPDATE     Status changed to EVIDENCE_PENDING
⚙️ request  PASS2_START       Starting AI grading analysis…
🛡️ request  FRAUD_CHECK       ML pipeline started…
📡 request  GRADE_RECEIVED    ML /grade received: 3 evidence, 2 reference
📥 fraud    IMAGE_FETCH       Fetched fraud photo #1: 412 KB (image/jpeg)   [×N]
✅ fraud    FRAUD_RESULT      Fraud preflight CLEAN — no signals
🔬 analysis ANALYSIS_FANOUT   Fanning out 4 parallel analyses
🎨 analysis ANALYSIS_OPENCV   OpenCV colour/histogram delta: 0.18
🧠 analysis ANALYSIS_CLIP     CLIP visual similarity: 87.3%
🏷️ analysis ANALYSIS_REKOGNITION  14 labels, 2 defect candidate(s)
🔤 analysis ANALYSIS_TEXTRACT     3 line(s) — "Serial: ABC123 | Model: X1"
🔬 analysis ANALYSIS_COMPLETE All 4 analyses completed cleanly in 4120ms
📝 pass2    PASS2_PROMPT      Pass 2 prompt composed (1.9k chars)
🤖 pass2    BEDROCK_INVOKE    Calling Pass 2 → amazon.nova-pro-v1:0 (primary)
✅ pass2    BEDROCK_INVOKE    Pass 2 responded in 3180ms
🎯 pass2    PASS2_GRADE       Grade B (78/100, confidence high, routing resell)
🏁 response GRADE_DONE        Pipeline complete in 9.4s (0 errors)
📡 request  GRADING_REQUEST   ML service responded in 9550ms (HTTP 200, ok)
💾 persist  PERSIST_GRADE     Persisting grade to MongoDB
⛓️ persist  LIFECYCLE_EMIT    Lifecycle GRADED emission: ok
🎯 complete GRADE_ASSIGNED    Grade B assigned (78/100)… Routing hint: resell
📊 complete STATUS_UPDATE     Item status changed: GRADING → GRADED
✨ complete FLOW_COMPLETE     Grading complete. Ready for routing.
```

When something is wrong, the divergence is obvious and **red**, e.g.:

```
❌ fraud    IMAGE_FETCH       Could not fetch fraud photo #1 (HTTP 403) — S3
                              presigned URL expired. The model will run WITHOUT
                              this image.
❌ pass2    BEDROCK_INVOKE    Pass 2 FAILED on amazon.nova-pro-v1:0 (primary):
                              AccessDeniedException — You don't have access to the
                              model. Retrying on fallback claude-3-5-sonnet…
❌ pass2    BEDROCK_INVOKE    Pass 2 FAILED on claude-3-5-sonnet (fallback):
                              ValidationException — … No models left.
🔌 request  ML_UNAVAILABLE    ML pipeline did not complete. HTTP 502: Grade
                              synthesis failed…  → fallback manual-review grade.
```

---

## Adding new log points

**Backend:**

```js
const ItemLogger = require('../../utils/itemLogger');

await ItemLogger.log(itemId, 'MY_STEP', '🔧 What happened', {
  // optional reserved keys lifted to columns:
  phase: 'analysis', level: 'success', durationMs: 123, source: 'server',
  // everything else is structured metadata (▸ detail panel):
  someKey: 'someValue',
});
```
`level`/`phase` are auto-derived from the step key if omitted. `ItemLogger.log`
never throws.

**ML service:**

```python
from app.services.trace import PipelineTrace

trace = PipelineTrace(item_id)
trace.info("analysis", "MY_STEP", "🔧 starting…", some_key="value")
with trace.step("pass2", "MY_WORK", "doing the thing…") as s:
    result = await do_work()              # exceptions are auto-recorded as errors
    s.done(f"done: {result}", count=len(result))
# attach trace.to_list() to the response (and to HTTPException detail on failure)
```
The backend ingests `response.trace` (and `err.response.data.detail.trace`)
automatically — no extra wiring needed.

---

## Design decisions

1. **Trace-in-response, not a second HTTP channel.** The ML service returns its
   trace inside the normal response (and inside the error detail on failure). No
   new endpoint, no auth between services, and it works even when the pipeline
   half-fails — the failure path is exactly when you need the detail most.

2. **Ingest before validation.** The backend replays `ml.trace` into the log
   stream *before* it validates the response shape or builds a fallback, so a
   degraded/invalid response never hides its internal story.

3. **Polling (not WebSocket).** Simpler for the hackathon; 1.5s is a good tradeoff.
   A `global.io` Socket.IO hook is emitted-to but not required.

4. **Separate from lifecycle events.** Lifecycle events are the tamper-evident
   audit log feeding the Health Card hash chain (Phase 5). Dev logs are ephemeral,
   verbose, and auto-expire after 7 days. Two different purposes.

5. **Never-throwing logger / tracer.** Both `ItemLogger` and `PipelineTrace` catch
   their own errors. A broken log must never break the grading pipeline.

6. **Fallback grade when the pipeline can't complete.** Rather than leaving the
   item stuck in `GRADING`, the backend produces a `confidence: low` fallback
   grade (Grade C) flagged for human review — and the trace makes the real reason
   visible so you can fix the root cause.

---

## API endpoint

```
GET /api/items/:itemId/logs
Authorization: Bearer <token>          (owner or admin only)
```

Returns up to **500** logs per item, sorted oldest-first (`timestamp`, then `seq`,
then `_id` as tiebreakers so ML trace entries interleave in true chronological
order):

```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "_id": "665b…",
        "itemId": "665a…",
        "step": "BEDROCK_INVOKE",
        "message": "❌ Pass 2 FAILED on amazon.nova-pro-v1:0 (primary): AccessDeniedException — …",
        "level": "error",
        "phase": "pass2",
        "source": "ml",
        "durationMs": 410.2,
        "seq": 5021,
        "metadata": { "model_id": "amazon.nova-pro-v1:0", "aws_error_code": "AccessDeniedException", "role": "primary" },
        "timestamp": "2026-06-13T14:23:45.000Z"
      }
    ]
  }
}
```
