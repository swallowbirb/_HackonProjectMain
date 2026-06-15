# SecondLife — AI-Powered Reverse Commerce & Fraud Defence

An e-commerce platform extended with an AI-driven reverse-commerce layer: returns and
used-item listings are graded, routed, and resold automatically — recovering value instead
of writing it off. A closed-loop prevention layer and a festive-defence system stop bad
returns before they happen.

---

## What it does

| Capability | How |
|---|---|
| **Dual intake** | Returns and sell-used listings enter through one converged pipeline, producing a single `Item` with a shared state machine |
| **AI grading** | Google Gemini generates a claim-specific evidence form, inspects each field's photo set (or video frames), then synthesises a Grade A–D with defect list and resale value estimate |
| **Video evidence grading** | For fields where a video better shows the defect (e.g. a cracked hinge, a flickering screen), Gemini assigns `capture_mode: video`. The server extracts frames at 1.5 fps via OpenCV, runs perceptual-hash diversity selection (max 6 frames), and pipes them into the same `inspect-field` path as photos — same LLM cost budget. A CPU-only liveness check (phash frame-to-frame continuity) flags spliced/fake footage without any LLM call |
| **Fraud preflight** | Perceptual hash vs. catalog + EXIF camera-data check on every uploaded photo or video frame — hard-rejects stock-photo theft before any LLM call |
| **Trust scoring** | Per-user trust profile (0–100 score + 5 tiers) with pattern detectors for bracketing, wardrobing, and sudden behavioural shifts |
| **Disposition routing** | Deterministic 6-path weighted scorecard (resell / refurbish / peer-redistribute / donate / liquidate / return-to-seller) with hard gates and trust-driven refund timing |
| **Geo-demand matching** | Buyers post "Looking for…" wants with location; graded items are tagged and matched via `$geoNear` to find nearby demand before routing |
| **Resale storefront** | Grade-backed PDP with AI rationale, defects, condition lane, and previous-owner notes. Seller dashboard with demand count and inline price edit |
| **Return prevention** | Closed-loop Return Insights KB (RIKB) per SKU — mines the platform's own returns/reviews for fit, compat, and dimension signals; shows a single fit hint on the PDP |
| **Festive defence** | Calendar-aware policy engine: return-window shrink, COD gate, and mid-transit cancel lock — applied to the risky cohort only, never touching genuine buyers |
| **Sustainability tracking** | CO₂ and water savings per disposed item using WRAP/INTEXTER category factors; green credits per user *(scaffolded, pending wire-up)* |
| **Developer logs sidebar** | Real-time plain-English pipeline logs on every flow page — useful for demos and debugging |

---

## Architecture

```
Browser (React + Vite)
        │
        ▼
Express API  (Node.js — backend/)
        │
        ├── MongoDB Atlas M0  (primary datastore)
        ├── AWS S3             (evidence photo storage — browser direct upload)
        ├── AWS Rekognition / Textract  (vision signals for fraud preflight)
        └── FastAPI ML service  (ml-service/ — grading, form gen, vision)
                    │
                    └── Google Gemini  (gemini-2.5-flash / flash-lite)
```

Three processes run concurrently:

| Process | Default port | Start command |
|---|---|---|
| Express backend | 5001 | `npm run dev:backend` |
| React frontend | 5173 | `npm run dev:frontend` |
| FastAPI ML service | 8000 | `npm run dev:ml` |

---

## Quick start

### Prerequisites

