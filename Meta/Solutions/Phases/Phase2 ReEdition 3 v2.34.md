# Phase 2 — Re-Edition 3 · v2.34

## Streaming Per-Upload Evidence Analysis ("Fragment → Synthesize")

> **Supersedes** the per-photo validation + on-submit fan-out described in
> `Phase2-AIGradingPipeline.md` and `Phase2-v3.44.md`. The dynamic Pass-1 form
> (v3.44) **stays**. What changes is everything between "user starts uploading" and
> "final grade": we stop batching all analysis at submit time and instead analyze
> **each photo the moment it is uploaded**, with a multimodal LLM, persist that
> per-image analysis as a *fragment*, and at submit time **synthesize the stored
> fragments** into the final Grade JSON.
>
> **Headline change:** OpenCV and CLIP are removed from the pipeline. They were
> producing wrong flags (false "wrong subject" / "not the same item" rejections).
> Their jobs — *is this photo clear enough?* and *is this the right part / the right
> product?* — move to the per-upload LLM call, which is what a multimodal model is
> actually good at.
>
> **STATUS: PLAN — not yet implemented.** This document is the design + implementation
> plan + the honest list of what can go wrong with the new approach.

---

## 0. TL;DR

- **Old flow:** Pass 1 form → user fills entire form → press submit → *then* fraud
  preflight + 4-way parallel analysis (OpenCV colour, CLIP similarity, Rekognition
  labels, Textract OCR) + Pass 2 synthesis. All the heavy work happened in one slow
  burst after submit, and bad photos were only caught after the user had moved on.
- **New flow:** Pass 1 form (unchanged) → **as each photo uploads, an LLM analyzes
  that single photo against its field requirement + the catalog product**, returns
  instant accept/reupload feedback, and saves a structured *evidence fragment*. On
  submit, a synthesizer compiles all stored fragments (+ cheap EXIF/phash pre-flight
  signals) into the canonical Grade JSON — **no re-analysis of raw images**.
- **Removed:** OpenCV (blur/brightness/colour) and CLIP (subject match + visual
  similarity). The LLM now judges clarity, subject, identity, defects, and reads text.
- **Kept (and why):** EXIF camera-metadata check and perceptual-hash (phash) catalog
  match — these are the two signals a vision LLM is *structurally blind to*. See §6.
- **The "milk photo on a phone listing" case** is now caught at upload time: the
  per-image LLM gets the catalog product context and replies "this looks like a
  carton of milk, not the phone you're returning — please re-upload."

---

## 1. Why the change (what was wrong)

Traced against the live code (`ml-service/app/`):

| Problem in the current pipeline | Evidence in code |
|---|---|
| **OpenCV / CLIP give wrong flags.** CLIP `subject_match` rejects valid photos; CLIP `visual_similarity` and OpenCV colour delta fire false "wrong item" signals. | `routers/vision.py` appends `wrong_subject` from CLIP; `analysis_orchestrator.py` runs `_clip_similarity` + `_color_delta`. |
| **All analysis is deferred to submit.** Bad photos aren't caught until the whole form is submitted and the slow fan-out runs. | `routers/grading.py` `grade_item` runs `run_analysis` only at `/grade/`. |
| **The "Rekognition web detection" fraud signal is fake.** It actually calls `detect_moderation_labels` (NSFW), not web detection — AWS Rekognition has no web-search API. Any moderation hit is mislabeled as a "web match." | `fraud_preflight._rekognition_web_match` → `detect_moderation_labels_bytes`. |
| **Per-image context is thrown away.** Each tool sees photos in isolation and emits numbers; nothing reasons "this specific photo answers the sole_photo field and shows heavy wear" until Pass 2 reads a flattened summary. | `analysis_orchestrator.run_analysis` builds one bulk summary. |

The new architecture fixes the first two directly and lets us delete the third.

---

## 2. Target Architecture

