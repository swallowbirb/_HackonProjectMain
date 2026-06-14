# Phase 2 — Re-Edition 3 · v2.35

## Per-Field Batched Inspection ("Verify the Field, Not the Photo")

> **Refines** `Phase2 ReEdition 3 v2.34.md`. v2.34 removed OpenCV/CLIP and made
> the LLM the per-upload judge (one inspection call per photo). v2.35 keeps
> everything v2.34 did **except the unit of inspection**: instead of judging
> photos one at a time, we judge the **whole photo set for a single form field
> as one unit**. Triggered explicitly by the user via a per-field "Submit
> Field" button.
>
> **Headline change:** the inspector receives `photo_urls: [...]` for one
> field, not `photo_url: "..."`. Acceptance is per-field, not per-photo. A
> "Side Views" field that requires both sides is now judged once after the
> user has uploaded both — exactly the way a human reviewer would do it.
>
> **STATUS: IMPLEMENTED.** Builds on the v2.34 code (Evidence Inspector,
> Evidence_Fragment store, fragment-based synthesizer). The single-photo
> v2.34 path is preserved as a back-compat shim that delegates to the new
> field-level call.

---

## 0. TL;DR

- **What v2.34 shipped:** every photo, the moment it uploads, hits the LLM. One
  call per photo. Each accepted call writes one Evidence_Fragment keyed by
  `(fieldId, imageHash)`.
- **What's broken with that:** a field that legitimately requires multiple
  photos (e.g. "Side Views — both left and right") gets each photo judged in
  isolation. The first side uploaded is rejected as "this only shows one
  side" — which is technically correct for that single image, but wrong for
  the field as a whole.
- **What v2.35 changes:** the user uploads as many photos as they want for a
  field. **Nothing is sent to the LLM until the user clicks "Verify Field."**
  At that point the ML service receives all of that field's photos in one
  call, judges whether the photo set satisfies the field's requirement,
  records cross-photo observations, and writes ONE field-level fragment.
- **What's preserved:** the dynamic Pass-1 form, fragments-as-evidence-ledger,
  text-only Pass-2 synthesis, fraud preflight (phash + EXIF), prompt overlay
  composition, fallback contracts. Only the inspection batching and the
  fragment cardinality change.

---

## 1. Why a Verify button (and not "auto on N photos")

Three options were considered. The button wins because it solves the right
problem for the smallest UX cost.

| Option | Verdict | Why |
|---|---|---|
| **A — Auto-inspect on every upload** (v2.34) | ❌ broken | The inspector can't satisfy multi-photo requirements; flagged the screenshot. |
| **B — Auto-inspect when the field's photo count crosses a threshold** | ❌ fragile | We'd need the LLM to predict "how many" — but the field's `expected_subject` is free-text English ("two photos, one of each side"). Counting from prose is unreliable, and any silent threshold either under- or over-fires. |
| **C — Explicit per-field Verify button** | ✅ chosen | The user signals "I'm done with this field." We get one batched call at the moment intent is unambiguous. Latency cost is borne once per field, not per photo. |

**Submit-time fallback.** If the user clicks Submit without explicitly
verifying every field, the backend treats unverified fields as "verify now":
it fires the field inspection inline, then proceeds. So Verify is a UX
shortcut, not a wall — there's exactly one inspection per field per submit.

---

## 2. Target Flow

