# Phase 1 — Dual-Intake Entry Points

## Goal

Build the two front doors (Returns + Sell-Used) that feed the same downstream pipeline. **No AI yet** — just the screens, the convergence model, the state machine, and the lifecycle event log.

> By end of Phase 1: a buyer can hit "Initiate Return" on an order and a user can start a "Sell on Second-Hand" listing; both produce the same `Item` record in the same state machine, ready for Phase 2 to grade.

---

## Merge-Conflict Avoidance Strategy

Teammates are working on **Phase 2 (AI Grading)** and **Phase 3 (Trust Score)** in parallel. To minimize merge pain, this phase follows strict rules:

### Files we WILL NOT touch (teammates' territory)
- ❌ `backend/src/modules/grading/*` — Phase 2
- ❌ `backend/src/modules/trust/*` — Phase 3
- ❌ `ml-service/**/*` — Phase 2
- ❌ `backend/src/modules/sustainability/*` — Phase 8 (not now)
- ❌ `backend/src/modules/routing/*` — Phase 4 (not now)
- ❌ `backend/src/modules/healthCard/*` — Phase 5 (not now, but see note below)

### Files we WILL touch (Phase 1's territory)
- ✅ `backend/src/modules/returns/*` — full implementation
- ✅ `backend/src/modules/secondhand/*` — full implementation
- ✅ `backend/src/modules/items/*` — **new module** (the convergence point)
- ✅ `backend/src/modules/lifecycle/*` — **new module** (lifecycle event log)
- ✅ `backend/server.js` — register the new `items` and `lifecycle` route mount
- ✅ `frontend/src/pages/*` and `frontend/src/services/*` — new pages and services

### Forward-reference contract (zero coupling)
We **call** `gradingService.triggerGrading(itemId)` and `trustService.getTrustProfile(userId)` but treat them as fire-and-forget stubs. They already exist as 501 stubs from Phase 0 — we don't change their signatures. If they throw, the item still progresses to `EVIDENCE_PENDING`/`GRADING` and the lifecycle event is recorded.

This means:
1. Phase 2 teammate fills in `triggerGrading` — no merge conflict.
2. Phase 3 teammate fills in `getTrustProfile` — no merge conflict.
3. We just have to agree on the **call signature** today.

### Agreed call signatures (post these in team chat)
```js
// Phase 2 contract
gradingService.triggerGrading(itemId, { evidencePhotos, category, originalProductId })
  → Promise<{ gradeId, status }>  // returns 501 stub for now

// Phase 3 contract
trustService.getTrustProfile(userId)
  → Promise<{ tier, score } | null>  // returns null stub for now
```

---

## Architecture Decision: Item as Convergence Point

The implementation plan says: *"Either way we create an item record that drops into the same downstream pipeline as a return."* This is the architectural pivot of Phase 1.

```
┌──────────────────┐         ┌────────────────────┐
│  Return record   │         │ SecondhandItem     │
│  (intake = ret)  │         │ (intake = sell)    │
│  • orderId       │         │ • category         │
│  • reason        │         │ • description      │
│  • reasonCode    │         │ • originalOrderId  │
│  • refundAmount  │         │   (optional)       │
└────────┬─────────┘         └──────────┬─────────┘
         │                              │
         │   intakePath: 'return'       │   intakePath: 'sell-used'
         └──────────────┬───────────────┘
                        ▼
               ┌──────────────────┐
               │      Item        │  ← **convergence model**
               │  • status (FSM)  │
               │  • intakePath    │
               │  • returnId/     │
               │    secondhandId  │
               │  • evidencePhotos│
               │  • gradeId       │  (filled by Phase 2)
               │  • routingId     │  (filled by Phase 4)
               │  • healthCardId  │  (filled by Phase 5)
               └────────┬─────────┘
                        │
                        ▼
               ┌──────────────────┐
               │ LifecycleEvent[] │  ← **append-only audit log**
               │  • itemId        │
               │  • sequence      │
               │  • eventType     │
               │  • previousHash  │  (Phase 5 will sign these)
               │  • hash          │
               └──────────────────┘
```

**Why this design:**
- `Return` and `SecondhandItem` keep their intake-specific fields (refund amount, original order, etc.).
- `Item` carries the universal state machine and forward-references that Phase 2/4/5 will populate.
- `LifecycleEvent` is the audit log; Phase 5 will turn it into the signed Health Card chain.

---

## Task Breakdown

### Task 1.1 — `Item` Model & State Machine

**File:** `backend/src/modules/items/item.model.js` (new)