- Node.js ≥ 18
- Python ≥ 3.10 + pip
- MongoDB Atlas cluster (free M0 tier works)
- AWS account (S3 bucket in `ap-south-1`, IAM user with S3 + Rekognition + Textract access)
- Google Gemini API key ([aistudio.google.com](https://aistudio.google.com))
- Clerk account ([clerk.com](https://clerk.com))

### 1. Clone and install

```bash
git clone <repo-url>
cd _HackonProjectMain

# Install all JS dependencies (root + backend + frontend) in one shot
npm run install:all

# Install Python dependencies
cd ml-service
pip install -r requirements.txt
cd ..
```

### 2. Configure environment

Copy the root template and fill in your values:

```bash
cp .env.example .env
```

Then copy the same values into the service-specific files:

```bash
cp backend/.env.example backend/.env
cp ml-service/.env.example ml-service/.env
```

Key variables:

| Variable | Where | What |
|---|---|---|
| `MONGODB_URI` | backend/.env | Atlas connection string |
| `CLERK_SECRET_KEY` | backend/.env | Clerk backend key |
| `CLERK_PUBLISHABLE_KEY` | backend/.env | Clerk frontend key |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | backend/.env + ml-service/.env | IAM credentials |
| `S3_BUCKET_NAME` | backend/.env | Evidence photo bucket |
| `GEMINI_API_KEY` | backend/.env + ml-service/.env | Gemini API key |
| `ML_SERVICE_URL` | backend/.env | `http://localhost:8000` in dev |
| `VITE_API_URL` | frontend/.env | `http://localhost:5001/api` in dev |

### 3. Seed the database

```bash
npm run seed          # core products, users, orders
npm run seed:trust    # trust profiles for demo users
```

Additional seed scripts in `backend/` for demand, routing, resale, and festive calendar data.

### 4. Start all three services

```bash
npm run dev           # backend + frontend + ml-service concurrently
```

Or start individually:

```bash
npm run dev:backend   # Express on :5001
npm run dev:frontend  # Vite on :5173
npm run dev:ml        # FastAPI on :8000
```

---

## Project structure

```
_HackonProjectMain/
├── backend/
│   ├── server.js                  ← Express entry point
│   └── src/
│       ├── config/                ← DB connection, Atlas index creation
│       ├── contracts/             ← Frozen data-shape contracts (do not break)
│       ├── middleware/            ← Clerk auth, error handler
│       └── modules/
│           ├── returns/           ← P1: return intake
│           ├── secondhand/        ← P1: sell-used intake
│           ├── items/             ← P1: Item model + state machine + dev logs
│           ├── lifecycle/         ← P1: append-only event log
│           ├── grading/           ← P2: form gen + field inspection + synthesis
│           ├── prompts/           ← P2: prompt management
│           ├── trust/             ← P3: trust profile + fraud signals
│           ├── routing/           ← P4: disposition brain
│           ├── demand/            ← P6: geo-demand + buyer wants + warehouse map
│           ├── resale/            ← P5: resale listing storefront
│           ├── prevention/        ← P7: RIKB + checkout risk + fit hints
│           ├── festive/           ← P7.5: festive calendar + policy levers
│           ├── sustainability/    ← CO₂/water impact tracking (scaffolded)
│           ├── uploads/           ← S3 presign utility
│           ├── orders/            ← Base marketplace orders (extended by P7.5)
│           ├── products/          ← Base marketplace products
│           ├── users/             ← Base marketplace users
│           ├── brands/            ← Brand + enrollment model
│           ├── brandCatalog/      ← Brand catalog entries
│           ├── offers/            ← Seller offers + Buy Box logic
│           ├── reviews/           ← Product reviews (read by P7 prevention)
│           ├── admin/             ← Admin endpoints
│           └── webhooks/          ← Clerk webhook handler
├── frontend/                      ← React + Vite + Tailwind/shadcn
├── ml-service/                    ← FastAPI — grading, vision, prediction
│   ├── app/
│   │   ├── main.py
│   │   ├── routers/               ← grading, vision, prediction, health
│   │   ├── services/              ← Gemini, Rekognition, Textract, OpenCV, CLIP
│   │   ├── prompts/               ← Base + category prompt overlays
│   │   └── models/                ← Pydantic request/response schemas
│   └── tests/
└── Meta/Solutions/                ← Architecture docs and phase guides
    └── UnifiedTechnicalDocumentation.md  ← Single source of truth
```

---

## Grading pipeline detail

### AI video grading

When Pass 1 (Gemini) determines a field is better evidenced by video — e.g. a hinge
that only shows damage when flexed, or a screen flickering under use — it sets
`capture_mode: "video"` on that field in the generated `Form_Schema`.

The video path then runs entirely server-side before any LLM call:

```
User uploads video → S3
        │
        ▼
video_frame_selector.py  (CPU-only, no LLM, no network)
  ├─ extract_frames()        OpenCV samples at 1.5 fps → candidate JPEG frames
  ├─ phash_continuity()      Frame-to-frame Hamming distance → liveness / splice detection
  └─ phash_diversify()       Blur + brightness filter → near-duplicate cull → max 6 frames
        │
        ▼
Selected frames → same inspect-field path as photos
  ├─ catalog stock-photo-theft check (same phash as photo path, reused)
  └─ Gemini inspect-field call → EvidenceFragment (same shape as photo fields)
        │
        ▼
liveness signal stored on Item.videoEvidence[fieldId]
Pass 2 synthesis reads fragments as text — indifferent to photo vs. video origin
```

Key properties:
- **Same LLM budget as photos** — max 6 frames per field, exactly as designed for photo fields
- **Liveness is LLM-free** — phash discontinuity threshold detects cuts/splices without spending any AI calls
- **Graceful degradation** — if `opencv-python-headless` is not installed, `extract_frames()` returns `[]` and the client-side canvas extraction path takes over; the grading flow never blocks
- **No new signal types** — the catalog theft check on frames reuses `fraud_preflight.phash_match` and `fraud_preflight.classify`, so a matching frame raises the identical `HARD` signal the photo path raises

---

## Key data contracts (frozen — do not rename or remove)

These live in `backend/src/contracts/` and decouple the phases:

| File | What it locks |
|---|---|
| `grade.contract.js` | Grade JSON shape: `grade`, `qualityScore`, `defects[]`, `estimatedResalePct`, `routingHint`, `fraudCheck` |
| `trustProfile.contract.js` | `TRUST_TIERS`, `TIER_THRESHOLDS`, `TRUST_SIGNALS`, `RETURN_RATE_THRESHOLDS` |
| `routingDecision.contract.js` | `chosenPath`, `rankedAlternatives`, hard gates |
| `resaleListing.contract.js` | Resale listing shape and trigger paths |
| `demand.contract.js` | Buyer-post and warehouse document shape |
| `festive.contract.js` | Event codes, multipliers, COD caps, policy bundle |
| `prevention.contract.js` | Scorecard signal weights and risk bands |

Frozen integration interfaces (same rule):

```
trustService.getTrustProfile(userId)         → { tier, score } | null
gradingService.triggerGrading(itemId, ctx)   → void (fire-and-forget)
resaleService.createDraftFromRouting(...)    → ResaleListing | null
preventionService.getRefundTiming(...)       → 'instant' | 'delayed'
```

---

## Item lifecycle

```
INITIATED → AWAITING_EVIDENCE → EVIDENCE_PENDING → GRADING → GRADED
                                                           ↓         ↓
                                                       REJECTED   ROUTED → IN_TRANSIT → LISTED → SOLD
                                                                       ↓         ↓
                                                                   DONATED   LIQUIDATED
```

Every transition appends an append-only `LifecycleEvent` with a monotonically increasing
`sequence` per item.

---

## ML service endpoints

| Method | Path | Status | Phase |
|---|---|---|---|
| GET | `/health` | ✅ Ready | 0 |
| POST | `/grade/form` | ✅ Ready | 2 — Pass 1: claim-specific form generation (assigns `capture_mode: video\|photo\|text` per field) |
| POST | `/vision/inspect-field` | ✅ Ready | 2 — per-field batched inspection; accepts both photos and pre-selected video frames |
| POST | `/grade/` | ✅ Ready | 2 — Pass 2: grade synthesis over all field fragments |
| POST | `/vision/validate-photo` | ✅ Ready | 2 — fraud preflight (phash + EXIF) |
| POST | `/vision/analyze-image` | ✅ Ready | 2 — full image analysis |
| POST | `/predict/return` | 🔲 TODO | 7 — return risk prediction |
| POST | `/predict/fit-recommend` | 🔲 TODO | 7 — fit recommendation |

> **Video frame processing** (`video_frame_selector.py`) runs in-process before the
> `inspect-field` call — it is not a separate HTTP endpoint. The backend uploads the video
> to S3, then passes the selected frames directly into the existing `POST /vision/inspect-field`
> payload.

---

## What is and isn't built

| Feature | Status |
|---|---|
| Dual intake (returns + sell-used) | ✅ Complete |
| AI grading pipeline (Pass 1 + field inspect + Pass 2) | ✅ Complete |
| AI video grading (video fields → frame extraction → liveness → inspect-field) | ✅ Complete |
| Fraud preflight (phash + EXIF + Rekognition) | ✅ Complete |
| Trust scoring + pattern detectors | ✅ Complete |
| Routing brain (6-path scorecard + hard gates) | ✅ Complete |
| Geo-demand matching + buyer wants | ✅ Complete |
| Resale storefront + seller dashboard | ✅ Complete |
| Return prevention (RIKB + fit hints + checkout risk) | ✅ Complete |
| Festive defence — backend | ✅ Complete |
| Festive defence — frontend (COD toggle, banners) | ⏳ Pending |
| Developer logs sidebar | ✅ Complete |
| Sustainability impact tracking | 🔲 Scaffolded — service stubs return 501 |
| Real courier / pickup scheduling | ➖ Simulated via state transitions |
| LightGBM return-risk model | ➖ Deferred — JS scorecard is primary |

---

## Documentation

Full architecture, data flows, phase details, and design decisions:
[`Meta/Solutions/UnifiedTechnicalDocumentation.md`](Meta/Solutions/UnifiedTechnicalDocumentation.md)

Per-phase implementation guides: [`Meta/Solutions/Phases/`](Meta/Solutions/Phases/)
