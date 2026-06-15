# Gemini Architecture Diagram Prompt — AWS-Style Flow

This prompt recreates the **exact visual style** of the reference image (the "AI Powered
Smart Home Mood & Ambience Orchestration" AWS-style flow diagram) but with the SecondLife
system's content.

**How to use:** attach your reference image to Gemini, paste the prompt below, and add:
*"Match the visual style of the attached reference image exactly — same card layout,
colored headers, service icons in colored squares, green-checkmark bullets, and the
solid/dashed arrow legend."*

---

## PROMPT — copy from here

Create a professional AWS-style software architecture flow diagram titled
**"SecondLife — AI-Powered Reverse Commerce & Fraud Defence · Architecture Flow"**.

### VISUAL STYLE (match the attached reference exactly)
- White / very light background, clean and corporate
- Every component is a **rounded-corner white card** with a thin grey border
- Each card has a **COLORED UPPERCASE HEADER** and a smaller grey sub-label in parentheses
- Each card shows a **central service icon inside a colored rounded square**
- Bullet points inside cards use **small green circular checkmark icons**
- Group related cards inside larger labeled containers with a tinted background
- **Arrows:** solid arrow = synchronous flow; dashed arrow = external service call
- A **LEGEND box** in the bottom-right: "→ Synchronous Flow", "⇢ External Service Call",
  "✔ Key Function"
- Horizontal left-to-right main flow on the top row; a zoomed "DETAIL FLOW" lane in the middle

### TOP ROW — main synchronous request flow (left → right)

**CARD 1 — CLIENTS** (grey/neutral header)
Icons + labels stacked vertically:
- Buyer Web App
- Seller Dashboard
- Admin Panel
(sub-label: "React + Vite · port 5173")

**CARD 2 — CLERK AUTH** (purple header, sub: "User Authentication")
- ✔ Validates JWT session token
- ✔ Role-based access (buyer / seller / admin)
- ✔ Attaches req.user to request
- ✔ Webhook user sync

**CARD 3 — EXPRESS API** (green header, sub: "Main Entry Point · Node.js · port 5001")
- ✔ Request routing (25+ module routes)
- ✔ Validation & error middleware
- ✔ CORS + Helmet security
- ✔ Orchestrates ML service calls

**CARD 4 — S3 PRESIGN + DIRECT UPLOAD** (orange header, sub: "Evidence Capture")
- ✔ Issues presigned upload URL
- ✔ Browser PUTs photo/video bytes DIRECT to S3
- ✔ Express never proxies file bytes
- ✔ Returns public URL stored on Item

### TOP-RIGHT GROUP — "AI GRADING PIPELINE (FastAPI ML Service · port 8000)"
A large tinted container holding 4 instance-style cards left → right (like the EC2 instances
in the reference):

**INSTANCE 1 — PASS 1: FORM GENERATOR** (icon: document/form)
- Reason text + optional clarifying photos + product context
- Gemini generates claim-specific evidence form
- Assigns capture_mode: photo / video / text
- Output: Form_Schema

**INSTANCE 2 — FRAUD PREFLIGHT** (icon: shield)
- Perceptual hash vs catalog (stock-photo theft)
- EXIF camera-data check
- Runs BEFORE any Gemini call
- HARD-rejects fakes immediately

**INSTANCE 3 — VIDEO FRAME SELECTOR** (icon: video/film)
- OpenCV extracts frames at 1.5 fps (CPU-only, no LLM)
- phash diversity selection (max 6 frames)
- Liveness / splice-detection check
- Feeds frames into Field Inspector

**INSTANCE 4 — FIELD INSPECTOR** (icon: magnifying glass)
- ONE Gemini call judges the whole photo/frame set per field
- Reads Rekognition labels + Textract OCR
- Output: Evidence_Fragment per field

### MIDDLE LANE — "DISPOSITION ROUTING (Routing Brain) — DETAIL FLOW"
A wide tinted container (like the Orchestrator detail flow in the reference), left → right:

**INPUTS** (icon: inbound arrows)
- ✔ Grade JSON (A–D) from Pass 2 synthesis
- ✔ Trust profile (tier + score)
- ✔ Geo-demand match count

**TAG & MATCH** (icon: location pin)
- Gemini tags the graded item
- MongoDB $geoNear vs buyer "wants"
- Builds nearby-demand signal

**ROUTING DECISION** (icon: brain / decision)
- Amazon-Nova-Pro-equivalent: 6-path weighted scorecard
- ✔ Resell / Refurbish / Peer-redistribute
- ✔ Donate / Liquidate / Return-to-seller
- Hard gates override the math
- Trust-driven refund timing

**ACTION ENGINE** (icon: gear)
- ✔ Create resale draft listing
- ✔ Select best warehouse (not nearest)
- ✔ Set refund timing (instant / held)
- ✔ Emit lifecycle event

**OUTPUTS — DISPOSITION & STOREFRONT** (icon: storefront)
- Grade-backed resale PDP
- Donation / liquidation lot
- Peer handoff to nearby buyer
- Refund to seller

### LEFT-MIDDLE — "CROSS-CUTTING SERVICES" (shared services column, like reference)
Stacked cards with colored icons:
- TRUST ENGINE (score + fraud signals + pattern detectors)
- PREVENTION INTELLIGENCE (RIKB + checkout risk + PDP fit hint)
- FESTIVE DEFENCE (return-window shrink, COD gate, cancel lock)
- SUSTAINABILITY (CO₂ / water / green credits)
- DEVELOPER LOGS (real-time pipeline log sidebar)

### BOTTOM ROW — Data Stores, External AI, Legend (like the reference)

**DATA STORES** (three icons side by side)
- MongoDB Atlas M0 — items, grades, trustProfiles, routingDecisions, resaleListings,
  returnInsights, festiveCalendar, lifecycleEvents, itemLogs
- AWS S3 (ap-south-1) — evidence photos & video frames
- (optional) Sustainability impact collection

**EXTERNAL AI SERVICE** (dashed arrows pointing to it)
- Google Gemini API — gemini-2.5-flash (primary), gemini-2.5-flash-lite (fallback)
  Used by: Form Generator, Field Inspector, Grade Synthesizer, Item Tagger

**EXTERNAL VISION SERVICES** (dashed arrows)
- AWS Rekognition (label + web-entity match)
- AWS Textract (OCR on serial / model labels)

**LEGEND** (bottom-right corner)
- → Synchronous Flow
- ⇢ External Service Call
- ✔ Key Function

### KEY FLOW ARROWS TO DRAW
1. CLIENTS → CLERK AUTH → EXPRESS API (solid)
2. EXPRESS API → AI GRADING PIPELINE group (solid)
3. CLIENTS ⇢ S3 direct upload (dashed, bypassing Express — annotate this)
4. AI GRADING PIPELINE ⇢ Google Gemini (dashed, all 3 Gemini cards)
5. FRAUD PREFLIGHT ⇢ Rekognition + Textract (dashed)
6. Grade JSON → ROUTING DETAIL FLOW (solid, top group feeds middle lane)
7. ROUTING ACTION ENGINE → OUTPUTS storefront (solid)
8. CROSS-CUTTING SERVICES ↕ EXPRESS API (solid, bidirectional)
9. All modules → DATA STORES (solid, down arrows)
10. PREVENTION ⇢ PDP fit hint back to CLIENTS (dashed)

### ANNOTATIONS to print on the diagram
- "Browser uploads evidence DIRECTLY to S3 — Express never proxies file bytes"
- "Fraud preflight runs BEFORE any Gemini call — hard-rejects stock-photo theft"
- "Video fields: OpenCV frame extraction is CPU-only, costs no extra LLM budget"
- "Phase boundaries use frozen interfaces — downstream never breaks upstream"
