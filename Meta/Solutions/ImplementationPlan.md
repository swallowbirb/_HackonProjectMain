# Implementation Plan — Second-Life Commerce Ecosystem

> High-level, phase-by-phase implementation plan. Plain English. No code.
> Synthesised from: Problem Statement, ANSH Solution Overview, Claude SOLUTION,
> v1.43 Grading System Doc, and the FULL RESEARCH report.
> Optimised for a hackathon: every phase is feasible in hours-to-a-day with the
> picked stack, every phase produces something demoable, and the order is
> dependency-correct so nothing gets blocked.

---

## 0. Hackathon Feature Cut

We had a long wishlist across the docs. Here's the honest triage — what we
actually build for the demo, what we mock, what we drop.

| Feature | Status | Why |
|---|---|---|
| Existing marketplace (browse / cart / orders) | **Build on** | Already half-built in the repo — extend, don't rewrite |
| D ual intake: Returns flow + Sell-Used flow | **Build** | The whole pitch hinges on this |
| AI Grading hybrid pipeline (v1.43) | **Build** | Already specced — the technical centerpiece |
| User Trust Score / Return-history layer | **Build** | High-impact fraud defence + great demo beat |
| Smart Routing & Disposition Engine (live rationale) | **Build** | Single biggest "wow" moment |
| Reverse-logistics cost calculator | **Build** | Cheap utility, drives the Priya narrative |
| Demand Registry + `$geoNear` matching | **Build** | Powers Rahul's "50 parents nearby" moment |
| Resale Marketplace (unified storefront) | **Build** | Both intake paths end here |
| AI Listing generation from grade + photos | **Build** | High wow, low effort, one Bedrock call |
| Product Health Card (Ed25519-signed QR + hash chain) | **Build** | Trust artefact + DPP-ready story |
| Sustainability counter (CO2 / water saved) | **Build** | Trivial to compute, big narrative lever |
| Green Credits ledger | **Build** | Light gamification on top of sustainability |
| NGO/donation routing + tax receipt PDF | **Build** | Closes the Priya loop |
| Return Intelligence Knowledge Base (own returns/reviews) | **Build** | Self-owned data asset; fuels all prevention; one tiny doc/SKU |
| Return-risk **scorecard** (pure, explainable, in-backend) | **Build** | Same pattern as Phase 3 trust scoring; no model training, runs instantly |
| ~~Trained return-risk ML model (LightGBM)~~ | **Deferred** (post-hackathon) | On synthetic data it just re-learns the scorecard; real value needs real labels we don't have yet |
| Fit/size intelligence (crowd-sourced from our returns + reviews) | **Build** | No body measurements; honest one-liner on the PDP |
| Intervention engine (risk × trust → graduated nudge) | **Build** | Where prevention earns its keep; consumes Phase 3 trust |
| Seller bulk dashboard | **Build** (light) | Closes the small-seller persona |
| WhatsApp listing bot | **Stretch** | Twilio sandbox if time, demo via screen recording otherwise |
| CLIP-based "find similar item" search | **Stretch** | Skip if Atlas Vector Search M0 single-index limit bites |
| Refurbishment-partner integration | **Mock** | Stub the path in the routing engine |
| Locker pickup logistics | **Mock** | UI flow + simulated handoff event |
| Real blockchain DPP | **Skip** | Cryptographic signature + hash chain achieves the demo goal |
| Escrow / KYC / payments rails | **Skip** | Out of scope; assume platform-mediated |
| Custom YOLOv8 defect detector | **Skip** | Rekognition Label Detection covers it without training |

---

## 1. Architecture at a Glance

```
[ React frontend ]
        │  REST / JSON
        ▼
[ Node + Express API ]  (existing repo, extended)
   │       │
   │       │   • Prevention scorecard + fit intelligence run here (pure JS,
   │       │     fed by the RIKB); no ML round-trip needed
   │       │
   │       └──► [ FastAPI Python microservice ]
   │              • OpenCV, CLIP, imagehash, Pillow/EXIF
   │              • Boto3 → AWS Rekognition, Textract, Bedrock
   │              (Phase 7 does not use the ML service — see Phase 7 notes)
   │
   ├──► [ Amazon Bedrock ]   Nova Pro (primary), Claude 3.5 Sonnet (fallback)
   ├──► [ Amazon S3 ]        all uploaded photos
   ├──► [ AWS KMS ]          Ed25519 signing keys for Health Cards
   └──► [ MongoDB Atlas M0 ] one DB, doing triple duty:
            • Documents (users, products, orders, returns, listings, grades, wants, ngos, events)
            • 2dsphere geo index → $geoNear "nearby demand"
            • Atlas Vector Search index → semantic listing discovery (stretch)
```

**Why this stack.**
The repo already runs MERN with mongoose-style modules. AWS-native everything
else gives us hackathon-friendly free tiers and matches the Amazon HackOn
judging frame. Bedrock + Nova Pro is the deliberate hero choice — judges will
notice an Amazon model running an Amazon-themed demo.

---

## 2. Phase Map (Read this first)

```
P0 ─► P1 ─► P2 ─► P3 ─┐
                       ├─► P3.5 ─► P4 ─► P5 ─► P6 ─► P7 ─► P8 ─► P9
       Existing repo ──┘
```

P0 unblocks everything. P1 is parallel UI work to P2 (grading) and P3 (trust)
which can run in parallel after P0. P3.5 (integration & testing) wires the three
parallel streams together with a frontend. P4 (routing) consumes outputs from 
P2 + P3. P5–P8 are largely independent and can be parallelised. P9 is polish & rehearsal.

---

## Phase 0 — Foundation & Infrastructure

**Goal:** Remove every "I can't start because…" blocker. End of P0 means anyone
can clone the repo, get a `.env`, and run end-to-end placeholder calls.

**What we do, in plain English:**

1. **AWS account prep.** Create one AWS account for the team, set up an IAM user
   with programmatic credentials, and request Bedrock model access for **Amazon
   Nova Pro** and **Claude 3.5 Sonnet** (approval is usually instant but do it
   on Day 1 — it is the single biggest blocker if forgotten). Apply hackathon
   credits to the billing account.