```
┌─ STEP A — CLAIM (unchanged from v3.44 / v2.34) ──────────────────┐
│ Item created → reason → AWAITING_EVIDENCE.                       │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ STEP B — DYNAMIC FORM (Pass 1, unchanged) ──────────────────────┐
│ Gemini emits Form_Schema; fields carry id/label/expected_subject │
│ /validation_criteria/required.                                   │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ STEP C — PER-FIELD BATCHED INSPECTION  ★ NEW IN v2.35 ★ ────────┐
│ For EACH field:                                                  │
│   1. User uploads N photos. Each upload runs:                    │
│        • S3 PUT (always)                                         │
│        • cheap deterministic preflight (phash same-angle + EXIF) │
│        • a HARD-flag short-circuit on phash match (no LLM, just  │
│          immediate re-upload request — same as v2.34)            │
│      → photos are staged in a "draft" state in the UI; NO LLM     │
│        is called yet for non-flagged uploads.                    │
│   2. User clicks "Verify Field" → backend posts {fieldId,        │
│      photo_urls[], context} to ML /vision/inspect-field.         │
│   3. ML makes ONE multimodal LLM call with ALL of that field's   │
│      photos as inputs, returning a single field-level decision:  │
│        {                                                         │
│          accepted: bool,                                         │
│          reupload_reason: str|null, // field-level instruction   │
│          per_photo: [                                            │
│            { image_url, role, usable, note }                     │
│          ],                                                      │
│          observations: [...],         // across the set          │
│          ocr_text_per_photo: {url:str},                          │
│          condition_signals: [...],    // across the set          │
│          missing_views: [...]         // e.g. ["left side"]      │
│        }                                                         │
│   4. Backend persists ONE field-level Evidence_Fragment for      │
│      this field (replacing any prior one for this fieldId), and  │
│      drops any per-photo fragments that previously belonged to   │
│      this field. Re-verifying supersedes.                        │
│ Fields accumulate verified fragments as the user works.          │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ STEP D — SUBMIT (synthesis, unchanged from v2.34 in spirit) ────┐
│ Required-field gate: every required field must have a            │
│ field-level fragment with accepted=true.                         │
│   • If a required field has uploads but was never Verified, the  │
│     submit handler fires inspect-field inline on its behalf.     │
│   • If a required field has no uploads at all, submit is blocked │
│     with "missing: <field name>".                                │
│ Then: ONE text-only synthesis call over the field-level          │
│ fragments → canonical Grade JSON. (Same Pass-2 contract.)        │
└──────────────────────────────────────────────────────────────────┘
```

### What the LLM call receives (per field)

- The N photos for THIS field as multimodal inputs.
- The field's `id`, `label`, `expected_subject`, `validation_criteria`.
- The catalog product summary + 1 same-angle reference image.
- The user's stated reason / claim.
- The full prompt overlay chain (admin base → admin category → seller).

### What changes vs v2.34