```
┌─ STEP A — CLAIM (unchanged from v3.44) ─────────────────────────┐
│ User initiates return / sell-used: reason + optional clarifying  │
│ photo(s). Item created → INITIATED → AWAITING_EVIDENCE.          │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ STEP B — DYNAMIC FORM (Pass 1, unchanged) ─────────────────────┐
│ Gemini generates a product+claim-specific Form_Schema. Each      │
│ field carries id, label, guidance, expected_subject, required.   │
│ PLUS a mandatory angle base-form: the seller tags catalog images │
│ front/side_left/side_right/rear, and those angles are always     │
│ required of the user (used for per-angle phash + LLM reference).  │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ STEP C — PER-UPLOAD ANALYSIS  ★ THE NEW CORE ★ ────────────────┐
│ For EACH photo the user uploads to a field:                      │
│   1. Cheap pre-flight on the file: EXIF camera-data + phash of    │
│      the upload vs the seller's SAME-ANGLE catalog image          │
│      (deterministic, no LLM, no AWS). Near-identical = stolen      │
│      catalog photo → HARD reject. Different bg = genuine → pass.   │
│   2. ONE multimodal LLM call ("Pass 1.5 — Evidence Inspector"):   │
│        input  = the photo + field {label, expected_subject} +     │
│                 catalog product summary + 1 catalog reference img  │
│                 + the user's stated reason                        │
│        output = {                                                 │
│          accepted: bool,                                          │
│          reupload_reason: str|null,   // human-readable, if reject │
│          clarity: clear|blurry|dark|cropped,                      │
│          subject_match: bool,         // right part?              │
│          identity_match: bool,        // same product as listing? │
│          observations: [ ... neutral findings ... ],              │
│          ocr_text: str|null,          // serials/labels if visible │
│          condition_signals: [ wear/damage described, NOT graded ] │
│        }                                                          │
│   3. If NOT accepted → return instant feedback to the UI with the │
│      reupload_reason; do NOT persist as a valid fragment.         │
│   4. If accepted → persist an Evidence_Fragment keyed by          │
│      (itemId, fieldId, imageHash). This is the "saved context."   │
│ Fragments accumulate as the user works through the form.          │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ STEP D — SUBMIT = SYNTHESIZE (Pass 2, slimmed) ────────────────┐
│ Required-field gate: every required field must have ≥1 accepted   │
│ fragment. On submit:                                              │
│   • Gather ALL stored fragments for the item.                     │
│   • Merge the pre-flight signals (phash/EXIF) + the claim.        │
│   • ONE text-only LLM call: synthesize fragments → Grade JSON.    │
│   • No raw images re-sent — the fragments already captured what    │
│     each image showed.                                            │
│ Output: canonical Grade JSON (grade A/B/C/D, confidence, defects, │
│ missingEvidence, routingHint, rationale) → persist + lifecycle.    │
└──────────────────────────────────────────────────────────────────┘
```

### The key conceptual shift