2. **Provision the AWS primitives.**
   - One **S3 bucket** for all uploaded photos (with pre-signed-URL upload from
     the browser, so Express never proxies image bytes).
   - **AWS KMS**: generate one Ed25519 key pair we'll use to sign every Product
     Health Card. Store the public key in the repo / config so anyone can verify
     a Card without an AWS call.
   - **AWS Secrets Manager** entries for Bedrock keys, Mongo URI, signing key
     references.

3. **MongoDB Atlas M0.** Spin up the free cluster, whitelist team IPs, create
   indexes the later phases will need (`2dsphere` on the demand registry,
   text/Atlas-Search index on listings).

4. **Repo skeleton.** Add three new top-level workspaces alongside the existing
   `backend/`:
   - `ml-service/` — the new FastAPI microservice (vision tools + Bedrock
     orchestration for grading). Note: Phase 7 prevention runs entirely in the
     backend, not here.
   - Inside the existing `backend/src/modules/`, scaffold empty module folders
     for: `returns`, `secondhand`, `grading`, `routing`, `demand`, `health-card`,
     `sustainability`, `trust`. Mirrors the existing module-per-domain pattern.
   - `frontend/` work continues against this expanded API surface.

5. **Canonical data contracts.** Lock in the JSON shapes everything else depends
   on, before anyone writes business logic:
   - **Item lifecycle event** (the unit logged at every state change — used by
     the Health Card's hash chain).
   - **Grade JSON** (verbatim from v1.43 spec — already locked).
   - **Routing decision JSON** (chosen path + ranked alternatives + rationale).
   - **Trust profile JSON** (tier + reasons).
   - **Listing JSON** (extends the existing product schema with `intake_path`,
     `grade_id`, `health_card_id`, `condition_lane`).

6. **Seed data.** Create deterministic seed scripts that always produce the same
   demo state: a few sellers, ~20 products, a bunch of "wants" geo-distributed
   around two demo cities, an NGO directory, a handful of historical orders for
   our four demo personas (Priya, Rahul, Anjali, the small seller).

**Done means:** AWS resources exist, schemas are committed, seed loads cleanly,
one ping endpoint per service responds.

---

## Phase 1 — Dual-Intake Entry Points

**Goal:** Build the two front doors that feed the same downstream pipeline. No
AI yet — just the screens, the state machine, and the records that say "a
return started" / "a sell-used listing started."

**What we do:**

1. **Returns flow entry.** From a customer's order page on the existing
   marketplace, add an "Initiate Return" button. Tapping it creates a `return`
   record (links the order, the line item, the user, captures the user's stated
   reason from a small free-text + dropdown).

2. **Sell-Used flow entry.** A new "Sell on Second-Hand" surface in the
   navigation. Two sub-flows:
   - "I bought it here originally" → pick from past orders (the **Relove
     pattern** — pre-fills SKU, listing photos, original purchase date, fabric
     /spec data straight from the catalog).
   - "I bought it elsewhere" → search the catalog and attach to a SKU, or
     describe the item if no catalog match.
   Either way we create an item record that drops into the *same* downstream
   pipeline as a return.

3. **Common evidence-collection shell.** Both flows hand off to one shared React
   page that will eventually host the dynamic Pass-1 form. For now it shows a
   generic placeholder form (reason + free-form photos). The dynamic form drops
   in during Phase 2.

4. **Single return / item state machine.** One enum drives every UI screen
   downstream:
   `INITIATED → EVIDENCE_PENDING → GRADING → ROUTED → IN_TRANSIT → LISTED → SOLD/DONATED/LIQUIDATED`.
   Every transition writes a lifecycle event (this becomes the Health Card hash
   chain in Phase 5).

**Why this matters:** Returns and Sell-Used must converge on the same
downstream pipeline. If we build them as two parallel systems we'll regret it.
Convergence happens here.

**Done means:** A user can start a return from an order *and* start a sell-used
listing from "I bought it elsewhere," and both end up in the same item-record
collection with the same state machine.

---

## Phase 2 — AI Grading Pipeline

**Goal:** Implement the v1.43 hybrid grading pipeline end-to-end. This is the
technical centrepiece. The v1.43 doc is the authoritative spec — this phase
just executes it.

**What we do (mirroring v1.43 step numbers):**

1. **Pre-flight fraud checks** in the FastAPI service. Three cheap signals run
   before any LLM call:
   - **imagehash** — perceptual hash compared against pre-computed hashes of
     every catalog/listing photo. Stock-photo lift detection.
   - **Pillow / ExifRead** — does the image carry camera metadata? Stock images
     don't.
   - **AWS Rekognition** web-detection — does this image already exist on the
     open web?

   A soft fraud signal goes into the trust layer (Phase 3); a hard fraud signal
   short-circuits the whole flow.

2. **Bedrock Pass 1 — Form Generator.** Send the user's reason, a couple of
   initial photos, the product listing data, the base prompt, and the category
   prompt to **Nova Pro on Bedrock**. Output is a JSON form schema describing
   the exact photos and fields we need. Cache the schema by
   `hash(product_id + normalised_reason)` — duplicate requests skip Bedrock.

3. **Progressive form rendering on the frontend.** Show generic fields the
   instant the page loads, swap in AI-tailored fields when Pass 1 returns
   (3–5s). User never sees a spinner.

4. **Per-photo real-time validation** as each upload hits S3:
   - **OpenCV** for blur and lighting checks.
   - **CLIP** zero-shot subject match ("does this photo show a tie collar?")
     against the field's expected subject.

   If a photo fails, the user gets inline feedback before submitting.

5. **Submit → parallel specialised analysis.** Once the form is submitted,
   FastAPI fans out four jobs concurrently (`asyncio.gather`):
   - **OpenCV** — dominant colour + histogram delta vs the listing photo.
   - **CLIP** — overall visual similarity to the listing.
   - **AWS Rekognition Label Detection** — defect / damage labels with
     confidence and locations.
   - **AWS Textract** — read serial numbers, brand labels, care tags.

   All four outputs assemble into one structured JSON summary.

6. **Bedrock Pass 2 — Grade Synthesizer.** Send the structured summary (text
   only, no raw images — keeps Pass 2 cheap) to Nova Pro / Claude with the base
   + category prompts. Output: the canonical Grade JSON (grade A/B/C/D,
   quality_score, defects, missing_evidence, return_claim_verified,
   estimated_resale_pct, routing_hint, rationale).

7. **Persist the full evidence bundle** in MongoDB: prompts used, S3 image
   URLs, intermediate analysis summary, Pass-1 schema, final grade, model
   versions, timestamps. This bundle drives dispute resolution, future model
   tuning, and the Health Card.

8. **Human-review escalation.** If `confidence: low` or `missing_evidence` is
   non-empty, the grade is flagged and shows up on the seller/admin dashboard
   instead of auto-routing.

**Done means:** A user uploading photos gets back an objective Grade JSON in
about 10–20 seconds, persisted with full provenance.

---

## Phase 3 — Trust Score & Fraud Defence Layer

**Goal:** Add the user-history dimension the research report calls out and the
brief explicitly asks for. This is the single biggest improvement over what
ANSH and Claude originally had — we don't grade items in isolation, we grade
items *in the context of who's submitting them*.

This is where the fraud-defence story lives, and it directly answers the
"$103B return-fraud" stat from the research report and Flipkart's defensive
OBD posture without ruining the customer experience.

**What we add — Trust Profile per user.** Computed lazily on every return /
sell-used initiation. Inputs (all already in the existing schema or trivially
derivable):

- **Account age** and verification status (email/phone/KYC).
- **Lifetime purchases** count and value. The exact case the brief calls out:
  40 successful purchases, first return → almost certainly genuine.
- **Lifetime return rate** and recent-90-day return rate (catches sudden
  pattern shifts).
- **Return reason quality** — specific reasons (with photos, with descriptive
  text) score higher than vague ones ("didn't match expectations").
- **Time-to-return distribution** — items consistently returned at the 28th day
  of a 30-day window are flagged ("wardrobing" pattern).
- **Bracketing fingerprint** — repeated multi-size / multi-colour purchases of
  the same SKU with all but one returned. Visible in the order data; we just
  have to query for it.
- **Disputed-grade history** — has the user previously contested grading
  outcomes? Did they win or lose?
- **Successful resale completions** (for sellers / sell-used listers).
- **Device + payment fingerprint reuse across accounts** — same device,
  multiple accounts, all returning the same SKU — coordinated abuse pattern.

**Output: a tiered trust profile.** Five tiers, each gates the flow downstream:

| Tier | What changes for the user |
|---|---|
| **Verified** | Pre-grade refund authorised; abbreviated evidence form; live in-app camera capture only (no gallery); item picked up later for grading on an audit basis. |
| **Trusted** | Standard flow, fast-tracked through routing. |
| **Standard** | Default flow exactly as Phase 2 describes. |
| **Watch** | Extra evidence fields injected into the Pass-1 form; weight verification at locker drop-off; refund withheld until grading clears. |
| **Restricted** | Manual review only; in-person inspection at a partner hub; no auto-refund; account-level alert. |

**Cross-cutting fraud signals** (computed at submission time, feeding the trust
score *and* the routing engine):

- **Reverse-image hits** from Phase 2's pre-flight (stock photo).
- **EXIF anomalies** (no camera metadata, mismatched timestamp/location vs
  user's claimed delivery address).
- **Photo-of-screen detection** via simple moiré-pattern check in OpenCV
  (catches users photographing a product image on another device).
- **Time-to-return anomaly** (returned 4 hours after delivery on a category
  that needs use to evaluate).
- **Locker weight check (mocked for hackathon)** — parcel weight at drop-off
  vs known SKU weight catches empty-box / item-swap fraud the way Flipkart's
  OBD does, but at the locker not the doorstep.

**Why this is a competitive moat.** Every incumbent solution discussed in the
research report is reactive (manual inspection, OBD, liquidator handoff). A
proactive trust score lets us be **frictionless for genuine users and strict
only with risky ones**, which is exactly the gap the report identifies between
"defensive logistics" and "customer experience."

**Done means:** Every return / sell-used submission has a trust profile
attached at the moment of submission, and the downstream UI / routing visibly
behaves differently across tiers.

---

## Phase 3.5 — Integration & End-to-End Testing

**Goal:** Wire together P1 (Dual Intake), P2 (AI Grading), and P3 (Trust Score)
into a working flow with a functional frontend so the team can test the complete
pipeline before building the routing engine. This phase catches integration
issues early and creates a stable foundation for P4.

**What we do:**

1. **Backend integration layer.** Create the orchestration endpoints that chain
   the three independent modules together:
   - POST `/api/returns/initiate` → creates item record (P1) → fetches trust
     profile (P3) → returns merged response.
   - POST `/api/secondhand/initiate` → same flow, different intake path.
   - POST `/api/grading/start` → triggers the full P2 grading pipeline → stores
     grade → updates item state → returns grade JSON with trust context.
   - GET `/api/items/:id/status` → unified status endpoint showing intake path,
     current state, trust tier, grade (if complete).
   - GET `/api/items/:id/logs` → returns plain-English developer logs for debugging.

2. **Developer logs system.** Build a real-time logging system that emits plain-
   English logs at every step of the flow:
   - `ItemLogger` utility logs each step ("🚀 Return initiated", "🤖 Calling Bedrock...",
     "✅ Grade B assigned (78/100)")
   - Logs persist in MongoDB `itemLogs` collection (auto-expire after 7 days)
   - Collapsible sidebar on all return/secondhand pages shows logs in real-time
   - Helps developers understand flow, debug issues, and see AI working live

3. **Frontend scaffold.** Build the minimal React surfaces to drive the flow
   end-to-end:
   - **Returns initiation page** — form to submit a return with reason + initial
     photos.
   - **Sell-Used initiation page** — two tabs: "I bought it here" (order picker)
     + "I bought it elsewhere" (manual entry).
   - **Evidence collection page** — the shared surface from P1, now wired to the
     grading API. Shows Pass-1 form schema when it arrives, handles photo
     uploads to S3, displays real-time validation feedback. **Developer logs
     sidebar shows each step in real-time.**
   - **Status/Results page** — shows the item's current state, trust tier badge,
     grade details (A/B/C/D + rationale + defects) when grading completes.
     Placeholder for routing results (will populate in P4). **Developer logs
     sidebar shows full flow history.**

4. **Trust tier visibility.** Make trust tiers visible in the UI:
   - Badge/indicator on the status page showing tier (Verified / Trusted /
     Standard / Watch / Restricted).
   - Conditional messaging based on tier (e.g., "Your return is fast-tracked" vs
     "Additional verification required").
4. **Trust tier visibility.** Make trust tiers visible in the UI:
   - Badge/indicator on the status page showing tier (Verified / Trusted /
     Standard / Watch / Restricted).
   - Conditional messaging based on tier (e.g., "Your return is fast-tracked" vs
     "Additional verification required").
   - Different form fields or requirements based on trust tier (Phase 3's gating
     logic now manifests visually).

5. **Error handling & loading states.** Make the frontend production-ready:
   - Loading spinners during API calls.
   - Error boundaries for failed grading / trust computation.
   - Retry logic for transient Bedrock / ML-service failures.
   - Graceful degradation if FastAPI is down (show cached schema, text-only
     fallback).
   - **All errors logged to the developer logs sidebar for instant debugging.**

6. **End-to-end smoke test.** Verify the complete flow works with real data:
6. **End-to-end smoke test.** Verify the complete flow works with real data:
   - Start a return → see trust tier computed → upload photos → see Pass-1 form
     → fill it → submit → see Grade JSON returned → verify it persists in DB.
   - Same flow for sell-used path.
   - Test with multiple user histories (different trust tiers) to confirm gating
     logic works.
   - **Watch the developer logs sidebar show each step in plain English.**

7. **Integration fixes.** Inevitably, things break when modules meet:
   - Schema mismatches between P1/P2/P3 (fix the contracts).
   - Missing MongoDB indexes causing slow queries (add them).
   - CORS issues between frontend and backend (configure Express).
   - S3 pre-signed URL expiry / permission issues (fix IAM policy).
   - FastAPI → Express communication failures (verify endpoints, error handling).

8. **Developer experience polish.**
   - One `npm run dev` command starts both backend Express and frontend React.
   - One `npm run seed` command resets the DB to a known demo state.
   - README with "How to test the flow end-to-end" instructions.
   - Postman / Thunder Client collection for the new endpoints.

**Why this phase matters:**
- **Catches contract mismatches early** — better to discover them now than
  during P4 when routing complexity is added.
- **Provides a testable artifact** — the team can show a working intake-to-grade
  flow to stakeholders or judges even before routing exists.
- **Developer logs = instant visibility** — see exactly where the flow breaks,
  understand timing, debug fraud signals, watch AI working in real-time.
- **Unblocks parallel P4 work** — once integration is clean, one person can
  start building routing logic while another builds the routing UI, knowing the
  upstream data is reliable.
- **Reduces P9 risk** — fewer surprises during demo polish if integration was
  tested early.

**Done means:**
- A user can initiate a return or sell-used listing via the frontend.
- The system computes their trust tier and shows it.
- Photos upload to S3, grading runs via FastAPI, Pass-1 form renders, Pass-2
  grade appears on the status page.
- **Developer logs sidebar shows plain-English logs for every step.**
- The flow completes without manual intervention and persists correct data.
- The team can reset and re-run the flow reliably.

---

## Phase 4 — Smart Routing & Disposition Engine

**Goal:** Take the Grade JSON (Phase 2) + the Trust Profile (Phase 3) + the
intake path (Phase 1) and decide where the item physically goes. Render the
decision live as horizontal rationale bars — the strongest single demo moment.

**What we build:**

1. **Reverse-logistics cost calculator.** A small pure function: distance
   between user and nearest warehouse × per-kg/per-km carrier rate ×
   weight-bracket multiplier. We use mocked carrier rates seeded into the DB.
   This is what surfaces the "shoes cheaper than the box" insight.

2. **Candidate disposition paths,** each with its own revenue / cost
   computation (Claude SOLUTION's table is the spec):
   - Resell-as-is on the Resale Marketplace.
   - Refurbish then resell (mocked partner — adds repair cost, lifts
     `resale_pct`).
   - Local peer-to-peer redistribution (uses Phase 6's demand registry).
   - Donate to a nearby NGO (Phase 8 — ₹0 plus tax-receipt value plus green
     credits).
   - Liquidate in bulk (5–10% recovery).
   - Return to original seller (returns path only, gated by seller policy).

3. **Weighted scoring engine.** For each path: net recovery = expected revenue
   − expected cost, multiplied by condition factor (from the grade) and demand
   factor (from Phase 6's geo query). Pick the max. Output a *ranked* list of
   alternatives with one-line rationales each.

4. **Hard gates layered on top of the score:**
   - **Hygiene-sensitive categories** (innerwear, food, opened cosmetics)
     short-circuit to liquidate / donate regardless of score.
   - **Trust tier "Watch" or "Restricted"** disables the auto-refund branch.
   - **Seller-policy schema** (per-seller config: accept_threshold,
     allow_donation, refurbish_partner_id) gates which paths are even
     candidates.
   - **Intake path** gates branches: only the returns path can choose
     "return-to-seller"; only the sell-used path can choose "hold for wider
     demand radius."

5. **Live rationale UI.** When a return is graded, the customer (or seller)
   sees all six paths as horizontal bars labelled with computed ₹ recovery.
   The winning path is highlighted with a one-line plain-English explanation.
   Optional: one extra Bedrock call to narrate "why" in conversational English.

**Done means:** Pasting any graded item into the routing endpoint returns a
ranked list of dispositions with computable recovery values and a clear winner
the UI can render.

---

## Phase 5 — Resale Marketplace, AI Listing Generation, Product Health Card & Real-Time Photo Verification

**Goal:** Everything the buyer sees on the resale side, the trust artefact
that makes them buy with confidence, and a mandatory real-time photo check
that ensures every listing has at least one honest, unedited reference photo.

**What we build:**

1. **Unified Resale Marketplace surface** in the frontend. One storefront
   hosts items from both intake paths — buyers can't tell which path a listing
   came from, and don't need to. The existing products module gives us most of
   the schema for free; we add `intake_path`, `grade_id`, `health_card_id`,
   `condition_lane` (Like-New / Good / Fair).

2. **AI Listing Generation.** When the routing engine picks a "resell" path,
   one Bedrock call (Nova Pro, structured output) takes the Grade JSON +
   evidence photos + original catalog data and returns:
   - Marketplace title.
   - Buyer-facing description (highlights condition rationale honestly).
   - Suggested price = `new_price × condition_factor × category_depreciation × demand_multiplier`.
   - Best 3 photos auto-selected from the evidence bundle.

   Seller / lister can override price; everything else can be edited but
   defaults to the AI version.

3. **"Fair Condition" lane.** Lower-graded items (Grade C) get grouped in a
   discounted lane on the same storefront, instead of being hidden or
   liquidated. Honest framing — the research report flags inconsistent grading
   as a primary trust killer; we're transparent about lower grades and price
   accordingly.

4. **Real-Time Photo Verification.** The #1 return driver across visual
   categories (apparel, bags, furniture, home décor) is "looked different from
   photos" — caused by heavily edited or misleading catalog shots. Every
   listing now requires one mandatory real-time photo taken live through the
   device camera at the moment of listing. Sellers keep full control over
   their professional catalog photos; this adds one honest ground-truth
   reference that cannot be faked.

   - **Frontend enforcement:** the real-time photo field uses
     `capture="environment"` — opens the rear camera directly, no gallery
     picker. The listing form cannot be submitted without it.
   - **Two AI checks** (run in the existing FastAPI ml-service, reusing Phase
     2's OpenCV + EXIF infrastructure):
     - **Moiré pattern detection** — a photo taken of a screen or printout
       produces a characteristic wave pattern in the frequency domain that
       OpenCV's FFT analysis catches. Real physical objects don't have it.
     - **EXIF camera metadata** — every genuine camera shot embeds device
       make/model and timestamp. A downloaded image, screenshot, or
       re-photographed printout typically has this stripped.
   - **Hard gate:** `listing.service.js` keeps the listing in `DRAFT` status
     until `realtimePhotoVerified = true`. It cannot transition to `PUBLISHED`
     without a passing verification.
   - **Trust badge:** verified listings display `📷 Real Product Verified` on
     the PDP alongside the professional catalog photos. Platform-level trust
     that no individual seller or editing tool can fake.
   - **Why sellers don't abuse it:** if a seller submits a misleading
     real-time photo, the buyer sees it, loses trust, and doesn't purchase.
     Market incentives enforce honesty — the AI only needs to close the one
     loophole of a seller photographing their own edited image off a screen.

5. **Product Health Card.** The trust artefact. For every item that gets
   listed:
   - We compute a **canonical hash** of the Grade JSON (RFC 8785 JSON
     canonicalisation — same JSON always hashes to the same value).
   - We sign that hash with the platform's **Ed25519 private key** (in KMS).
   - We append the event to the item's **hash chain** — every new lifecycle
     event (graded → repaired → relisted → resold → re-graded) stores the
     hash of the previous event. Tamper-evident without blockchain.
   - We render a **QR code** (`qrcode` npm package) that points to a public
     verification URL. Anyone scanning sees the full grade rationale, photos,
     condition lane, hash chain, and a "verified ✓" badge if signature checks
     out.
   - We **frame it as DPP-ready** — the EU Digital Product Passport hook is
     legitimate (battery passport mandatory Feb 2027 under EU 2023/1542;
     textiles ~2027–2028). Honest "DPP-ready," not "DPP-compliant."

6. **Multi-life Health Card.** If a resold item gets returned again or
   listed again, we **append** to the existing Health Card chain instead of
   creating a new one. The artefact spans owners — a true second-life
   passport. This is the "future vision" feature from the problem statement,
   delivered cheaply.

**Done means:** A graded item gets a polished AI-generated listing on the
resale storefront; every listing has a mandatory verified real-time photo with
a `📷 Real Product Verified` badge; every listing has a scannable QR; scanning
the QR shows a verifiable, signed condition record with full history.

---

## Phase 6 — Demand Registry & Hyperlocal Matching

**Goal:** Make Rahul's "50 parents within 5km want this" moment real.

**What we build:**

1. **`wants` collection** in MongoDB:
   `{user_id, product_category_or_sku, geo_point, max_grade, max_price, notify_on_match, created_at}`.
   With a `2dsphere` index on `geo_point`.

2. **"Wants" capture surfaces.** Two ways to register demand:
   - Explicit: a "Notify me when available" button on out-of-stock or
     resale-relevant product pages.
   - Implicit: when a user searches for a category and there's no match —
     prompt them to register a want. Captures latent demand cheaply.

3. **Geospatial query.** Driven by `$geoNear` aggregation. Two directions:
   - **Routing-engine direction:** "Given this listed item at this location,
     how many wants exist within R kilometres? What's the nearest cluster?"
     This drives the demand factor in the routing score, *and* picks the
     warehouse to ship to.
   - **Lister-facing UX:** "Your item matches 50 nearby buyers" shown the
     instant a sell-used flow completes grading. The single biggest emotional
     moment in the Rahul demo.

4. **Notify-on-match worker.** When an item lists or moves, find every
   matching want within radius and ping them (in-app + email; SMS / WhatsApp
   stretch).

5. **Cross-city matching (stretch).** Only triggered if no nearby demand
   cluster exists — then widen the radius to city-level, factoring shipping
   cost. Implements the "future vision" cross-city matching at low cost.

**Done means:** Every listed item knows its demand neighbourhood; matching
buyers get notified; the routing engine uses the count as a real input.

---

## Phase 7 — Prevention Intelligence Layer (the highest-leverage layer)

**Goal:** "The most sustainable return is the one that never happens." Prevention
is not a bolt-on feature — it is the compounding moat. Every grading, return, and
review the platform processes feeds a knowledge base that makes the *next* purchase
smarter. We build a **closed-loop system** that (a) learns return causes from our own
data, (b) scores return risk before checkout with a transparent, explainable scorecard
(no model training — see subsystem 3), (c) intervenes with friction sized to *who the
buyer is*, and (d) feeds defect/fit signals back to sellers — all at near-zero marginal cost.

**Why this is a redesign over the old "XGBoost-on-Kaggle + Misra-KNN" plan.**
Our actual schema has no size variants, discount %, COD/prepaid flag, multi-item
baskets, or body-measurement profiles. A model trained on a foreign dataset would
have features that don't map to our data, and the Misra fit-KNN needs measurements
we never collect — both were demo theatre. The new design uses **only data we already
generate**: our own returns (clean `reasonCode` enum + free text), reviews, orders,
and the trust profiles Phase 3 already computes. It is more honest, more defensible,
and genuinely self-improving.

**What we build (ten subsystems):**

1. **Return Intelligence Knowledge Base (RIKB).** A compact `returnInsights`
   aggregate — one small document per SKU, with a `(brand, category)` fallback for
   cold items — rebuilt nightly from returns + reviews + orders. Per SKU: units
   sold/returned, return rate, a reason histogram, the dominant reason, and a **fit
   signal** (runs-small / true-to-size / runs-large + confidence) mined from return
   free-text and review text. Cold start backs off to seeded category priors
   (apparel ~28%, footwear ~20%, electronics ~8% — each cited). One tiny doc per
   product fuels every other subsystem.

2. **Fit & Size Intelligence (no body measurements required).** From the RIKB fit
   signal, the PDP shows an honest one-liner: *"Runs small — 7 of 10 shoppers who
   returned this said it was too tight. Consider sizing up."* If the buyer previously
   *kept* a same-brand item, we add a personalized hint (*"You took M in this brand
   and kept it"*) — all from our own order/return history. This replaces the
   infeasible Misra-KNN with something cheaper and more convincing because it's real
   platform data. **Confidence floor:** fit notes are only shown on the PDP when
   `fitSignal.confidence >= 0.5` — below that threshold, the data is too thin to be
   useful and the note is hidden to avoid misleading buyers.

3. **Return-Risk Scoring Engine (an explainable scorecard).** A pure, transparent
   **scorecard** — same pattern as Phase 3's trust scoring — scores risk 0–100 from
   features we can actually compute at checkout: the SKU's own return rate (RIKB),
   category prior, price band, condition, the buyer's trust tier + return behaviour
   (consumed from Phase 3, never recomputed), first-time-in-category, fit-mismatch
   flag, **and real-time photo verification status** (from Phase 5 — listings without
   a verified real-time photo on visual categories score slightly higher risk). Known
   signals, known weights, the top-3 human-readable reasons — it runs as a pure
   function inside the backend, needs no training and no ML round-trip, and is
   trustworthy *because* every number is explainable. **A trained ML model (LightGBM)
   is deliberately deferred** to post-hackathon: on the synthetic data we'd have to
   invent, it would only re-learn the scorecard's own formula, so it adds cost and
   opacity without adding signal. The honest upgrade — retraining on the platform's
   *real* accumulated return labels — is a documented roadmap step, and the feature
   vector is designed so that swap is a drop-in later.

4. **Intervention Engine.** A new `prevention/` backend module maps
   (risk band × trust tier × context) to a graduated, configurable intervention — the
   part that actually prevents returns:
   - **PDP nudges:** fit verdict, "commonly returned for X," personalized size hint.
   - **Checkout nudge:** a high-risk basket gets a *specific, actionable* CTA ("Runs
     small — size up?"), never a hard block for genuine users.
   - **Bracketing interception:** if the checkout intent has multiple sizes/units of
     the same SKU, surface the fit recommendation aggressively and offer to drop the
     extras.
   - **Confidence boosters (inverse prevention):** for verified/trusted buyers we
     *reduce* uncertainty (clear condition lane, Health Card, fit guarantee) so they
     don't over-order to hedge — uncertainty is what drives bracketing.
   - **Cooling-off / refund timing:** very-high risk + standard-or-lower trust → refund
     issued 24–48 h after grading instead of instantly; verified/trusted users are
     never delayed. (Coordinates with, doesn't duplicate, Phase 4's auto-refund gate.)

5. **Nudge Effectiveness Tracking.** Every nudge shown is logged in a lightweight
   `nudgeEvents` collection — tracking whether the buyer saw it, acted on it (changed
   size, removed extras), proceeded to purchase, and ultimately returned or kept the
   item. This closes the feedback loop on *intervention quality*, not just product
   quality:
   - **Schema:** `{ userId, productId, nudgeType, shown: Boolean, acted: Boolean,
     purchased: Boolean, returned: Boolean, timestamp }`.
   - **Metrics surfaced:** nudge conversion rate (shown → acted), prevention rate
     (acted → no return), ignore rate (shown → not acted → returned). Computed
     weekly by the nightly job.
   - **Auto-tuning signal:** if a nudge type has <10% conversion rate on a specific
     category after sufficient volume, it's flagged for review — either the wording
     is wrong, the placement is wrong, or the nudge isn't appropriate for that
     category. This is surfaced on the admin dashboard.
   - **Why it matters:** without this, Phase 7 runs on faith. With it, you can prove
     "fit nudges prevented 215 returns this month" and kill nudges that don't work.

6. **Buyer Post-Return Feedback.** When a buyer returns an item *despite* having been
   shown a nudge, the return confirmation page shows a brief, non-accusatory learning
   moment:
   - *"You returned this because it ran small. We noticed that before you bought —
     next time, check the fit hint on the product page to find your size."*
   - Only shown when `nudgeEvents` confirms a nudge was shown AND ignored AND the
     return reason matches the nudge signal (e.g., FIT_NUDGE + return reason
     `not_as_described` with fit keywords in `reasonText`).
   - Framed as helpful, never scolding. Goal: train the buyer to use the fit/return
     signals on future purchases, reducing *their own* future returns.
   - **Cost:** zero — it's a conditional message on an existing page, driven by data
     already collected.

7. **Seller-Side Defect & Fit Feedback + Before/After Tracking.** The nightly RIKB
   job surfaces per-SKU insights on the seller dashboard — return rate, dominant
   reason, fit verdict, and **one LLM-summarised sentence** per significant complaint
   cluster (*"Buyers consistently report this runs tight across the shoulders —
   consider updating the size chart"*). The LLM call is batched nightly and cached,
   never per page view, so it costs almost nothing. Fixing the listing prevents the
   *next* wave of returns.

   **Before/After tracking (NEW):** when the nightly RIKB recomputes, it compares the
   current return rate to the rate stored 30 days prior for each SKU. If the rate
   dropped after the seller was shown the insight, the dashboard shows confirmation:
   *"Return rate dropped from 31% → 18% since your listing update on June 2."*
   - Motivates sellers to act on future insights (positive reinforcement).
   - Identifies listings that remain broken despite seller awareness (escalation
     candidate).
   - **Storage:** one additional field per `returnInsight` doc:
     `previousReturnRate30d: Number` — overwritten each nightly run with the prior
     value.

8. **Phase 5 Real-Time Photo Signal (cross-phase integration).** Phase 5 introduces
   mandatory real-time photo verification on seller listings. Phase 7 *consumes* this
   as an additional scorecard signal:
   - If `product.realtimePhotoVerified === false` AND the category is visual
     (apparel, bags, furniture, home décor, footwear), the scorecard adds a small
     risk bump (weight 0.04) — because listings without verified real-time photos
     are more likely to cause "looked different" returns.
   - If `realtimePhotoVerified === true`, this signal contributes 0 to the risk
     score — the listing has already proven its visual honesty.
   - This creates a natural incentive loop: sellers who skip real-time verification
     (on platforms where it's optional for legacy listings) will see their products
     flagged as slightly higher risk, which surfaces a nudge to buyers — which
     reduces sales — which motivates the seller to verify.

9. **The Closed Loop.** A nightly `prevention.recompute` job rebuilds the RIKB from
   the latest data, so every nudge sharpens over time — as real returns accumulate,
   the return rates, fit verdicts, and complaint clusters the scorecard reads all
   improve on their own, no retraining required. Training an ML model on accumulated
   *real* labels is the documented next step once volume justifies it; the hackathon
   ships the loop wiring and the nightly recompute, so "self-improving" is real today,
   not promised.

10. **Category-Specific Prevention Intelligence.** "Fit" is the apparel-specific
    instance of a universal problem: expectation mismatch at the PDP. Phase 7 extends
    the same engine — same RIKB, same scorecard, same nightly loop — to three distinct
    category strategies, each with its own lexicon and nudge content:

    - **Apparel & Footwear** (return rate 25–40%): fit signals dominate. The existing
      fit lexicon (runs small/large), bracketing detection, and personalized size hints
      cover this fully. Footwear extends with width signals ("narrow", "pinches",
      "toe box") and half-size bracketing detection.

    - **Electronics** (8–15%, but ₹2,500–5,500/return to process): dominant driver is
      compatibility and setup confusion, not fit. A `COMPATIBILITY_MISMATCH` signal
      mines return text for: `['incompatible', 'doesn't work with', 'wrong port',
      'not supported', 'confusing', 'can't connect', 'dead on arrival']`. PDP nudge:
      *"12% of buyers returned this citing compatibility issues — check if it works
      with your device."* High cost-per-return makes even small reductions valuable.

    - **Furniture & Home** (5–20%; reverse logistics can exceed item margin): dominant
      drivers are dimension/space mismatch and appearance vs photos. A
      `DIMENSION_MISMATCH` signal mines return text for size complaints (`['too big',
      'too large', 'doesn't fit', 'doorway', 'too wide', 'too small', 'smaller than
      expected']`) and color/appearance complaints (`['color different', 'darker',
      'lighter', 'looks nothing like', 'doesn't match photo']`). PDP nudge: *"6 of 9
      returns cite size issues — Dimensions: 120cm × 40cm × 180cm. Standard doorways
      are 75cm wide."*

    The unifying principle: **"Fit" is just apparel's word for expectation mismatch.**
    Electronics has compatibility mismatch. Furniture has dimension mismatch. Same
    engine, different lexicons. The scorecard's `FIT_MISMATCH` signal is category-aware
    — for apparel it reads `fitSignal`, for electronics it reads `compatSignal`, for
    furniture it reads `dimensionSignal` — same weight (0.20), same position,
    different underlying RIKB field. This architecture makes Phase 7 credibly
    extensible to any product vertical without changes to the core system.

11. **Prevention Analytics Dashboard (admin-facing).** A simple view showing Phase 7's
    overall impact: total nudges shown/acted on/returns prevented (from `nudgeEvents`),
    top-5 SKUs where nudges are ignored (candidates for wording improvement), top-5
    sellers whose return rates dropped after acting on feedback, and scorecard signal
    contribution breakdown. The "proof it works" artifact — critical for the demo pitch.

**Cost & storage discipline (the binding constraint):** no GPU and no model training (the
scorecard is pure arithmetic); no new managed services (reuse Atlas M0); no extra
cross-service traffic (prevention runs in the backend, not the ML service); the
per-request path is one indexed Mongo read + pure scorecard math — no per-view LLM or
vision calls; the only LLM use is the optional nightly, cached seller-summary batch; the
RIKB stores bounded aggregates, not raw event history. The new `nudgeEvents` collection
is append-only with a TTL index (auto-expire after 90 days) to keep storage bounded.

**Done means:** the PDP shows a data-backed fit/return note (only when confidence is
sufficient); checkout shows an explainable risk nudge with a concrete CTA for risky
baskets; bracketing is intercepted at the cart; refund timing respects the trust tier;
the seller dashboard shows per-SKU return-reason clusters with before/after tracking;
nudge effectiveness is measured and surfaced; buyers who ignored nudges and returned get
a helpful learning moment; and a nightly job demonstrably refreshes the knowledge base
so the system improves with every return.

---

## Phase 8 — Sustainability, Green Credits & Donation Routing

**Goal:** Make the ecological story tangible to every user. Trivial to
compute, huge narrative payoff.

**What we build:**

1. **CO2 + water-saved factor table.** Per category, hardcoded from credible
   sources cited in Claude SOLUTION (WRAP, UPC/INTEXTER 25 kg CO2/kg clothing,
   2,700L per cotton T-shirt). Each factor cites its source — we don't fudge.
   "Estimated, not audited LCA" disclaimer everywhere.

2. **Per-disposition computation.** Every routing decision computes the
   estimated CO2 / water saved vs the counterfactual (manufacture-new) and
   writes it into the lifecycle event log. Donation paths credit the sender;
   resale paths credit both parties.

3. **Two visible counters.**
   - **User-level:** "You've saved 4.2 kg CO2 this year." Lives in the
     account dashboard. Drives the Green Credits ledger.
   - **Platform-level:** Live ticker on the homepage for the demo. Sums every
     completed disposition.

4. **Green Credits ledger.** A simple wallet-style table:
   `{user_id, credits_earned, credits_spent, ledger_entries[]}`. Earnings
   triggered on routing decisions (donate > resell > refurbish > liquidate
   in credit weight). Credits redeemable as a checkout discount on new
   purchases — ties the circular economy back into the linear one and creates
   the engagement loop the research calls for.

5. **Donation routing path completion.** When the routing engine picks
   "donate," do the heavy lifting:
   - **NGO directory** (seeded for two demo cities) with categories accepted,
     pickup radius, contact info.
   - **Match the item to the nearest NGO** that accepts the category.
   - **Auto-generate a tax-receipt PDF** with the user's name, item, estimated
     fair-market value, NGO details, signed by the platform Ed25519 key (same
     key as Health Cards — one trust artefact, two uses).
   - Schedule the pickup (mocked for demo).

**Done means:** Every disposition produces a CO2 number; users see their
counter grow; donations issue real-looking tax receipts; the running platform
counter is demoable.

---

## Phase 9 — Demo Polish, Persona Scripting & Cross-Cutting Concerns

**Goal:** Make the four personas play through the system end-to-end without
manual intervention. Hide every rough edge.

**What we do:**

1. **The four persona scripts** must run cleanly end-to-end:
   - **Priya (₹500 worn shoes, returns):** Initiate return → Pass 1 form →
     uploads → Grade C with worn-soles → reverse-logistics calc shows
     uneconomical → routing recommends donate → NGO match → tax receipt PDF
     → CO2 counter ticks up → Green Credits awarded.
   - **Rahul (used baby monitor, returns or sell-used):** Initiate (either
     path) → Grade B → demand registry shows "50 parents within 5 km" →
     route to nearest demand-cluster warehouse → AI listing generated →
     Health Card QR issued → one nearby parent gets a notification.
   - **Anjali (DSLR, sell-used):** Pick from past order → Grade A → routing
     finds high city demand → polished AI listing with suggested price →
     locker drop simulated → buyer purchases via the storefront with the same
     UX as a normal Amazon order → Health Card on the buyer's side.
   - **Small seller (200 returns/month, batch):** Bulk dashboard → every
     return auto-graded and routed → recovery-value summary across the batch
     → seller-policy panel that visibly drives different routing outcomes →
     B2B-API framing (one screen showing the same workflow as an API).

2. **Trust-tier demos.** A second Priya — same return, but on a "Watch" tier
   account because we synthesised abuse history. The demo visibly diverges:
   weight verification required, refund delayed, additional evidence fields
   appear. Shows the trust layer doing real work.

3. **Cross-cutting hardening:**
   - **Observability:** CloudWatch logs for every pipeline call; one
     CloudWatch dashboard the team keeps open during demo for confidence.
   - **Error states:** every stage (Pass 1, Pass 2, routing, listing-gen) has
     a graceful fallback. Bedrock down → cached schema or text-only fallback.
     Rekognition down → grade-with-warning. Nothing crashes the demo.
   - **Security:** all AWS keys in Secrets Manager / KMS, never in repo. The
     Ed25519 *private* key never leaves KMS. Image uploads via pre-signed S3
     URLs only.
   - **Performance:** any path that calls Bedrock returns *something* in
     under 5s — either by cache hit (Pass 1) or by streaming the response
     (Pass 2 listing copy). User never stares at a spinner.

4. **Seed everything deterministically.** One command rebuilds the demo state
   from scratch in under 60s. The team must be able to "reset and redo" mid-
   pitch if something goes wrong.

5. **Failure-mode rehearsal.** Run the demo with the network throttled and
   with one AWS service stubbed-out at a time. Catch the rough edges before
   the judges do.

**Done means:** All four persona stories play end-to-end on a fresh laptop
in under five minutes, every time.

---

## Cross-Phase Notes

**Things to consciously NOT do.**
- No real blockchain. Ed25519 + hash chain achieves the demo trust story at
  zero infra cost. Mention blockchain only as a roadmap item if asked.
- No custom-trained vision model. Rekognition Label Detection covers the
  "general defect" need without training data. Optional YOLOv8 stretch only
  if a team member has bandwidth and just for a single bounding-box flourish.
- No real escrow / KYC / payments. Assume platform-mediated; demo flows show
  refund and payout events without actually moving money.
- No real WhatsApp production integration. Twilio sandbox or screen recording.
- No live weight scales. Mock the weight-verification event in the locker
  drop simulation — it's the *signal*, not the hardware, that matters here.

**Honest caveats for the pitch.**
- Vision-LLM grading is probabilistic, not a calibrated industrial inspection.
  Pitch as "AI-assisted grading" with human review on low-confidence cases.
- Return-risk scoring is a transparent **scorecard** (hand-set, explainable weights),
  not a trained model — say so, and frame that as a strength: every number on the
  nudge is auditable, and the nightly RIKB recompute makes it self-improving as real
  returns accumulate. A trained model on real labels is the roadmap step; we
  deliberately did *not* train one on synthetic data, since that would only re-learn
  the scorecard while adding opacity.
- Crypto signatures verify the *digital record*, not the physical product —
  a determined fraudster can attach a valid QR to a fake item. Combine with
  the trust score and the photo evidence to mitigate; mention the limitation
  if pressed. (This is identical to blockchain DPPs, by the way — same
  limitation, no infrastructure cost.)
- CO2-savings figures are estimates with cited sources, not audited LCAs.

**One-paragraph elevator pitch the build maps to.**
Every returned, unused, or outgrown item enters one pipeline. AI grades it
objectively. A trust score decides whether the customer needs friction or
deserves trust. A transparent routing engine picks the path that actually
makes economic and ecological sense — donate Priya's shoes, ship Rahul's
baby monitor across town to a nearby parent, list Anjali's DSLR with a
verified Health Card. Every disposition leaves a tamper-evident trail and a
CO2 number. Sellers automate at scale via the same engine. The platform
behaves like Amazon's existing system on the linear path and like Relove
plus a fraud-aware Cashify on the circular one — without any of them.
