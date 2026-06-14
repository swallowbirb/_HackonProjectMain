USER UPLOADS PHOTOS + REASON
          │
          ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 1 — PRE-FLIGHT  (free / near-free, runs first)    │
│                                                         │
│  imagehash ──────── "Is this our own catalog photo?"    │
│  Pillow/EXIF ─────── "Was this taken by a real camera?" │
│  Rekognition (web) ─ "Does this image exist on Google?" │
│                                                         │
│           HARD fraud? ──► STOP. Flag account.           │
│           SOFT fraud? ──► Continue + annotate.          │
└─────────────────────────────────────────────────────────┘
          │ clean / soft
          ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 2 — NOVA PRO PASS 1  (Bedrock, multimodal)        │
│                                                         │
│  "What photos do we need for this category + reason?"   │
│  → returns Form_Schema (cached by productId + reason)   │
└─────────────────────────────────────────────────────────┘
          │ form shown to user → user uploads evidence
          ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 3 — PER-PHOTO VALIDATION  (as each photo lands)   │
│                                                         │
│  OpenCV ────── "Is this photo sharp enough to grade?"   │
│  CLIP (v1) ─── "Did they photo the right part?"         │
│                                                         │
│  bad photo? ──► inline reject, user retakes             │
└─────────────────────────────────────────────────────────┘
          │ user submits completed form
          ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 4 — PARALLEL ANALYSIS  (asyncio.gather, all 4)    │
│                                                         │
│  OpenCV ──────────── "Is the colour right? Same item?"  │
│  CLIP (v2) ────────── "Is this semantically the same    │
│                         product as the listing?"        │
│  Rekognition (labels) "What defects exist, and where?"  │
│  Textract ─────────── "What do the labels/serials say?" │
│                                                         │
│           → assembled into one Analysis_Summary (text)  │
└─────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 5 — NOVA PRO PASS 2  (Bedrock, text-only)         │
│                                                         │
│  "Weigh all signals, write the verdict."                │
│  → Grade JSON  { A/B/C/D, defects, rationale, ... }     │
└─────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────┐
│  STEP 6 — PERSIST + LIFECYCLE                           │
│                                                         │
│  MongoDB ─── save grade + full evidence bundle          │
│  low confidence / missing evidence? ──► human review    │
│  otherwise ──► emit GRADED lifecycle event              │
└─────────────────────────────────────────────────────────┘
