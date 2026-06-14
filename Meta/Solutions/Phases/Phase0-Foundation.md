# Phase 0 — Foundation & Infrastructure

## Implementation Plan (Detailed)

> Goal: Remove every "I can't start because…" blocker.
> End state: AWS resources exist, schemas committed, seed loads cleanly, one ping endpoint per service responds.

---

## Current State (What We Have)

- Express backend running on port 5001
- MongoDB Atlas M0 cluster already connected (`Swallow0`)
- Mongoose with module-per-domain pattern (admin, brands, products, orders, etc.)
- Faker-powered seed script generating ~15K orders across brands/sellers/buyers
- Clerk auth middleware
- React frontend exists (separate folder)
- No AWS services integrated yet
- No Python/FastAPI service yet

---

## Task Breakdown

### Task 0.1 — AWS Account & Service Provisioning

**What:** Get all AWS resources created and accessible.

**Steps:**

1. **AWS Account Setup**
   - Confirm single shared AWS account (or create one)
   - Create an IAM user `hackathon-dev` with programmatic access
   - Attach policies: `AmazonBedrockFullAccess`, `AmazonS3FullAccess`, `AmazonRekognitionFullAccess`, `AmazonTextractFullAccess`, `AWSKeyManagementServicePowerUser`
   - Generate `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`

2. **Enable Bedrock Model Access**
   - Navigate to AWS Console → Bedrock → Model Access
   - Request access for:
     - **Amazon Nova Pro** (primary LLM)
     - **Claude 3.5 Sonnet** (fallback)
   - ⚠️ Do this FIRST — approval can take minutes to hours

3. **Create S3 Bucket**
   - Bucket name: `secondlife-marketplace-uploads` (or similar unique name)
   - Region: `ap-south-1` (Mumbai, closest to India demo context)
   - Enable CORS for browser-based pre-signed URL uploads:
     ```json
     [
       {
         "AllowedHeaders": ["*"],
         "AllowedMethods": ["GET", "PUT", "POST"],
         "AllowedOrigins": ["http://localhost:3000", "http://localhost:5173"],
         "ExposeHeaders": ["ETag"],
         "MaxAgeSeconds": 3600
       }
     ]
     ```
   - Folder structure convention: `uploads/{user_id}/{item_id}/{filename}`

4. **Create KMS Ed25519 Key**
   - AWS Console → KMS → Create Key
   - Key type: Asymmetric
   - Key usage: Sign and verify
   - Key spec: `ECC_SECG_P256K1` (or use Ed25519 via external generation + import)
   - Alternative (simpler for hackathon): Generate Ed25519 keypair locally using `crypto`, store private key as a KMS-encrypted secret, export public key to repo config
   - Alias: `secondlife-health-card-signing`

5. **Store Secrets**
   - Option A (recommended for hackathon speed): `.env` file expansion
   - Option B (production-grade): AWS Secrets Manager
   - For now: add to `.env`, migrate to Secrets Manager if time allows

**Output:** A credentials document (not committed) with all keys/ARNs.

---

### Task 0.2 — Environment Configuration

**What:** Expand the `.env` to cover all new services. Create a `.env.example` for the team.

**New Environment Variables:**

```env
# --- Existing ---
PORT=5001
MONGODB_URI=mongodb+srv://...
NODE_ENV=development
CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
CLERK_WEBHOOK_SECRET=...

# --- AWS (New) ---
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=<from Task 0.1>
AWS_SECRET_ACCESS_KEY=<from Task 0.1>

# --- S3 ---
S3_BUCKET_NAME=secondlife-marketplace-uploads
S3_UPLOAD_PREFIX=uploads

# --- Bedrock ---
BEDROCK_REGION=us-east-1
BEDROCK_MODEL_PRIMARY=amazon.nova-pro-v1:0
BEDROCK_MODEL_FALLBACK=anthropic.claude-3-5-sonnet-20241022-v2:0

# --- KMS / Signing ---
KMS_KEY_ID=<key-id-or-alias>
HEALTH_CARD_PUBLIC_KEY=<base64-encoded-ed25519-public-key>

# --- ML Service ---
ML_SERVICE_URL=http://localhost:8000

# --- App Config ---
UPLOAD_MAX_SIZE_MB=10
GRADE_CACHE_TTL_SECONDS=3600
```