```js
{
  intakePath: 'return' | 'sell-used',
  initiatorUserId: ObjectId(User),

  returnId: ObjectId(Return) | null,
  secondhandId: ObjectId(SecondhandItem) | null,

  originalOrderId: ObjectId(Order) | null,
  originalProductId: ObjectId(Product) | null,
  category: String,
  reasonText: String,
  reasonCode: String,        // enum from contracts
  description: String,

  evidencePhotos: [String],  // S3 URLs

  // State machine
  status: enum([
    'INITIATED',
    'EVIDENCE_PENDING',
    'GRADING',
    'GRADED',           // Phase 2 fills this
    'ROUTED',           // Phase 4
    'IN_TRANSIT',
    'LISTED',           // Phase 5
    'SOLD',
    'DONATED',
    'LIQUIDATED',
    'REJECTED',
    'CANCELLED',
  ]),

  // Forward refs (other phases populate)
  gradeId: ObjectId(Grade) | null,
  routingDecisionId: ObjectId(RoutingDecision) | null,
  healthCardId: ObjectId(HealthCard) | null,
  listingId: ObjectId(Listing) | null,

  // Trust context snapshot at submission time (Phase 3 populates)
  trustTierAtSubmission: String | null,

  timestamps: true
}
```

**Indexes:** `{ initiatorUserId, createdAt: -1 }`, `{ status, createdAt: -1 }`, `{ returnId }`, `{ secondhandId }`.

---

### Task 1.2 — State Machine Service

**File:** `backend/src/modules/items/item.service.js` (new)

Functions:
- `createItem(data)` — creates an `Item` doc with status `INITIATED`, writes the first lifecycle event.
- `transitionStatus(itemId, nextStatus, actor, eventData)` — validates transition is legal, updates `Item.status`, appends a `LifecycleEvent`.
- `getItemById(itemId)` — fetches with populated grade/routing/healthcard refs (will be null until those phases run).
- `getItemsByUser(userId)` — buyer's items list.
- `attachEvidence(itemId, photos, actor)` — appends photos, transitions `INITIATED → EVIDENCE_PENDING`.
- `submitForGrading(itemId, actor)` — transitions `EVIDENCE_PENDING → GRADING`, fire-and-forgets `gradingService.triggerGrading(itemId, ctx)`.

**Allowed transitions table:**
```
INITIATED         → EVIDENCE_PENDING | CANCELLED
EVIDENCE_PENDING  → GRADING | CANCELLED
GRADING           → GRADED | REJECTED              (Phase 2 owns this)
GRADED            → ROUTED                          (Phase 4)
ROUTED            → IN_TRANSIT | DONATED            (Phase 4 → 8)
IN_TRANSIT        → LISTED | LIQUIDATED             (Phase 5 / ops)
LISTED            → SOLD | LIQUIDATED               (Phase 5)
```

Phase 1 owns transitions through `INITIATED → EVIDENCE_PENDING → GRADING`. Everything beyond is wired but executed by later phases.

---

### Task 1.3 — `LifecycleEvent` Model

**File:** `backend/src/modules/lifecycle/lifecycle.model.js` (new)

```js
{
  itemId: ObjectId(Item),
  sequence: Number,         // monotonically increasing per item
  eventType: enum from contracts/lifecycleEvent.contract.js,
  timestamp: Date,
  actor: { userId: ObjectId, role: String },
  data: Mixed,              // event-specific payload
  previousHash: String | null,
  hash: String | null,      // computed in Phase 5
}
```

