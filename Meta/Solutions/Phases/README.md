# Phase Implementation Guides

This directory contains detailed implementation guides for each phase of the Second-Life Commerce Ecosystem.

---

## Phase Overview

| Phase | Status | Description | Duration |
|---|---|---|---|
| **P0 — Foundation** | ✅ Complete | AWS setup, MongoDB, schemas, seed data | ~2 hours |
| **P1 — Dual Intake** | ✅ Complete | Returns & Sell-Used entry points, state machine | ~6 hours |
| **P2 — AI Grading** | ✅ Complete | Full hybrid grading pipeline (FastAPI) | ~6 hours |
| **P3 — Trust Score** | ✅ Complete | User trust profiling & fraud defense | ~6 hours |
| **P3.5 — Integration** | 🔄 **CURRENT** | Wire P1+P2+P3 together, build frontend, test flow | ~2 hours |
| **P4 — Routing** | ⏳ Next | Smart routing & disposition engine | ~4 hours |
| **P5 — Resale Marketplace** | ⏳ Pending | AI listing gen, Health Card, resale storefront | ~4 hours |
| **P6 — Demand Registry** | ⏳ Pending | Geospatial matching, notify-on-match | ~3 hours |
| **P7 — Prevention Intelligence** | ⏳ Pending | Closed-loop RIKB + explainable risk scorecard + fit intel + intervention engine ([Phase7-Prevention.md](./Phase7-Prevention.md)) | ~4 hours |
| **P7.5 — Festive Defense** | ✅ Backend done | Calendar-driven festive levers: return-window shrink, COD gate, mid-transit cancel lock ([Phase7.5-FestiveDefense.md](./Phase7.5-FestiveDefense.md)) | ~3 hours |
| **P8 — Sustainability** | ⏳ Pending | CO2 tracking, Green Credits, donation routing | ~3 hours |
| **P9 — Demo Polish** | ⏳ Final | Persona scripts, error handling, rehearsal | ~2 hours |

---

## Current Phase: P3.5 Integration

**You are here.** Your team has completed P1, P2, and P3 in parallel. Now you need to:

1. **Wire the three modules together** with orchestration endpoints
2. **Build a React frontend** to drive the flow end-to-end
3. **Test the complete pipeline** (initiate → grade → display results)
4. **Fix integration issues** before adding routing complexity in P4

**Read:** [Phase3.5-Integration.md](./Phase3.5-Integration.md)

---

## What Each Phase Document Contains

Each implementation guide includes:
- **Success criteria** (what "done" looks like)
- **Technical specifications** (endpoints, schemas, algorithms)
- **Code examples** (pseudocode and structure)
- **Testing checklists** (manual verification steps)
- **Common issues & fixes** (troubleshooting guide)
- **Team collaboration notes** (who builds what)

---

## Dependencies Between Phases

```
P0 (Foundation)
  │
  ├─► P1 (Dual Intake) ────┐
  ├─► P2 (AI Grading) ─────┼─► P3.5 (Integration) ─► P4 (Routing) ─┐
  └─► P3 (Trust Score) ────┘                                       │
                                                                   │
  ┌────────────────────────────────────────────────────────────────┘
  │
  ├─► P5 (Resale Marketplace)
  ├─► P6 (Demand Registry)
  ├─► P7 (Prevention Intelligence) ◄── Best layer; consumes P3 trust, can start after P0
  └─► P8 (Sustainability)
       │
       └─► P9 (Demo Polish) ◄── Needs all phases complete
```

**Key insight:** P7 (Prevention Intelligence) is the highest-leverage layer — "the most
sustainable return is the one that never happens." It *consumes* P3's trust profile but is
otherwise self-contained (degrades to its scorecard if trust/model are absent), so it can
start early if you have bandwidth.

---

## Quick Start (P3.5)

### 1. Verify P1, P2, P3 are complete

Check that these modules exist and have tests passing:
- ✅ `backend/src/modules/returns/` (P1)
- ✅ `backend/src/modules/secondhand/` (P1)
- ✅ `ml-service/` FastAPI app with grading endpoints (P2)
- ✅ `backend/src/modules/trust/` (P3)

### 2. Create orchestration layer (Backend)

Build 4 new Express endpoints:
- `POST /api/returns/initiate`
- `POST /api/secondhand/initiate`
- `POST /api/grading/start`
- `POST /api/grading/submit`

**See:** [Phase3.5-Integration.md § Backend Orchestration Layer](./Phase3.5-Integration.md#1-backend-orchestration-layer-express)

### 3. Build frontend pages (React)

Create 4 pages:
- `/returns/initiate` — Start a return
- `/secondhand/initiate` — Start a sell-used listing
- `/items/:id/evidence` — Upload evidence photos
- `/items/:id/status` — View grading results

**See:** [Phase3.5-Integration.md § Frontend Pages](./Phase3.5-Integration.md#2-frontend-pages-react)

### 4. Set up dev environment

```bash
# Install dependencies
npm install --save-dev concurrently
cd backend && npm install
cd ../frontend && npm install
cd ../ml-service && pip install -r requirements.txt

# Start all services
npm run dev

# Seed demo data
npm run seed
```

### 5. Test end-to-end

- [ ] Initiate return via UI
- [ ] Trust tier displays
- [ ] Upload photos to S3
- [ ] Pass 1 form appears
- [ ] Submit evidence
- [ ] Grade appears on status page
- [ ] Data persists in MongoDB

**See:** [Phase3.5-Integration.md § Integration Testing Checklist](./Phase3.5-Integration.md#5-integration-testing-checklist)

---

## Team Collaboration (P3.5)

### 3-person team:
- **Person A (Python/AI):** FastAPI integration, error handling
- **Person B (Backend):** Orchestration endpoints, trust integration
- **Person C (Frontend):** All 4 React pages, S3 upload flow

### 2-person team:
- **Person A (Python/AI):** FastAPI fixes, test with Postman
- **Person B (Full-stack JS):** Endpoints + React pages

**Time estimate:** 1–2 hours coding + 30 min testing = 2 hours total

---

## Common Integration Issues

| Issue | Fix |
|---|---|
| **CORS errors** | Configure `app.use(cors())` in Express |
| **Schema mismatch** | Standardize on camelCase (not snake_case) |
| **S3 upload fails** | Check bucket CORS policy + IAM permissions |
| **Pass 1 timeout** | Add 30s timeout + fallback to cached schema |
| **Trust tier missing** | Ensure `/initiate` endpoints compute trust profile |

**See:** [Phase3.5-Integration.md § Common Integration Issues](./Phase3.5-Integration.md#7-common-integration-issues--fixes)

---

## After P3.5: What's Next?

Once integration testing passes, you're ready for **P4 (Routing Engine)**.

P4 will add:
- Reverse-logistics cost calculator
- Weighted scoring across 6 disposition paths
- Routing decision UI (horizontal bars with rationales)
- Hard gates (hygiene categories, trust tier restrictions)

The status page already has a placeholder (`routingDecision: null`) — P4 just fills it in.

---

## Questions?

- For implementation details: Read the specific phase document
- For dependency questions: Check [ParallelWorkplan.md](../ParallelWorkplan.md)
- For overall architecture: Check [ImplementationPlan.md](../ImplementationPlan.md)

---

**Current priority: Complete P3.5 Integration before moving to P4.**