| Concern | v2.34 | v2.35 |
|---|---|---|
| Inspection unit | one photo | one field's photo set |
| Inspection trigger | every upload (auto) | explicit "Verify Field" button (or implicit at submit) |
| LLM calls per field | N (one per photo) | 1 (regardless of photo count) |
| Fragment cardinality | one fragment per `(fieldId, imageHash)` | one fragment per `fieldId` (carrying the photo set) |
| Required-field gate | "≥1 accepted fragment in this field" | "field-level fragment is accepted" |
| Multi-photo correctness | broken (rejects valid first-of-N uploads) | correct (judges the set, knows what's missing) |
| Cost per item | 1 call/photo + 1 synthesis (e.g. 7 for 6 photos) | 1 call/field + 1 synthesis (e.g. 4 for 6 photos across 3 fields) |
| Latency the user perceives | 2–5s after every photo | 0s after photos, 2–5s once per field on Verify |

---

## 3. File-level change map

### Frontend

| File | Change |
|---|---|
| `pages/ItemEvidencePage.jsx` | Replace per-upload `inspectEvidencePhoto` with: (a) S3 upload only on file-pick, (b) per-field `Verify` button, (c) per-field state machine `{ idle → uploading → ready → verifying → verified | rejected }`, (d) field-level reupload banner driven by `reupload_reason`, (e) optional per-photo "usable/note" overlay from `per_photo[]`, (f) submit handler verifies any unverified-but-uploaded required fields inline before calling submit. Remove the implicit "filter rejected on accept" cleanup — photos persist until the user explicitly removes them. |
| `services/item.service.js` | New `verifyEvidenceField({ itemId, fieldId, fieldLabel, expectedSubject, validationCriteria, photoUrls, ... })`. Keep `inspectEvidencePhoto` as a thin wrapper for back-compat. |

### Backend

| File | Change |
|---|---|
| `modules/grading/grading.controller.js` | New `verifyField` controller. |
| `modules/grading/grading.routes.js` | New `POST /api/grading/verify-field`. Keep `inspect-photo` (back-compat). |
| `modules/grading/grading.service.js` | New `verifyField({ itemId, fieldId, fieldLabel, expectedSubject, validationCriteria, photoUrls, reason, category, productId })` → ML `/vision/inspect-field`; on accept, **upsert ONE field-level fragment** (replace any prior fragment for this fieldId, including any leftover per-photo fragments from v2.34 data). On reject, store nothing (or store an audit-only `rejected` snapshot — see flaw #3). The existing `inspectPhoto` becomes a single-photo wrapper around `verifyField`. |
| `modules/items/item.model.js` | Extend the `evidenceFragments` sub-doc schema: add `imageUrls: [String]` (the field's photo set), `perPhoto: [{ imageUrl, role, usable, note }]`, `missingViews: [String]`. Keep the legacy `imageUrl` / `imageHash` for back-compat with v2.34 fragments still in the DB. Either field-level OR photo-level fragments are valid; the synthesizer handles both. |
| `modules/items/item.service.js` | The required-field gate keeps its current shape (an entry exists in `fieldImages` for the field) but is augmented: if a field has uploads but no `accepted` field-level fragment, the gate triggers inline verification before letting submit through. |

### ML service

| File | Change |
|---|---|
| `models/schemas.py` | New `FieldInspectionRequest { item_id, field_id, field_label, expected_subject, validation_criteria, photo_urls: List[str], listing_data, catalog_image_urls, reason, category, base_prompt, category_prompt, seller_prompt }`. New `FieldInspectionResponse { accepted, reupload_reason, per_photo: [{ image_url, role, usable, note }], observations, ocr_text_per_photo: dict, condition_signals, missing_views, preflight_per_photo, inspector_model, inspector_status, trace }`. Extend `EvidenceFragment` (used in Pass-2 input) to optionally carry `image_urls`, `per_photo`, `missing_views`. |
| `services/evidence_inspector.py` | New `inspect_field(photo_urls, ..., field, listing, catalog, ...)` that fetches all photos, runs the per-photo phash preflight on each (HARD-rejects the field if any photo phash-matches the catalog — same fail-fast as v2.34), then makes ONE multimodal Gemini call with all photos. Update `build_analysis_summary` to flatten field-level fragments (with `image_urls` and `per_photo`) into the Pass-2 summary. Keep `inspect_photo` as a single-photo wrapper that delegates to `inspect_field` with a one-element list. |
| `prompts/evidence_inspection.txt` | Rewrite for the multi-image case. Tell the model: "You're seeing N photos for ONE field. Judge whether the field's requirement is satisfied by the SET as a whole. If only some photos are usable but the requirement is still met, accept. If the requirement isn't met, list the missing views in `missing_views` and write a single field-level reupload_reason. For each photo emit `{role, usable, note}` (e.g. role='left side', usable=true)." |
| `routers/vision.py` | New `POST /vision/inspect-field` route; existing `/vision/inspect-photo` keeps working as a single-photo proxy. |
| `services/grade_synthesizer.py` | No contract change. Update the prompt template `pass2_grade_synthesis.txt` to reference `image_urls`/`per_photo` shape when present, and to reason over `missing_views` rather than per-photo identity flags. The output Grade JSON shape is unchanged. |

### What's left untouched
- Pass-1 form generation (form_generator + prompts) and the form schema.
- Fraud preflight (phash + EXIF) — runs per photo at upload time, gating the LLM call.
- Pass-2 grade synthesis contract (Grade JSON, `coerce_and_validate`, lifecycle emission).
- Admin prompt config, seller `gradingInstructions`, prompt overlay composition.
- Backend → ML `triggerGrading` contract.

---

## 4. Implementation Plan (ordered)

### Task 1 — Schemas + ML inspect-field (foundation)
- Add `FieldInspectionRequest/Response` to `schemas.py`, extend `EvidenceFragment` with optional `image_urls` / `per_photo` / `missing_views`.
- Implement `inspect_field` in `evidence_inspector.py`. Run phash preflight per photo first (any HARD match → reject the field with the same stock-photo-theft message). On preflight pass, fetch all bytes and call Gemini once with the multi-image array.
- Add `/vision/inspect-field` to `routers/vision.py`.
- Rewrite `prompts/evidence_inspection.txt` for the multi-image case.

### Task 2 — Backend verify-field endpoint + fragment upsert
- New `POST /api/grading/verify-field` (controller + route + service).
- `grading.service.verifyField` proxies to ML, on accept upserts ONE fragment by `fieldId` (and removes any v2.34 per-photo fragments for the same fieldId so the synthesizer doesn't double-count).
- Make `inspectPhoto` a thin shim that calls `verifyField` with a single-photo list — keeps back-compat for any code path still hitting it.

### Task 3 — Item model extension
- Extend `evidenceFragments` schema with `imageUrls`, `perPhoto`, `missingViews`. Mark legacy fields nullable; existing v2.34 fragments keep working.

### Task 4 — Frontend per-field flow
- Refactor `ItemEvidencePage.jsx`:
  - On file-pick, S3-upload only; status='ready' (not 'validating').
  - Per-field "Verify Field" button, disabled until ≥1 photo is ready.
  - On click, call `verifyEvidenceField`. While in flight, field state='verifying' with disabled add/remove.
  - On accepted: lock the field as 'verified'; show ✅ banner; the user can still edit (which moves it back to 'ready' and clears 'verified').
  - On rejected: keep the photos; show field-level red banner with `reupload_reason`; per-photo overlays for any photo where `per_photo[i].usable === false`.
  - Remove the "filter rejected/error on accept" cleanup so nothing silently disappears.
- Add `verifyEvidenceField` to `services/item.service.js`.

### Task 5 — Submit behavior
- In `ItemEvidencePage.jsx` submit handler: for any required field that has uploads but no `verified` state, fire `verifyEvidenceField` first; only proceed when all required fields are `verified`.
- In `item.service.js` (backend) `attachEvidence`: optionally double-check that `evidenceFragments` covers required fields; if not, leave the existing photo-presence gate in place (the frontend already does the verify step).

### Task 6 — Synthesizer + Pass-2 prompt update
- Update `build_analysis_summary` to handle field-level fragments (with `image_urls`/`per_photo`).
- Update `pass2_grade_synthesis.txt` to consume `missing_views` and per-field photo sets.
- No contract changes to Grade JSON.

### Task 7 — Tests + dev sidebar
- ML: `inspect_field` accepts when set satisfies, rejects with `missing_views` when it doesn't.
- Backend: `verifyField` upserts one field-level fragment; subsequent `verifyField` for same field replaces it; legacy per-photo fragments under that fieldId are dropped.
- Frontend: per-field state transitions; submit triggers inline verify for required-but-unverified fields.

### Critical path
```
Task 1 (ML inspect-field) ─► Task 2 (backend) ─► Task 4 (frontend) ─► Task 5 (submit)
Task 3 (model) runs alongside Task 2.
Task 6 (synthesizer prompt) runs alongside Task 4 — independent.
Task 7 (tests) last / alongside.
```

---

## 5. Flaws to plan for

1. **Latency on Verify with many photos.** Six photos to one field = a heavier
   Gemini call than v2.34's per-photo. Mitigation: per-field photo cap (e.g.
   8) at the form-schema level; downscale photos to a sane edge length before
   sending; show a clear "verifying field…" state with progress hint.

2. **The user clicks Verify too early (one of two photos).** That's actually
   the *correct* behavior of v2.35: the field is rejected with "missing the
   left side." The UX point is to make this not feel like a setback — show
   the per-photo `usable` state so the user sees their first photo was
   accepted, just incomplete.

3. **Re-verify churn.** User adds a photo, hits Verify, fails, adds another,
   hits Verify again. Each click is a fresh LLM call. Mitigation: cache by
   `hash(sorted(photo_urls) + fieldId + product + reason + prompt_version)`;
   re-verify with the same set is a cache hit.

4. **Submit-time inline verify can race.** If the user clicks Submit while a
   manual Verify is already in flight for the same field, we get duplicate
   inspections. Mitigation: per-field promise dedupe in
   `grading.service.verifyField` keyed by `(itemId, fieldId)`.

5. **Per-photo phash preflight on a 6-photo set is 6 hashings.** That's still
   ~tens of ms total — fine. Document it so no one tries to batch the
   preflight too.

6. **Legacy v2.34 per-photo fragments coexist with v2.35 field-level
   fragments.** Synthesizer must accept both. Specifically: when both exist
   for the same fieldId (during/after a v2.35 verify), drop the per-photo
   ones; the field-level fragment is authoritative. Codify this in
   `build_analysis_summary`.

7. **The "remove first image" symptom.** v2.34's frontend has
   `photos.filter(p => p.status !== 'rejected' && p.status !== 'error')` on
   every accept, which silently eats rejected entries when a later photo is
   accepted. v2.35 removes that filter outright — photos persist in the UI
   until the user explicitly removes them. (Independent fix — happens
   during Task 4 regardless.)

8. **Cross-field reasoning.** The inspector still only sees one field at a
   time. If the user contradicts themselves across fields (e.g. one field
   says "screen intact," another shows a cracked screen), only Pass-2
   notices. That's the same trade as v2.34 and is by design — Pass-2 is
   where cross-image judgement lives.

9. **Per-photo `role` labels are LLM-emitted free text.** Don't try to enum
   them; treat them as descriptive strings that the synthesizer can quote.

10. **Cost.** A field with one photo costs the same as v2.34 for that field.
    A field with six photos costs less than v2.34 (1 call vs 6). Net per
    item: roughly equal or cheaper.

---

## 6. Backwards compatibility

- `POST /api/grading/inspect-photo` and `POST /vision/inspect-photo` keep
  working — implemented as single-photo wrappers over the new field-level
  call. Anyone still calling them gets the v2.35 logic transparently.
- `triggerGrading(itemId, { evidencePhotos, ... })` and `POST
  /api/grading/trigger` are unchanged. If no fragments exist, the ML service
  still does a one-shot inline inspection over the supplied photos before
  synthesis.
- Existing v2.34 per-photo fragments in MongoDB stay valid; the synthesizer
  reads them. As soon as a user re-verifies a field on v2.35, the per-photo
  fragments under that fieldId are removed and replaced with a single
  field-level fragment.
- Grade JSON contract is unchanged. Lifecycle `GRADED` emission is unchanged.

---

## 7. Definition of Done

1. ✅ A field's photos are NOT inspected on upload. Each upload performs only
   S3 PUT + the deterministic phash/EXIF preflight.
2. ✅ A "Verify Field" button per photo field triggers ONE multimodal LLM
   call that judges the WHOLE photo set for that field, returning a
   field-level accepted/rejected decision plus optional per-photo notes.
3. ✅ The "Side Views — both left and right" case is rejected when the user
   uploads only one side, with a `missing_views` of `["left side"]` (or
   similar) and a single field-level re-upload reason.
4. ✅ Verifying a field upserts exactly one field-level Evidence_Fragment
   for that fieldId. Re-verifying replaces it. Any prior v2.34 per-photo
   fragments for that fieldId are removed.
5. ✅ Submit gates on every required field having a verified field-level
   fragment. Required fields with uploads but no verified fragment trigger
   inline verification on submit.
6. ✅ Photos do NOT silently disappear from the UI when other photos are
   accepted/rejected. Removal is user-driven only.
7. ✅ Pass-2 synthesis still reads a fragment list and produces the same
   Grade JSON contract. v2.35 field-level fragments and v2.34 per-photo
   fragments coexist and synthesize correctly.
8. ✅ `triggerGrading` legacy contract still works without fragments
   (one-shot inline inspection).
9. ✅ Persona integration runs (Priya→C, Rahul→B, Anjali→A) unchanged.

---

## 8. Locked-in decisions (post-implementation)

1. **Button label:** "Submit Field" (active state) → "Submit Field again" (after a
   reject) → "Verified" (after accept; disabled).
2. **Lock vs editable after accept:** stays editable. Adding/removing a photo on
   a verified field downgrades it back to "staged" and re-enables Submit Field.
3. **Page-level Submit:** for any required field with photos but no `verified`
   status, fires `verify-field` inline before proceeding. If any rejects, the
   error names the field and the page-level Submit aborts cleanly. Required
   fields with no photos at all block Submit at the gate (existing behaviour).
4. **The "first image disappears" bug** (filter cleanup on accept) is fixed in
   the same patch. Photos are now removed only by user action.