**Steps:**
1. Create `backend/.env.example` with all keys (no values)
2. Update `backend/.env` with real values
3. Create `ml-service/.env.example`
4. Add `*.env` to `.gitignore` (verify it's already there)

---

### Task 0.3 — MongoDB Atlas Indexes

**What:** Create the indexes that later phases depend on, so they're ready when we need them.

**Indexes to create:**

| Collection | Index | Type | Used By |
|---|---|---|---|
| `wants` | `{ location: "2dsphere" }` | Geospatial | Phase 6 — Demand Registry |
| `wants` | `{ productCategory: 1, location: "2dsphere" }` | Compound geo | Phase 6 — filtered geo queries |
| `items` | `{ status: 1, createdAt: -1 }` | Standard | Phase 1 — state machine queries |
| `items` | `{ userId: 1, status: 1 }` | Compound | Phase 3 — trust profile lookups |
| `grades` | `{ itemId: 1 }` | Standard | Phase 2 — grade lookups |
| `lifecycleEvents` | `{ itemId: 1, sequence: 1 }` | Compound | Phase 5 — Health Card chain |
| `trustProfiles` | `{ userId: 1 }` | Unique | Phase 3 — trust score |
| `listings` | `{ conditionLane: 1, category: 1 }` | Compound | Phase 5 — marketplace browse |

**How:** Create a migration/setup script at `backend/src/config/createIndexes.js` that can be run once. Indexes on M0 are free and instant on empty collections.

---

### Task 0.4 — Backend Module Scaffolding

**What:** Create empty module folders following the existing pattern (controller + model + routes + service + validation).

**New modules to scaffold inside `backend/src/modules/`:**

```
modules/
├── returns/          ← Return initiation & state machine
│   ├── return.controller.js
│   ├── return.model.js
│   ├── return.routes.js
│   ├── return.service.js
│   └── return.validation.js
├── secondhand/       ← Sell-Used intake flow
│   ├── secondhand.controller.js
│   ├── secondhand.model.js
│   ├── secondhand.routes.js
│   ├── secondhand.service.js
│   └── secondhand.validation.js
├── grading/          ← AI grading pipeline orchestration
│   ├── grading.controller.js
│   ├── grading.model.js
│   ├── grading.routes.js
│   ├── grading.service.js
│   └── grading.validation.js
├── routing/          ← Smart disposition engine
│   ├── routing.controller.js
│   ├── routing.model.js
│   ├── routing.routes.js
│   ├── routing.service.js
│   └── routing.validation.js
├── demand/           ← Wants registry & geo matching
│   ├── demand.controller.js
│   ├── demand.model.js
│   ├── demand.routes.js
│   ├── demand.service.js
│   └── demand.validation.js
├── healthCard/       ← Product Health Card & hash chain
│   ├── healthCard.controller.js
│   ├── healthCard.model.js
│   ├── healthCard.routes.js
│   ├── healthCard.service.js
│   └── healthCard.validation.js
├── sustainability/   ← CO2/water counters & green credits
│   ├── sustainability.controller.js
│   ├── sustainability.model.js
│   ├── sustainability.routes.js
│   ├── sustainability.service.js
│   └── sustainability.validation.js
└── trust/            ← User trust profiles & fraud signals
    ├── trust.controller.js
    ├── trust.model.js
    ├── trust.routes.js
    ├── trust.service.js
    └── trust.validation.js
```

Each file starts with a minimal boilerplate:
- **Model:** Empty Mongoose schema with a TODO comment listing expected fields
- **Routes:** Express router with a single `GET /health` that returns `{ module: "name", status: "scaffolded" }`
- **Controller:** Thin handler calling service
- **Service:** Empty async functions with `// TODO: implement` placeholders
- **Validation:** Empty Joi/express-validator schemas

Register all new route files in `server.js` with their API paths.

---

### Task 0.5 — FastAPI ML Service Setup

**What:** Create the Python microservice skeleton that will host all vision/ML work.

**Folder structure:**

```
ml-service/
├── app/
│   ├── __init__.py
│   ├── main.py              ← FastAPI app entry, CORS, health check
│   ├── config.py            ← Pydantic settings from .env
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── grading.py       ← /grade endpoints (Phase 2)
│   │   ├── vision.py        ← /validate-photo, /analyze-image (Phase 2)
│   │   ├── prediction.py    ← /predict-return, /fit-recommend (Phase 7)
│   │   └── health.py        ← /health
│   ├── services/
│   │   ├── __init__.py
│   │   ├── bedrock.py       ← Bedrock client wrapper
│   │   ├── rekognition.py   ← Rekognition client wrapper
│   │   ├── textract.py      ← Textract client wrapper
│   │   ├── opencv_utils.py  ← Blur/lighting/moiré checks
│   │   └── clip_service.py  ← CLIP embeddings & similarity
│   └── models/
│       ├── __init__.py
│       └── schemas.py       ← Pydantic models for request/response
├── trained_models/           ← .joblib files for XGBoost etc.
│   └── .gitkeep
├── requirements.txt
├── Dockerfile               ← Optional, for deployment
├── .env.example
└── README.md
```

**requirements.txt (initial):**
```
fastapi==0.115.0
uvicorn[standard]==0.30.0
python-dotenv==1.0.0
boto3==1.35.0
Pillow==10.4.0
opencv-python-headless==4.10.0.84
numpy==1.26.4
imagehash==4.3.1
pydantic==2.9.0
pydantic-settings==2.5.0
```

**Startup command:** `uvicorn app.main:app --reload --port 8000`

**Health endpoint:** `GET /health → { "service": "ml-service", "status": "ok" }`

---

### Task 0.6 — Canonical Data Contracts (JSON Schemas)

**What:** Lock in the JSON shapes everything else depends on. Create a shared `backend/src/contracts/` folder with documented schema files.

**Schemas to define:**

1. **Item Lifecycle Event**
```js
{
  itemId: ObjectId,
  sequence: Number,         // monotonically increasing per item
  eventType: String,        // INITIATED | EVIDENCE_SUBMITTED | GRADED | ROUTED | IN_TRANSIT | LISTED | SOLD | DONATED | LIQUIDATED
  timestamp: Date,
  actor: { userId: ObjectId, role: String },
  data: Object,             // event-specific payload
  previousHash: String,     // SHA-256 of the previous event (null for first)
  hash: String              // SHA-256 of this event's canonical JSON
}
```

2. **Grade JSON (v1.43)**
```js
{
  itemId: ObjectId,
  grade: String,            // A | B | C | D
  qualityScore: Number,     // 0-100
  confidence: String,       // high | medium | low
  defects: [{
    type: String,
    severity: String,       // minor | moderate | major
    location: String,
    description: String
  }],
  missingEvidence: [String],
  returnClaimVerified: Boolean,
  estimatedResalePct: Number,  // 0.0-1.0
  routingHint: String,         // resell | refurbish | donate | liquidate
  rationale: String,
  modelVersions: {
    pass1Model: String,
    pass2Model: String,
    rekognitionVersion: String
  },
  createdAt: Date
}
```

3. **Routing Decision JSON**
```js
{
  itemId: ObjectId,
  gradeId: ObjectId,
  trustProfileId: ObjectId,
  chosenPath: String,       // resell | refurbish | donate | liquidate | return-to-seller | peer-redistribute
  rankedAlternatives: [{
    path: String,
    score: Number,
    netRecovery: Number,
    rationale: String
  }],
  hardGatesApplied: [String],
  reverseLogisticsCost: Number,
  demandSignal: { count: Number, radiusKm: Number },
  createdAt: Date
}
```

4. **Trust Profile JSON**
```js
{
  userId: ObjectId,
  tier: String,             // verified | trusted | standard | watch | restricted
  score: Number,            // 0-100
  signals: [{
    signal: String,
    value: Any,
    weight: Number,
    direction: String       // positive | negative
  }],
  accountAge: Number,       // days
  lifetimePurchases: Number,
  lifetimeReturns: Number,
  returnRate: Number,
  recentReturnRate90d: Number,
  bracketingFlag: Boolean,
  wardrobingFlag: Boolean,
  lastComputed: Date
}
```

5. **Listing JSON (extends Product)**
```js
{
  // ...inherits from existing product schema
  intakePath: String,       // return | sell-used
  gradeId: ObjectId,
  healthCardId: ObjectId,
  conditionLane: String,    // like-new | good | fair
  aiGeneratedTitle: String,
  aiGeneratedDescription: String,
  suggestedPrice: Number,
  selectedPhotos: [String], // S3 URLs
  demandCount: Number,      // from geo query at listing time
  sustainabilityImpact: {
    co2SavedKg: Number,
    waterSavedLiters: Number
  }
}
```

---

### Task 0.7 — S3 Pre-Signed URL Upload Utility

**What:** Build the backend endpoint that lets the frontend upload images directly to S3 without proxying bytes through Express.

**Implementation:**
- `POST /api/uploads/presign` — accepts `{ fileName, contentType, itemId }`, returns `{ uploadUrl, key, publicUrl }`
- Uses `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`
- URL valid for 5 minutes
- Frontend uses the returned URL with a plain `PUT` fetch

**New module:** `backend/src/modules/uploads/`

---

### Task 0.8 — Demo Seed Script (Second-Life Specific)

**What:** Extend the existing seed script (or create a separate `seed-secondlife.js`) that populates demo-specific data.

**Data to seed:**

| Entity | Count | Purpose |
|---|---|---|
| Demo personas | 4 | Priya, Rahul, Anjali, Small Seller — fixed clerkIds for consistent login |
| NGO directory | 5 | Two cities, categories accepted, geo coordinates |
| Wants (demand registry) | 50 | Spread across two cities, various categories |
| Carrier rate table | 1 | Per-km/per-kg rates for cost calculator |
| Category sustainability factors | 15 | CO2/water per category from WRAP/INTEXTER |
| Historical orders for personas | ~20 | So returns/sell-used can reference past purchases |
| One "Watch" tier user | 1 | For trust-tier demo divergence |

Use deterministic faker seeds (`faker.seed(42)`) so the demo is reproducible.

---

### Task 0.9 — Backend Dependency Installation

**What:** Install the new npm packages needed for Phase 0+.

**Packages to add:**
```
@aws-sdk/client-s3
@aws-sdk/s3-request-presigner
@aws-sdk/client-bedrock-runtime
@aws-sdk/client-kms
@aws-sdk/client-rekognition
@aws-sdk/client-textract
qrcode                    ← Health Card QR generation
canonicalize              ← RFC 8785 JSON canonicalization
fast-sha256               ← Already installed, used for hash chain
joi                       ← Request validation (if not already using)
```

---

### Task 0.10 — Verify End-to-End Connectivity

**What:** Confirm everything works together.

**Verification checklist:**
- [ ] `npm run dev` starts Express on port 5001, connects to Atlas
- [ ] `GET /api/health` returns 200
- [ ] All 8 new modules respond on `GET /api/{module}/health`
- [ ] `POST /api/uploads/presign` returns a valid S3 pre-signed URL
- [ ] Uploading a test file via the pre-signed URL succeeds (curl test)
- [ ] FastAPI service starts on port 8000, `GET /health` returns 200
- [ ] FastAPI can call Bedrock (simple `invoke_model` ping with a trivial prompt)
- [ ] FastAPI can call Rekognition (detect labels on a test image from S3)
- [ ] Seed script runs without error, creates all demo data
- [ ] MongoDB Atlas shows the new collections with correct indexes

---

## Execution Order & Dependencies

```
Task 0.1 (AWS Setup)
    │
    ├──► Task 0.2 (Env Config) ──► Task 0.9 (Install Deps) ──► Task 0.7 (S3 Upload)
    │
    └──► Task 0.5 (FastAPI Skeleton)
    
Task 0.3 (Indexes) ──► Task 0.8 (Seed)

Task 0.4 (Module Scaffolding) ──► Task 0.10 (Verify)

Task 0.6 (Data Contracts) ← can run in parallel with everything, no code dependency
```

**Critical path:** Task 0.1 → 0.2 → 0.9 → 0.4 → 0.10

**Parallelizable:**
- Tasks 0.3, 0.5, 0.6 can all start immediately alongside 0.1
- Task 0.8 can start as soon as 0.3 + 0.4 are done

---

## Estimated Time

| Task | Time | Who |
|---|---|---|
| 0.1 AWS Setup | 30 min | One person with AWS console access |
| 0.2 Env Config | 15 min | Same person |
| 0.3 Indexes | 15 min | Anyone |
| 0.4 Module Scaffolding | 45 min | Backend dev |
| 0.5 FastAPI Skeleton | 45 min | Python dev |
| 0.6 Data Contracts | 30 min | Anyone (just JSON docs) |
| 0.7 S3 Upload Utility | 30 min | Backend dev |
| 0.8 Demo Seed | 45 min | Backend dev |
| 0.9 Dependencies | 10 min | Whoever runs npm install |
| 0.10 Verify | 20 min | Whole team |

**Total (sequential):** ~5 hours
**Total (parallelized with 2-3 people):** ~2.5 hours

---

## Definition of Done

When ALL of the following are true, Phase 0 is complete:

1. ✅ AWS credentials are working — Bedrock, S3, KMS, Rekognition, Textract all reachable
2. ✅ `.env.example` committed with all required keys documented
3. ✅ 8 new module folders exist with health endpoints responding
4. ✅ FastAPI service runs and can reach AWS services
5. ✅ S3 pre-signed upload works from browser
6. ✅ Data contract schemas are committed and reviewed by team
7. ✅ Seed script produces reproducible demo state
8. ✅ MongoDB indexes exist on the correct collections
9. ✅ Any team member can clone, copy `.env`, run `npm install` + `pip install`, and have both services running in < 2 minutes
