# Phase 3.5 — How to Test the Flow End-to-End

This guide walks through running the integrated stack (P1 Dual Intake + P2 AI
Grading + P3 Trust Score) and exercising the full intake → grade flow with the
frontend and the Developer Logs sidebar.

## Prerequisites

- Node 18+ and npm
- Python 3.10+ with `uv`/`uvicorn` (for the ML service)
- A MongoDB connection string in `backend/.env`
- AWS credentials in `backend/.env` (S3 + Bedrock) — see `.env.example`

## One-command dev

From the repo root:

```bash
npm run install:all   # installs root + backend + frontend deps (first time)
npm run dev           # starts backend (5001), frontend (5173), ml-service (8000)
```

If you don't need the ML service running locally:

```bash
npm run dev:web       # backend + frontend only
```

Seed a known demo state:

```bash
npm run seed          # base marketplace data
npm run seed:trust    # trust-profile demo personas (different tiers)
```

## Ports

| Service   | URL                          |
|-----------|------------------------------|
| Backend   | http://localhost:5001        |
| Frontend  | http://localhost:5173        |
| ML service| http://localhost:8000        |

The frontend reads `VITE_API_URL` from `frontend/.env` (defaults to
`http://localhost:5001/api`).

## End-to-end: Returns flow

1. Sign in as a buyer, go to **Your Orders** (`/orders`).
2. Click **Return item** on a completed order, pick a reason, continue.
3. You land on **`/items/:itemId/evidence`** — note the **Trust Tier badge**
   and the **Developer Logs sidebar** on the right.
4. Upload 1+ photos and click **Submit Evidence**.
5. You're routed to **`/items/:itemId/status`**. The status page polls every 3s.
6. Watch the Developer Logs sidebar stream:
   `INITIATE → ITEM_CREATED → EVIDENCE_SUBMIT → PASS2_START → FRAUD_CHECK →
   PASS2_BEDROCK → GRADE_ASSIGNED → FLOW_COMPLETE`.
7. When grading completes, the **Grade card** (A/B/C/D, score, defects,
   claim verification, expandable rationale) appears and the item status is
   `GRADED`.

## End-to-end: Sell-Used flow

1. Go to **Sell on Second-Hand** (`/sell-secondhand`).
2. Pick a past order, add an optional note, continue to photos.
3. Same evidence → status → grade flow as returns (`intakePath: sell-used`).

## What to verify

- Trust tier is computed at intake and shown on evidence + status pages.
- Photos upload to S3 (check the bucket).
- The item transitions `GRADING → GRADED` and the grade persists in the
  `grades` collection (Phase 3.5 fix wires `markGraded` after the pipeline).
- `itemLogs` collection fills with plain-English logs (auto-expire after 7d).
- Lifecycle events are written for each transition.

## Key endpoints (see `docs/api-collection.json`)

- `POST /api/returns` — initiate a return
- `POST /api/returns/:itemId/evidence` — submit photos (triggers grading)
- `POST /api/secondhand/from-order` — initiate a sell-used listing
- `POST /api/secondhand/:itemId/evidence` — submit photos
- `GET  /api/items/:itemId/status` — unified status (state + trust + grade)
- `GET  /api/items/:itemId/logs` — developer log stream
- `POST /api/uploads/presign` — S3 pre-signed upload URL

## Auth note (local dev)

In non-production, the backend accepts a mock bearer token prefixed with
`mock_` (mapped to a Clerk user id) so you can hit endpoints from Postman/Thunder
without a real Clerk session. Use `Authorization: Bearer mock_<clerkId>`.