**Index:** `{ itemId: 1, sequence: 1 }` — unique compound (already created in Phase 0's `createIndexes.js`).

**Helper:** `appendEvent(itemId, eventType, actor, data)` — auto-increments `sequence`, leaves `previousHash`/`hash` null for now (Phase 5 will backfill / compute on append).

> ⚠️ Phase 5 hash chain note: We deliberately leave `previousHash` and `hash` as `null` placeholders. Phase 5 will either backfill the chain in a one-time job, or update the helper to compute hashes on append. Phase 1 establishes the **shape** of the log; Phase 5 turns it into a tamper-evident chain. No conflict.

---

### Task 1.4 — Returns Module Implementation

**Files:** `backend/src/modules/returns/return.service.js`, `return.controller.js`, `return.routes.js`, `return.validation.js`, `return.model.js` — finalize all of these.

**Endpoints:**
| Method | Path | Auth | Body / Params | Returns |
|---|---|---|---|---|
| POST | `/api/returns` | buyer | `{ orderId, reasonCode, reasonText, description }` | `{ itemId, returnId, status }` |
| POST | `/api/returns/:itemId/evidence` | buyer | `{ photos: [s3url] }` | `{ itemId, status }` (transitions to EVIDENCE_PENDING then submits for grading) |
| GET | `/api/returns/my` | buyer | — | `[{ ...returnRecord, item }]` |
| GET | `/api/returns/:returnId` | buyer (own) or admin | — | full record + populated item + lifecycle events |

**Business logic in `initiateReturn`:**
1. Verify order belongs to user and is `completed`.
2. Verify no existing active return for this order.
3. Verify return window (e.g., within 30 days of order — config-driven for demo).
4. Look up Phase 3 trust profile (`trustService.getTrustProfile(userId)`) — gracefully handles null.
5. Snapshot `category`, `originalProductId` from the order's product.
6. Create `Return` record + `Item` record (atomic transaction or sequential with cleanup).
7. Append `INITIATED` lifecycle event with the trust tier.
8. Return `itemId` so frontend can navigate to the evidence shell.

---

### Task 1.5 — Secondhand Module Implementation

**Files:** `backend/src/modules/secondhand/*` — finalize all.

**Endpoints:**
| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/api/secondhand/from-order` | buyer | `{ orderId, description? }` | `{ itemId, secondhandId }` (Relove pattern — pre-fills from past order) |
| POST | `/api/secondhand/:itemId/evidence` | buyer | `{ photos }` | `{ itemId, status }` — same evidence handler as returns |
| GET | `/api/secondhand/my` | buyer | — | `[{ ...secondhandRecord, item }]` |
| GET | `/api/secondhand/:id` | buyer (own) or admin | — | full record + populated item + lifecycle events |

> ⚠️ `from-elsewhere` endpoint is removed. Only items with a verified order on this
> platform can be listed as secondhand. This is enforced at the service layer —
> `initiateSecondhand` must verify `orderId` belongs to the requesting user.

---

### Task 1.6 — Shared Evidence Submit Logic

Both `POST /api/returns/:itemId/evidence` and `POST /api/secondhand/:itemId/evidence` share business logic. Extract into `itemService.attachEvidence(itemId, photos, actor)` so we have one code path.

Sequence on submit:
1. Verify item belongs to user and is in `INITIATED` status.
2. Validate photos array (≥1, all are S3 URLs in our bucket).
3. Append photos to `Item.evidencePhotos`.
4. Transition `INITIATED → EVIDENCE_PENDING` (writes lifecycle event `EVIDENCE_SUBMITTED`).
5. Immediately transition `EVIDENCE_PENDING → GRADING` (writes lifecycle event `GRADING_TRIGGERED`).
6. Fire-and-forget `gradingService.triggerGrading(itemId, ctx)`. Wrap in try/catch — if the grading service is still a 501 stub or errors, log it but do not fail the request. The item stays in `GRADING` until Phase 2 completes.
7. Return `{ itemId, status: 'GRADING' }`.

---

### Task 1.7 — Frontend: Returns Entry

**File:** `frontend/src/pages/BuyerOrdersPage.jsx` — extend existing page.

For each completed order:
- Add a small "Return this item" button (only if `status === 'completed'` and within return window).
- Click → modal or new page `frontend/src/pages/ReturnInitiatePage.jsx`:
  - Reason dropdown (defective / not_as_described / changed_mind / wrong_item / other).
  - Free-text description.
  - Submit calls `POST /api/returns` → on success navigates to `/items/:itemId/evidence`.

**New service:** `frontend/src/services/return.service.js` — `initiateReturn`, `submitEvidence`, `getMyReturns`, `getReturnById`.

---

### Task 1.8 — Frontend: Sell-Used Entry

**Files:**
- `frontend/src/pages/SellSecondhandPage.jsx` (new) — shows the user's past orders, pick one to list.
- `frontend/src/services/secondhand.service.js` (new).

> `SellFromElsewherePage` is removed. The sell-used flow is a single page:
> user sees their past orders, picks one, optionally adds a description, and
> proceeds to the shared evidence page.

Submits to `POST /api/secondhand/from-order` then navigates to `/items/:itemId/evidence`.

**Nav update:** Add "Sell on Second-Hand" link to whatever nav component the app uses (check `frontend/src/components/`).

---

### Task 1.9 — Frontend: Shared Evidence Shell

**File:** `frontend/src/pages/ItemEvidencePage.jsx` (new) — the page Phase 2 will eventually overlay with the dynamic Pass-1 form.

For Phase 1:
- Generic form: free-text description + photo upload widget.
- Photo upload uses existing `/api/uploads/presign` endpoint (built in Phase 0) → uploads directly to S3 → collects S3 URLs.
- Submit calls `POST /api/{returns|secondhand}/:itemId/evidence` based on intake path.
- On success, navigate to `/items/:itemId/status`.

> 🪝 **Phase 2 hook:** Add a clearly marked `// TODO: Phase 2 — replace with dynamic Pass-1 form` block at the top of the form section. Phase 2 will mount the dynamic form schema here.

---

### Task 1.10 — Frontend: Item Status Tracker

**File:** `frontend/src/pages/ItemStatusPage.jsx` (new)

- Polls `GET /api/items/:itemId` every 3s while `status` is in `[GRADING, ROUTED, IN_TRANSIT]`.
- Shows a simple horizontal stepper: INITIATED → EVIDENCE_PENDING → GRADING → GRADED → ROUTED → DONE.
- Until Phase 2 lands, the status stays at `GRADING` — that's expected.

---

### Task 1.11 — Items API (read-only convenience routes)

**File:** `backend/src/modules/items/item.routes.js` (new)

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/api/items/health` | — | `{ module: 'items', status: 'ok' }` |
| GET | `/api/items/:itemId` | owner or admin | full item + lifecycle events |
| GET | `/api/items/my` | authenticated | user's items across both intake paths |

Frontend uses these for the status tracker.

---

### Task 1.12 — `server.js` Route Registration

Add only **two** new lines to `server.js` (single-line additions to minimize merge conflicts):
```js
const itemsRoutes = require("./src/modules/items/item.routes");
const lifecycleRoutes = require("./src/modules/lifecycle/lifecycle.routes");
// ...
app.use("/api/items", itemsRoutes);
app.use("/api/lifecycle", lifecycleRoutes);
```

The `returns`, `secondhand` routes are already registered from Phase 0 — we don't touch those lines.

---

## Demo State (Manual Verification)

By end of Phase 1, this should work end-to-end:

1. **Returns:** Buyer logs in → Buyer Orders page → click "Return this item" → fills reason → uploads 2 photos → sees status `GRADING` (waiting for Phase 2).
2. **Sell-from-order:** Same buyer → "Sell on Second-Hand" → picks an old order → uploads photos → status `GRADING`.
3. **Convergence check:** Both items live in the `items` collection with the same state machine. `lifecycle_events` collection has 3+ events per item.

---

## Definition of Done

- [ ] `Item` model committed with state machine validation.
- [ ] `LifecycleEvent` model committed; events written on every transition.
- [ ] Both `returns` and `secondhand` modules have working endpoints with auth.
- [ ] Shared `attachEvidence` helper transitions items to `GRADING` and calls `gradingService.triggerGrading()` (fire-and-forget).
- [ ] Frontend: returns entry from order page works end-to-end on the dev backend.
- [ ] Frontend: both sell-used sub-flows reach the shared evidence shell and submit.
- [ ] Frontend: status tracker page polls and shows current state.
- [ ] No code touched in `grading/`, `trust/`, `routing/`, `healthCard/`, `sustainability/`, `ml-service/`.
- [ ] `npm run dev` starts backend cleanly.
- [ ] `git diff --stat origin/main...ansh-phase-1` shows only Phase 1 files modified.

---

## Deliverable Files

**New (no conflict risk):**
- `backend/src/modules/items/item.model.js`
- `backend/src/modules/items/item.service.js`
- `backend/src/modules/items/item.controller.js`
- `backend/src/modules/items/item.routes.js`
- `backend/src/modules/items/item.validation.js`
- `backend/src/modules/lifecycle/lifecycle.model.js`
- `backend/src/modules/lifecycle/lifecycle.service.js`
- `backend/src/modules/lifecycle/lifecycle.routes.js`
- `frontend/src/pages/ReturnInitiatePage.jsx`
- `frontend/src/pages/SellSecondhandPage.jsx`
- `frontend/src/pages/ItemEvidencePage.jsx`
- `frontend/src/pages/ItemStatusPage.jsx`
- `frontend/src/services/return.service.js`
- `frontend/src/services/secondhand.service.js`
- `frontend/src/services/item.service.js`

**Modified (low conflict risk — additive only):**
- `backend/server.js` — two new route mounts
- `backend/src/modules/returns/*` — fill the stubs
- `backend/src/modules/secondhand/*` — fill the stubs
- `frontend/src/pages/BuyerOrdersPage.jsx` — add return button per order
- `frontend/src/App.jsx` — register the new routes

**Estimated time:** ~6 hours total (3h backend, 3h frontend).

---

## Risk Register

| Risk | Mitigation |
|---|---|
| Phase 2 teammate changes `triggerGrading` signature | We pinned the signature in this doc; communicate it before they start. |
| Phase 3 teammate changes `getTrustProfile` signature | Same — pinned. |
| Two streams both add code to `server.js` | We only touch the routes section, additive. Easy to resolve. |
| Frontend nav component conflicts | Audit `frontend/src/components/Header.jsx` (or equivalent) — minimal addition, just one nav link. |
| `Item` schema needs to evolve | We design forward-references as nullable so later phases can populate without migrations. |