- **Per-image fragments describe; the synthesizer judges.** The upload-time LLM only
  records *neutral observations* ("scuff on the upper-left toe, ~2cm; logo legible;
  box intact"). It never assigns a grade or a defect severity. All grading judgment
  lives in Pass 2, exactly once, so two images can't be graded on inconsistent scales.
- **The fragment store is the evidence ledger.** Everything the system "knows" about
  the item lives as durable per-field fragments, not as transient in-flight state.
  Submit becomes a cheap, fast roll-up of that ledger.

---

## 3. Where the work lives (file-level map)

### ML service (Python)
| File | Change |
|---|---|
| `routers/vision.py` | **Rewrite** `/vision/validate-photo` → call the new Evidence Inspector instead of OpenCV+CLIP. Remove `analyze-image` if unused, or keep behind the enhanced toggle. |
| `services/evidence_inspector.py` | **New.** The per-image multimodal LLM call: compose prompt (field + catalog + reason), call `gemini_service.invoke_json` with the single image, validate the inspector schema, return accept/reject + fragment payload. |
| `services/grade_synthesizer.py` | **Modify** `synthesize_grade` to accept a list of fragments (+ preflight + claim) instead of an `analysis_summary` built from OpenCV/CLIP/Rekognition. Same canonical Grade output + `coerce_and_validate`. |
| `services/analysis_orchestrator.py` | **Retire** from the default path (no more OpenCV/CLIP/Rekognition/Textract fan-out). Keep the module only if the enhanced/comparison path (DevTools toggle) still wants Rekognition. |
| `services/clip_service.py`, `services/opencv_utils.py` | **Remove from imports/usage.** Leave files in place but unreferenced, or delete once the comparison spec no longer needs them. (CLIP deps `torch`/`transformers` can come out of `requirements.txt` → big install-size win.) |
| `services/fraud_preflight.py` | **Trim** to phash + EXIF only. Drop `_rekognition_web_match` (it was NSFW detection mislabeled as web match). |
| `models/schemas.py` | **New** `EvidenceInspectionRequest/Response`, `EvidenceFragment`. **Modify** `GradingRequest` to carry `fragments` (or have the backend send them). |
| `prompts/` | **New** `evidence_inspection.txt` (per-image). **Modify** `pass2_grade_synthesis.txt` to synthesize from fragments. |
| `routers/grading.py` | `/grade/` reads fragments → `synthesize_grade`. `/form` unchanged. |

### Backend (Node)
| File | Change |
|---|---|
| `modules/grading/grading.service.js` | **New** `inspectPhoto({ itemId, fieldId, photoUrl, ... })` proxy → ML `/vision/validate-photo`; on accept, persist the fragment. **Modify** `validatePhoto` → becomes `inspectPhoto`. `triggerGrading` gathers fragments and sends them (no raw re-analysis). |
| `modules/items/item.model.js` | **New** `evidenceFragments` sub-doc array on the Item (or a sibling `EvidenceFragment` collection): `{ fieldId, imageUrl, imageHash, accepted, observations, ocrText, conditionSignals, inspectorModel, createdAt }`. |
| `modules/items/item.service.js` | Required-field gate uses *accepted fragments* (not just "an image exists"). Fragment supersede-on-replace logic. |
| `modules/grading/grading.controller.js`, `grading.routes.js` | `POST /api/grading/inspect-photo` (replaces validate-photo semantics). |
| `modules/returns/*`, `modules/secondhand/*` | `submitEvidence` no longer needs to ship the full image set for analysis — fragments already exist; it triggers synthesis. (Keep accepting images for backward compat / fallback.) |

### Frontend (React)
| File | Change |
|---|---|
| `pages/ItemEvidencePage.jsx` | On each per-field upload, call `inspect-photo`; show inline accept ✅ / reupload ⚠️ with the LLM's `reupload_reason`; block submit until required fields have accepted fragments. |
| `services/item.service.js` | `inspectEvidencePhoto` (replaces `validateEvidencePhoto`). |

---

## 4. Implementation Plan (ordered, dependency-correct)

### Task 1 — Evidence Inspector (ML, the new heart)
- `services/evidence_inspector.py`: `inspect(photo_url, field, catalog, reason) -> dict`.
- `prompts/evidence_inspection.txt`: instruct the model to (a) decide accept/reject with
  a *lenient* bar — reject only on clear clarity failure or clear subject/product
  mismatch, never on borderline; (b) emit neutral observations + OCR + condition signals;
  (c) return strict JSON. Reuse `prompt_loader.compose` (base → category → seller-custom).
- Validate the inspector response shape; on LLM failure → **accept-with-warning**
  (never hard-block the user on an LLM hiccup — see §5 flaw #7).
- _Replaces: OpenCV blur/brightness, CLIP subject match._

### Task 2 — Pre-flight trim + per-angle phash (ML + catalog)
- **Seller angle-flagging:** add an `angle` tag (`front`/`side_left`/`side_right`/`rear`)
  to catalog images on the product model + seller listing UI. These angles become the
  mandatory base-form fields and the per-angle phash references.
- `fraud_preflight.py`: keep `exif_has_camera_data`; rework `phash_match` to compare the
  user's upload against the **same-angle** catalog image (fall back to all-angles if the
  seller didn't tag). Low Hamming threshold (~6–8) so only near-identical files HARD-flag.
  Remove `_rekognition_web_match`. `classify()` keeps phash=HARD, missing-EXIF=SOFT.
- Run pre-flight per-upload (cheap), store its result on the fragment.

### Task 3 — Fragment store (backend + model)
- `evidenceFragments` on the Item (sub-doc array) keyed by `(fieldId, imageHash)`.
- `inspectPhoto` service: proxy ML inspector → on `accepted`, upsert fragment; on
  reject, return reason and store nothing (or store a `rejected` audit entry).
- Supersede logic: re-uploading the same field replaces the prior fragment for that
  image slot; deleting a photo removes its fragment.

### Task 4 — Synthesizer rewrite (ML)
- `synthesize_grade(fragments, preflight, claim, category, mode) -> Grade JSON`.
- `pass2_grade_synthesis.txt`: synthesize across fragments, reference findings by
  **field name** ("sole_photo: heavy wear"), set `missingEvidence` from required fields
  with no accepted fragment, downgrade `confidence` when evidence is thin or fragments
  conflict, keep enum/bounds enforcement via existing `coerce_and_validate`.
- `routers/grading.py` `/grade/` reads fragments from the request (backend supplies them).

### Task 5 — Backend orchestration
- `triggerGrading`: gather accepted fragments for the item, POST them to `/grade/`,
  persist Grade + Evidence_Bundle (now includes the fragment ledger). Keep the
  `triggerGrading(itemId, { evidencePhotos, category, originalProductId })` signature
  (additive `fragments`); if no fragments exist (legacy/standalone path), fall back to a
  single batched inspector run over `evidencePhotos` so the contract still works.
- Required-field gate in `attachEvidence` checks accepted fragments.

### Task 6 — Frontend
- Per-field upload → `inspect-photo` → inline ✅/⚠️ with `reupload_reason`, retake loop,
  required-field submit gate, optional "use anyway" override (logged).

### Task 7 — Remove OpenCV/CLIP
- Strip imports/usages; drop `torch`/`transformers` (and optionally
  `opencv-python-headless`) from `requirements.txt`; delete or quarantine
  `clip_service.py` / OpenCV analysis paths. Update tests.

### Task 8 — Reconcile with the LLM-comparison spec
- The existing `grading-pipeline-llm-comparison` spec adds Rekognition-in-Pass-1 +
  uncapped Pass-2 behind a DevTools toggle. **Make that the optional "enhanced" lane:**
  the default v2.34 path is pure-LLM (no Rekognition); the toggle re-enables Rekognition
  label signals + uncapped synthesis purely for A/B comparison. No conflict — v2.34 is
  the new *baseline*. (See §7.)

### Task 9 — Tests
- Inspector: accept/reject determinism on mocked LLM (clear vs milk-on-phone case);
  LLM-failure → accept-with-warning, never hard block.
- Fragment store: supersede-on-replace, required-field gate on accepted fragments.
- Synthesizer: Grade contract validity from fragment lists; missingEvidence from
  unsatisfied required fields; persona runs (Priya→C, Rahul→B, Anjali→A).
- Pre-flight: phash=HARD short-circuit; missing-EXIF=SOFT.

### Execution order
```
Task 1 (Inspector) ─┬─► Task 3 (Fragment store) ─► Task 5 (Orchestration) ─► Task 6 (Frontend)
Task 2 (Preflight) ─┘                                   │
Task 4 (Synthesizer) ───────────────────────────────────┘
Task 7 (remove OpenCV/CLIP) and Task 8 (comparison reconcile) anytime after Task 1.
Task 9 (tests) last / alongside.
```
**Critical path:** Task 1 → Task 3 → Task 5 → Task 4 → Task 6.

---

## 5. Flaws in the New Design (and how to handle them)

This is the "look for flaws and improvements" part. The streaming approach is better
UX but it is **not free**. Honest risks:

1. **Cost: more LLM calls.** Old = ~2 LLM calls per item (Pass 1 + Pass 2). New = 1 per
   uploaded photo + 1 synthesis. A 6-photo form ≈ 7 calls.
   **Mitigation:** per-image calls use the cheap `flash-lite` tier with a single small
   image; **cache by image hash** so re-uploads / identical photos don't re-bill;
   debounce rapid re-uploads; Pass 2 is now text-only and cheaper. Net cost is
   comparable and the UX is far better. Add a per-item LLM-call budget cap.

2. **Latency per upload.** User waits ~2–5s after each photo.
   **Mitigation:** run inspection in the background (optimistic "checking…" state), let
   them keep uploading other fields; only block submit on results. Never make the user
   sit on a spinner per photo.

3. **Loss of cross-image reasoning at inspect time.** Each fragment is judged in
   isolation; "the item looks generally worn across all photos" is a whole-set judgment.
   **Mitigation:** that's *by design* — the synthesizer (Pass 2) does the cross-image
   reasoning over all fragments. Keep per-image inspection to *local* facts only. If
   fragments conflict (e.g., one says clean, one says torn), the synthesizer downgrades
   confidence and can flag for review.

4. **Fragment staleness / orphans.** Users replace, delete, or re-order photos.
   **Mitigation:** key fragments by `(fieldId, imageHash)`; supersede on replace; delete
   on photo removal; the submit-time gather only reads *currently-attached* accepted
   fragments.

5. **Two LLMs, two rubrics drift.** If the inspector ever starts grading, it'll disagree
   with the synthesizer.
   **Mitigation:** hard rule — **inspector describes, synthesizer grades.** Enforce in the
   prompt and by schema (the inspector schema has no `grade`/`severity` field).

6. **False rejections (the exact CLIP/OpenCV problem, reborn in the LLM).** A multimodal
   LLM can also wrongly reject a valid photo.
   **Mitigation:** lenient rejection bar (reject only on *clear* mismatch/clarity
   failure); always return a confidence and a specific reason; **"use anyway" override**
   so the user is never hard-blocked; log every accept/reject decision to the dev sidebar
   for tuning. Track reject-rate as a quality metric.

7. **LLM outage at upload time blocks the whole intake.** If inspection is mandatory and
   the LLM is down, users can't add photos.
   **Mitigation:** on inspector failure → **accept-with-warning** (store the fragment,
   mark `inspector: unavailable`), never block. The synthesizer still runs at submit;
   worst case the grade is flagged for review.

8. **Wrong-product detection needs reference context.** "Milk on a phone listing" only
   works if the inspector actually receives the catalog product summary + a reference
   image. Without a catalog `productId` (e.g. "bought elsewhere"), identity_match is
   weaker.
   **Mitigation:** always thread catalog `listing_data` + 1 reference image into the
   inspector; when there's no catalog product, fall back to category-level expectation
   and mark identity_match as `unknown` (not `false`).

9. **Concurrent uploads racing on the fragment doc.** Parallel field uploads writing the
   same Item.
   **Mitigation:** atomic per-fragment upserts keyed by `(fieldId, imageHash)`; never
   read-modify-write the whole array.

10. **EXIF as a fraud signal is noisy.** Phones/messaging apps strip EXIF routinely, so
    "missing EXIF" SOFT-flags many honest users.
    **Mitigation:** keep it as a *soft, informational* signal only (never hard-block);
    consider weighting it down or using it only to *raise* confidence when present rather
    than *lower* it when absent.

11. **Image-hash for fragment keys vs S3 URL.** S3 URLs can be pre-signed/changing.
    **Mitigation:** key fragments by a stable content hash (or the S3 object key), not the
    full signed URL.

12. **Backward compatibility / standalone `/grade/`.** The merge-contract
    `triggerGrading(itemId, { evidencePhotos, ... })` and `POST /api/grading/trigger` must
    still work without fragments.
    **Mitigation:** if no fragments are present, synthesize after a one-shot batched
    inspector pass over the supplied images. Contract preserved.

---

## 6. Should we ALSO remove Rekognition and EXIF? (your question)

Short answer: **drop Rekognition from the default path, keep EXIF (and phash) as cheap
non-LLM pre-flight.** Reasoning, signal by signal:

### EXIF — KEEP
A multimodal LLM sees **pixels, not the file's metadata block.** It is *structurally
incapable* of reading EXIF (camera make/model/timestamp). EXIF is the only signal that
catches "this was downloaded, not photographed" and capture-time anomalies. It costs ~0ms,
zero API calls, and the LLM can never replace it. **Keep it — but as a soft/informational
signal only** (see flaw #10; missing EXIF is common for legit users, so don't hard-block).

### phash (imagehash) — KEEP, but scoped to duplicate detection only
**Critical distinction:** phash answers *"is this the same image FILE?"* — **not** *"is this
the same PRODUCT?"* These are two different jobs:

- **Same image file (phash's real job):** catches a user who downloaded the seller's
  catalog JPG and re-submitted it as fake "evidence." The image is byte-near-identical
  (background and all), so phash nails it. The LLM has no access to your catalog hash DB
  and can't do Hamming matching, so this is uniquely phash's. **Keep as the HARD gate.**
- **Same product (NOT phash's job):** "is this actually the phone, photographed fresh?"
  → this is the **LLM Inspector's `identity_match`**, using the seller's reference image
  as context. The LLM is good at this; phash is wrong for it.

**Why the "background inconsistency" worry doesn't apply:** the concern (user's messy-room
photo won't phash-match the seller's white-studio shot) is only a problem if phash is doing
*identity*. It isn't. For *duplicate* detection, a different background is the **correct**
outcome — different background = genuine fresh photo = no match = pass. The only thing phash
should ever HARD-flag is a near-identical file (low Hamming threshold ~6–8). Identity is the
LLM's call.

**Seller angle-flagging (this design) makes phash tighter, not redundant:**
1. On the product listing, the seller tags each catalog image by angle:
   `front` / `side_left` / `side_right` / `rear`.
2. The product's **base form always requires the user to submit those same angles** (plus
   any AI/category fields from Pass 1).
3. On each upload, phash the user's `front` against the seller's `front` **specifically**
   (a per-angle duplicate check — tighter than comparing against all catalog images), while
   the LLM Inspector does identity + right-angle + clarity + condition on the same photo.

**Hackathon decision — don't over-engineer:** no background removal, no segmentation, no
crop normalization. phash stays full-image (correct for duplicate detection); the LLM owns
identity. Known gap left intentionally: phash can't catch a *photo-of-a-photo* (camera
pointed at the catalog image on a screen) — nothing cheap can, so it's out of scope.

### Rekognition — REMOVE from the default path (make it optional)
Two honest points:
1. **Your "web detection" never existed.** The pre-flight `_rekognition_web_match` calls
   `detect_moderation_labels` (NSFW detection) and *relabels* any hit as a "web match."
   AWS Rekognition has **no web-search/reverse-image API** (that's Google Vision). So the
   "caught a Google image" capability the original doc promised is not real. Removing it
   loses nothing you actually had.
2. **Rekognition label detection is now redundant.** Its job was named-defect detection
   with bounding boxes. The per-image Evidence Inspector LLM already *describes* defects
   ("scuff, upper-left, ~2cm") in context, which is what feeds the grade. A generic CNN
   label classifier ("Tear 94%") is exactly the kind of tool that, like CLIP/OpenCV, fires
   confident-but-wrong flags. You're removing the others for that reason; Rekognition
   belongs in the same bucket for the default path.

**But don't delete the Rekognition code.** Keep it wired behind the existing DevTools
toggle from the `grading-pipeline-llm-comparison` spec, so you can run an A/B
"LLM-only vs LLM+Rekognition" comparison. That's its remaining legitimate use: an
*independent cross-check*, not a primary signal.

### "Will the LLM handle everything?"
For the *grading* job, mostly yes — clarity, subject match, product identity, defect
description, and OCR (replacing OpenCV, CLIP, Textract, and Rekognition labels). The two
things the LLM **cannot** do, and which therefore stay as non-LLM pre-flight, are:
- **EXIF metadata** (it's not in the pixels), and
- **perceptual-hash matching against your catalog** (it needs your hash DB + distance math).

So: LLM for everything it can *see*; two tiny deterministic checks for the two things it
*can't*.

### Recommended final tool set
| Stage | Tool | Status |
|---|---|---|
| Pre-flight (per upload) | phash vs **same-angle** catalog image | **Keep** — HARD gate, duplicate-detection only |
| Pre-flight (per upload) | EXIF camera-data | **Keep** — SOFT/info only |
| Per-upload analysis | Evidence Inspector LLM | **New** — replaces OpenCV+CLIP |
| Submit | Grade Synthesizer LLM (text-only) | **Keep** — now fed fragments |
| Optional enhanced lane | Rekognition labels | **Toggle-only** (comparison) |
| Removed | OpenCV (blur/brightness/colour) | **Remove** |
| Removed | CLIP (subject/similarity) | **Remove** |
| Removed | Rekognition "web match" (was NSFW) | **Remove** |
| Removed (default) | Textract OCR | **Folded into Inspector LLM** |

---

## 7. Reconciling with the `grading-pipeline-llm-comparison` spec

That spec (Rekognition-in-Pass-1, uncapped Pass-2, DevTools toggle) was written against
the *old* batch architecture. Under v2.34:

- The **DevTools toggle** stays meaningful: OFF = v2.34 pure-LLM baseline (no Rekognition);
  ON = "enhanced" lane that re-enables Rekognition label signals (in inspection and/or
  synthesis) + uncapped synthesis, so you can compare grades.
- **Comparison_Record** persistence still applies — it now compares "fragment-synthesis,
  LLM-only" vs "fragment-synthesis + Rekognition + uncapped."
- The contract guarantees (`triggerGrading` signature, canonical Grade shape, `GRADED`
  lifecycle event) are unchanged.

This keeps both efforts coherent: **v2.34 is the new baseline; the comparison spec becomes
the enhanced/experimental lane.**

---

## 8. Data shapes

### Evidence Inspector — response (per upload)
```jsonc
{
  "accepted": true,
  "reupload_reason": null,            // human string when accepted=false
  "clarity": "clear",                 // clear | blurry | dark | cropped
  "subject_match": true,              // right part of the item?
  "identity_match": "yes",            // yes | no | unknown (no catalog ref)
  "observations": ["minor scuff on upper-left toe ~2cm", "laces intact"],
  "ocr_text": "SN: A1B2C3",           // null if none visible
  "condition_signals": ["light wear", "no structural damage"],
  "inspector_model": "gemini-2.5-flash-lite",
  "inspector_status": "ok"            // ok | unavailable (LLM down → accept-with-warning)
}
```

### Evidence_Fragment — persisted (the "saved context")
```jsonc
{
  "fieldId": "sole_photo",
  "imageUrl": "s3://.../sole.jpg",
  "imageHash": "ph:ab12…",            // stable key, not the signed URL
  "accepted": true,
  "observations": [...],
  "ocrText": "SN: A1B2C3",
  "conditionSignals": [...],
  "preflight": { "phashMatch": false, "exifCameraData": true },
  "inspectorModel": "gemini-2.5-flash-lite",
  "createdAt": "2026-…"
}
```

### Pass 2 input = `{ claim, category, fragments: [Evidence_Fragment], preflight }`
Output = the existing canonical Grade JSON (unchanged contract).

---

## 9. Definition of Done

1. ✅ Uploading a photo to a form field triggers ONE Evidence Inspector LLM call that
   accepts or asks for re-upload **with a specific human-readable reason**, in real time.
2. ✅ The "milk photo on a phone listing" case returns an instant re-upload request.
3. ✅ Accepted uploads persist an Evidence_Fragment keyed by `(itemId, fieldId, imageHash)`;
   replacing/deleting a photo supersedes/removes its fragment.
4. ✅ OpenCV and CLIP are fully removed from the pipeline (no imports, deps trimmed).
5. ✅ EXIF + phash remain as cheap non-LLM pre-flight; Rekognition is off the default path
   (toggle-only); the fake "web match" signal is deleted.
6. ✅ Submit is gated on required fields having accepted fragments; submit triggers a
   **text-only** synthesis over stored fragments → canonical Grade JSON (enums + bounds
   enforced via `coerce_and_validate`).
7. ✅ No raw images are re-analyzed at submit; the final grade references findings by
   field name.
8. ✅ LLM outage at upload → accept-with-warning (never hard-block); LLM outage at submit →
   manual-review fallback grade.
9. ✅ `triggerGrading(itemId, { evidencePhotos, category, originalProductId })` and
   `POST /api/grading/trigger` still work with no fragments (one-shot inspector fallback).
10. ✅ `GRADED` lifecycle event still emitted for non-flagged grades via the existing
    emitter; Grade document shape backward-compatible.
11. ✅ Persona integration runs produce Priya→C, Rahul→B, Anjali→A.
12. ✅ Reject-rate and per-item LLM-call count are observable for tuning/cost control.

---

## 10. Open TODOs carried forward

- [ ] Seller-custom prompt overlay (base → category → seller-custom) — the inspector and
      synthesizer prompts must both route through `prompt_loader.compose(..., seller_prompt)`.
- [ ] Decide fragment storage: Item sub-doc vs sibling `EvidenceFragment` collection
      (sibling scales better if a single item can accrue many photos).
- [ ] Image-hash strategy for fragment keys (phash vs S3 object key).
- [ ] Per-item LLM-call budget cap + caching policy for re-uploads.

---

## 11. Prompt Fine-Tuning System (v2.34 addendum — IMPLEMENTED)

The grader is now tuned entirely through editable prompts composed in three layers.

### Composition order
```
Base prompt (admin)  →  Category prompt (admin, bundled)  →  Seller prompt (per product)  →  task body
```
- **Base (admin):** the platform rubric. Now opens with a MANDATORY image-verification gate —
  the model must verify identity / subject / authenticity BEFORE any condition analysis, and
  request a re-upload on failure. For baseline angle fields (front/rear/left/right) the goal is
  simply "is the product real and present from this angle."
- **Category (admin, bundled):** similar categories share one overlay. Bundles shipped:
  `apparel`, `footwear`, `electronics`, and `consumables` (skincare + cosmetics + pharma +
  supplements + grocery → one "sealed/opened ⇒ liquidate, never resell" rule).
- **Seller (per product):** free-text `gradingInstructions` on each product, advisory only —
  refines but never overrides the platform rubric.

### Where it lives
- **Backend module `modules/prompts/`** — `PromptConfig` model (scope `base|category`, key,
  content, version), admin-only CRUD at `GET/PUT /api/prompts` + `POST /api/prompts/reset`.
  `prompt.service.js` owns the category-bundle map and the shipped defaults (DB overrides files).
- **Product** — `gradingInstructions` (seller prompt) + `imageAngles` (seller angle tags) fields;
  editable from the seller's Edit Listing page.
- **grading.service.js** — `_resolvePrompts(category, sellerPrompt)` fetches base + category from
  the DB and passes `base_prompt` / `category_prompt` / `seller_prompt` into every ML call
  (form, inspect, grade). Never throws — falls back to ML-bundled files.
- **ML service** — `prompt_loader.compose(..., base_override, category_override)` uses the
  injected admin prompts when present. Pass-1 form fields now also emit a per-field
  `validation_criteria` (the acceptance test), which the Evidence Inspector enforces so an
  off-target photo (a cat for a "front screen cracked" field) is rejected with a specific reason.
- **Admin dashboard** — new "AI Prompts" tab: edit/save/reset base + each category prompt.
- **Frontend evidence flow** — threads each field's `validation_criteria` into `inspect-photo`.

### Verification-first behavior (what you asked for)
1. Every uploaded photo is verified before condition analysis (base prompt gate + inspector STEP 1).
2. Baseline angle fields verify the product is genuine/present from that angle.
3. AI-generated fields carry `validation_criteria`; the inspector checks the photo matches the
   field's intent and requests a re-upload (with reason) when it doesn't.
4. Red-flag (wrong item / wrong subject / unclear / stolen catalog image) ⇒ immediate, specific
   re-upload request; nothing is graded until it passes.

---

## 12. Further Robustness & Customization Ideas (through prompts)

Ranked by leverage; none are built yet — candidates for the next iteration.

1. **Prompt versioning + provenance on the grade.** Stamp the resolved base/category/seller
   prompt versions into the Evidence_Bundle so every grade is reproducible and disputes can be
   traced to the exact instructions in force.
2. **Few-shot exemplars per category.** Let admins attach 2–3 labeled example photos + the
   correct grade to a category prompt. Few-shot anchoring is the single biggest accuracy lever
   for a frozen LLM — far more than prose tweaks.
3. **Seller prompt guardrails / linting.** Run a quick LLM or rule pass over seller
   `gradingInstructions` to strip attempts to inflate grades ("always grade A") so the advisory
   overlay can't be abused. Show sellers a preview of how their text composes.
4. **A/B prompt experiments.** Reuse the existing DevTools toggle + Comparison_Record to run
   "prompt vA vs vB" on the same item and measure grade drift before promoting a prompt to default.
5. **Structured prompts instead of prose.** Store category rules as JSON (defect→severity
   thresholds, liquidate triggers, required fields) and render them into the prompt. Easier to
   validate, diff, and reason about than free text.
6. **Per-field inspector strictness knob.** Let the Pass-1 form (or seller) mark a field
   `strict` vs `lenient` so identity-critical shots (serial, seal) reject aggressively while
   cosmetic shots stay forgiving — tuned via the `validation_criteria` wording.
7. **Confidence calibration prompt.** A short rubric that maps evidence completeness → confidence
   band, so "high confidence" means the same thing across categories and sellers.
8. **Localized / multilingual prompts.** Per-locale base/category overlays so reupload reasons
   and rationales render in the user's language.
9. **Prompt cache keying by version.** Include the prompt-version hash in the Pass-1 cache key so
   editing a prompt automatically invalidates stale cached forms.
10. **Reject-rate feedback loop.** Track inspector reject-rate per field/category; surface fields
    with abnormally high rejects to admins as "this prompt may be too strict" tuning signals.
