# Phase 4 — Smart Routing & Disposition Engine — DETAILED Implementation Guide

> Build-level reference for Phase 4. Companion to `ImplementationPlan.md` (Phase 4 section)
> and the `ParallelWorkplan.md` Layer 2 entry. Follow this top-to-bottom and Phase 4 is done.
>
> **Status of upstream deps (verified in repo):**
> - P2 Grading — ✅ DONE. `grades` collection populated; Grade JSON carries
>   `grade`, `qualityScore`, `estimatedResalePct`, `routingHint`, `defects`, `confidence`.
> - P3 Trust — ✅ DONE. `trust.service.getTrustProfile(userId)` → `{ tier, score, ... }` | null (frozen).
> - P1 Intake — ✅ DONE. `Item` state machine; `GRADED → ROUTED` transition is allowed;
>   `item.service.transitionStatus()` writes the lifecycle event.
> - P6 Demand — 🔲 STUB. `demand.service.matchDemandForItem()` returns `undefined` today.
>   Phase 4 calls it **defensively** and defaults `demandSignal.count = 0`.

---

## 0. Ground Rules (read before writing a single line)

### Files I OWN and will create/edit
- `backend/src/modules/routing/routing.service.js` (main engine — replace stub)
- `backend/src/modules/routing/routing.controller.js` (replace 501 stubs)
- `backend/src/modules/routing/routing.routes.js` (already wired; minor edits only)
- `backend/src/modules/routing/routing.validation.js` (implement validators)
- `backend/src/modules/routing/routing.scoring.js` (**NEW** — pure scoring math, no DB)
- `backend/src/modules/routing/routing.config.js` (**NEW** — carrier rates, category weights, warehouses, factor tables)
- `backend/src/modules/routing/__tests__/routing.scoring.test.js` (**NEW** — unit tests)
- `backend/seed-routing.js` (**NEW** — additive demo seed, mirrors `seed-trust.js`)
- `frontend/src/components/routing/RoutingRationale.jsx` (**NEW** — the horizontal rationale bars)
- `frontend/src/services/routing.js` (**NEW** — thin API client)

### Files I MUST NOT touch (teammates / frozen)
- `backend/src/contracts/routingDecision.contract.js` — **FROZEN.** The contract is correct; append-only if ever unavoidable.
- `backend/src/modules/grading/**` and the `grades` collection — **READ ONLY** (P2).
- `backend/src/modules/trust/**` — **READ ONLY** (P3). Call `getTrustProfile` only.
- `backend/src/modules/items/**` — call `transitionStatus`/`getItemById` only; do not edit.
- `backend/src/modules/demand/**` — **READ ONLY** (P6 owns it). Call `matchDemandForItem` defensively.
- `backend/server.js` — route already registered at `/api/routing`. No edit needed.
- `backend/seed.js`, `backend/seed-trust.js` — never edit. I add `seed-routing.js`.
- `ml-service/**` — **owned by the Phase 7 teammate this sprint.** Do not touch (see §11).

### The two frozen interfaces Phase 4 must honour
1. **Service entrypoint (consumed by P5/P8 later):**
   `routing.service.computeRoutingDecision(itemId)` → persisted `RoutingDecision` doc.
   (Internally it resolves gradeId + trustProfileId; callers only pass `itemId`.)
2. **Lifecycle boundary:** Phase 4 emits the `ROUTED` event **only** via
   `item.service.transitionStatus(itemId, 'ROUTED', actor, data)`. It never writes the
   lifecycle/healthCard collections directly.

### Writes
Phase 4 writes ONLY to the `routingDecisions` collection (+ the `Item.status`/`routingDecisionId`
transition, which goes through `item.service`, the owner of that write).

---

## 1. Architecture of the Routing Module

```
                          ┌──────────────────────────────────┐
  P5 / P8 / ops ─────────►│ routing.service.js                │
  (computeRoutingDecision)│  • computeRoutingDecision(itemId) │
                          │  • getDecisionByItemId(itemId)    │
  HTTP (Express) ────────►│  reads: Grade, TrustProfile, Item │──► reads demand.service
  routing.routes.js       │  reads: routing.config            │     (defensive, may be stub)
       │                  └──────────────────┬────────────────┘
       │                                     │ calls (pure, no DB, deterministic)
       │                                     ▼
       │                  ┌──────────────────────────────────┐
       │                  │ routing.scoring.js                │
       │                  │  • reverseLogisticsCost()         │
       │                  │  • scorePaths()                   │
       │                  │  • applyHardGates()               │
       │                  │  • rankAndChoose()                │
       │                  └──────────────────────────────────┘
       │
       ▼ emits ROUTED via item.service.transitionStatus()  (Phase 1 owns the writer)
```

**Design principle: the decision is 100% deterministic and explainable.**
Same inputs → same routing decision → same ranked bars, every demo run. No ML model,
no randomness, no network dependency in the scoring path. This is deliberate (see §10).

---

## 2. Inputs the Engine Gathers (all already in the DB)

| Input | Source | Field(s) used |
|---|---|---|
| Grade | `grades` (P2) | `grade` (A–D), `estimatedResalePct`, `routingHint`, `defects[]`, `confidence`, `flaggedForReview` |
| Trust | `trust.service.getTrustProfile(userId)` (P3) | `tier`, `score` |
| Item context | `items` (P1) | `intakePath`, `category`, `originalProductId`, `initiatorUserId`, `status` |
| Original price | `products` (populated via `item.originalProductId`) | `price` |
| Demand signal | `demand.service.matchDemandForItem()` (P6, defensive) | `{ count, radiusKm }` → defaults `{0, 0}` |
| Cost factors | `routing.config.js` (NEW, seeded constants) | category weight, carrier ₹/km/kg, warehouse coords, depreciation |

> **Data gap note (important):** there is currently **no warehouse model, no item weight,
> and no user/order geo-coordinate** in the repo. Phase 4 fills this gap *self-containedly*
> in `routing.config.js` (a seeded constants table) so we touch zero teammate files. See §6.

---

## 3. The Six Candidate Paths (from the frozen contract)

`ROUTING_PATHS = ['resell', 'refurbish', 'donate', 'liquidate', 'return-to-seller', 'peer-redistribute']`

Each path computes a **netRecovery (₹)** and a normalized **score**:

| Path | Expected revenue model | Cost model |
|---|---|---|
| `resell` | `price × estimatedResalePct × demandMultiplier` | reverse-logistics + platform fee |
| `refurbish` | `price × min(estimatedResalePct + REFURB_LIFT, cap)` | reverse-logistics + REFURB_COST (mock partner) |
| `peer-redistribute` | `price × estimatedResalePct × P2P_PREMIUM` (local, low ship) | short-haul logistics only |
| `donate` | `0 revenue + TAX_RECEIPT_VALUE + GREEN_CREDIT_VALUE` | short-haul logistics |
| `liquidate` | `price × LIQUIDATION_RECOVERY` (5–10%) | bulk logistics (cheap) |
| `return-to-seller` | seller credit = `price × estimatedResalePct` (returns path only) | reverse-logistics to seller |

`score = normalize(netRecovery) × conditionFactor[grade] × demandFactor`

- `conditionFactor`: A=1.0, B=0.85, C=0.6, D=0.3
- `demandFactor`: `1 + min(demandCount / DEMAND_SATURATION, DEMAND_CAP)` (boosts resell/p2p only)

---

## 4. Hard Gates (override the score — applied AFTER scoring, BEFORE choosing)

Layered in this order; the first match short-circuits the chosen path and records the gate
name in `hardGatesApplied[]`:

1. **Hygiene/hazard category** (`innerwear`, `food`, `opened-cosmetics`, `hazardous`)
   → force `donate` if Grade ≥ C else `liquidate`. Gate: `HYGIENE_SENSITIVE` / `HAZARDOUS_MATERIAL`.
2. **Counterfeit / hard fraud** (grade `status === 'fraud_rejected'` or a counterfeit defect)
   → force `liquidate`. Gate: `COUNTERFEIT_DETECTED`.
3. **Grade D + no demand** → force `donate`. Gate: `GRADE_D_NO_DEMAND`.
4. **Trust tier `restricted` (repeat offender)** → on returns path force `return-to-seller`;
   disable any auto-refund branch. Gate: `RESTRICTED_USER_REPEAT_OFFENDER`.
5. **Intake-path gates:**
   - `return-to-seller` is a candidate **only** when `intakePath === 'return'`.
   - `peer-redistribute` "hold for wider radius" is allowed **only** for `intakePath === 'sell-used'`.

> The first four gate keys already exist in `routingDecision.contract.js → HARD_GATES`.
> `HYGIENE_SENSITIVE` is new; add it locally in `routing.config.js` (NOT in the frozen contract)
> and merge with the contract's map at runtime.

---

## 5. Scoring Math (pure functions in `routing.scoring.js`)

```
reverseLogisticsCost(distanceKm, weightKg) =
    BASE_PICKUP_FEE + distanceKm * PER_KM_RATE * weightBracketMultiplier(weightKg)

netRecovery(path) = expectedRevenue(path) - expectedCost(path)

score(path) = clamp01(netRecovery / price)        // normalized 0..1
              * conditionFactor[grade]
              * demandFactor(demandCount)          // resell & p2p only; else 1.0

chosenPath = path with max score, unless a hard gate overrides
```

**Constants (live in `routing.config.js`, all tunable / seeded):**

```
BASE_PICKUP_FEE        = 40      // ₹
PER_KM_RATE            = 1.5     // ₹ per km per weight-bracket unit
weightBracketMultiplier: <0.5kg→1, <2kg→1.5, <5kg→2.2, else→3.0
REFURB_LIFT            = 0.20    // resale_pct uplift after refurb
REFURB_COST            = 0.15 * price
LIQUIDATION_RECOVERY   = 0.08
P2P_PREMIUM            = 1.10
TAX_RECEIPT_VALUE      = 0.30 * price   // notional value to the donor
GREEN_CREDIT_VALUE     = small flat ₹ (ties to P8; safe placeholder = 25)
DEMAND_SATURATION      = 10
DEMAND_CAP             = 0.5
conditionFactor        = { A:1.0, B:0.85, C:0.6, D:0.3 }
```

---

## 6. `routing.config.js` — the self-contained data layer (NEW)

Because the repo has no warehouse/weight/geo data, Phase 4 ships its own seeded constants
so it stays decoupled from teammate work:

```
WAREHOUSES = [ { code, city, location:{lng,lat} }, ... ]   // 3–4 demo warehouses
CATEGORY_WEIGHTS_KG = { clothing:0.4, footwear:0.9, electronics:1.5, furniture:12, books:0.6, ... }
CARRIER = { BASE_PICKUP_FEE, PER_KM_RATE, weightBrackets }
CATEGORY_DEPRECIATION = { electronics:0.85, clothing:0.6, footwear:0.55, ... }
HYGIENE_SENSITIVE_CATEGORIES = ['innerwear','food','opened-cosmetics']
```

**Distance derivation (hackathon-honest):** since users have no stored coordinates, derive
`distanceKm` deterministically:
1. If the item/seed carries a demo city → distance = haversine(city, nearest warehouse).
2. Else → `DEFAULT_DISTANCE_KM = 12` (a sane urban default; documented as an estimate).

`haversine(a, b)` lives in `routing.scoring.js` (pure, ~10 lines).

---

## 7. `routing.service.js` — orchestration (replace the stub)

```
computeRoutingDecision(itemId):
  1. item = item.service.getItemById(itemId)        // READ
     - guard: must exist; status should be GRADED (or already ROUTED → return existing)
  2. grade = grading.service.getGradeByItemId(itemId) // READ (P2)
     - guard: if grade.flaggedForReview → throw 409 "awaiting human review" (no auto-route)
  3. trust = trust.service.getTrustProfile(item.initiatorUserId)  // READ (P3), null-safe
  4. product = populated via item.originalProductId   // price, category
  5. demand = await safeMatchDemand(category, location) // defensive wrapper, default {count:0,radiusKm:0}
  6. inputs = assemble { grade, trust, intakePath, price, category, demand, distanceKm, weightKg }
  7. result = routing.scoring.decide(inputs)           // pure → { chosenPath, rankedAlternatives, hardGatesApplied, reverseLogisticsCost }
  8. doc = RoutingDecision.findOneAndUpdate({itemId}, {...result, gradeId, trustProfileId, demandSignal}, {upsert,new})
  9. item.service.transitionStatus(itemId, 'ROUTED', {role:'system'}, { routingDecisionId: doc._id, chosenPath })
     - wrap in try/catch: if item not in GRADED state, log + still return doc (idempotent re-route)
  10. return doc

getDecisionByItemId(itemId): RoutingDecision.findOne({itemId}).lean()

safeMatchDemand(category, location):
  try { const r = await demand.service.matchDemandForItem(category, location);
        return r && typeof r.count === 'number' ? r : { count:0, radiusKm:0 }; }
  catch { return { count:0, radiusKm:0 }; }
```

**Upsert keyed by `itemId`** → exactly one decision per item; re-running is idempotent (mirrors
the grading module's pattern).

---

## 8. HTTP API (controller + routes + validation)

| Method | Path | Body / Param | Returns |
|---|---|---|---|
| `GET`  | `/api/routing/health` | — | `{ module:'routing', status:'ok' }` |
| `POST` | `/api/routing/compute` | `{ itemId }` | `201` `{ success, decision }` |
| `GET`  | `/api/routing/:itemId` | `itemId` | `200` `{ success, decision }` or `404` |

**Validation (`routing.validation.js`):**
- `validateComputeRouting`: `itemId` present + valid ObjectId → else `400`.
- `getDecision`: validate `:itemId` ObjectId → else `400`.

**Auth:** gate `POST /compute` behind `authMiddleware` (seller/admin/system). `GET /:itemId`
readable by the item owner or admin (mirror the grading controller's role check).

**Error contract:**
- `404` item/grade not found
- `409` grade flagged for review (no auto-route)
- `422` item not in a routable state
- `502/503` only if a future hard dependency fails (demand is soft, never errors)

---

## 9. Frontend — Live Rationale UI (the demo's biggest "wow")

**`RoutingRationale.jsx`** — given a decision object, render six horizontal bars:
- Each bar: path label + `₹ netRecovery` + width proportional to `score`.
- Winning path (`chosenPath`) highlighted with an accent + one-line `rationale`.
- Hard-gated decisions show a badge: "Forced by: HYGIENE_SENSITIVE" etc.
- Demand-boosted resell shows "📍 N buyers within Rkm".

**Where it mounts:** on `ItemStatusPage.jsx` once `item.status === 'ROUTED'` (read-only render;
do NOT modify the page's data-fetching logic beyond adding the component + a `routing.js` fetch).

**`services/routing.js`:** `getDecision(itemId)` → `GET /api/routing/:itemId`;
`computeRouting(itemId)` → `POST /api/routing/compute`.

> Frontend stays additive: one new component, one new service file, one import into
> `ItemStatusPage`. No router changes required (the page route already exists).

---

## 10. Tech / Model Assessment (per the build brief)

**Question asked: is rule-based weighted scoring the best approach, or is there a better model?**

**Verdict: keep the deterministic rule-based engine. It is the correct choice here.** Reasons:
- **Explainability is the product.** The headline demo moment is *live rationale bars with ₹
  values*. A rule-based score is transparent and reproducible; an ML/RL model would be a
  black box that undermines the exact thing we're showing off.
- **No training data.** There is no historical disposition-outcome dataset to train an
  optimizer/RL policy on. A learned model would be guessing.
- **Determinism = safe demo.** Same item → same bars every run. Critical for a scripted pitch.
- **Latency & cost.** Pure functions return in <1ms with zero network calls.

**One optional enhancement (NOT a core change) — flagged for your decision:**
Use the **already-wired Bedrock / Nova Pro** (in `ml-service`) to generate the *plain-English
narration* of the winning rationale — the decision stays 100% deterministic; the LLM only
prettifies the `rationale` string. The Implementation Plan lists this as optional ("one extra
Bedrock call to narrate why"). I have **not** added it. It would touch `ml-service` (Phase 7
teammate's territory this sprint), so I'd want explicit sign-off first.

**No other tech swap recommended.** Haversine distance, weight-bracket carrier pricing, and
the weighted-sum scorer are all standard, sufficient, and dependency-free.

---

## 11. Merge-Conflict Avoidance (teammate is on Phase 7, another branch)

Phase 7 (return-probability + fit) touches: `ml-service/app/routers/prediction.py`, fit code,
the frontend **PDP/checkout** surfaces, and *reads* `trust.service.detectBracketing`.

Phase 4 touches: `backend/src/modules/routing/**` (isolated), a new `seed-routing.js`, and the
frontend **`ItemStatusPage` + new routing component** (return flow, not the PDP/checkout).

**Overlap = effectively zero.** Guardrails to keep it that way:
- Do **not** touch `ml-service/**` (defer the optional LLM narration until §10 is approved).
- Do **not** edit `server.js` (route already registered) or `App.jsx` router (status route exists).
- Keep all new constants in `routing.config.js`, not in shared contracts.
- New seed file is additive and idempotent (tags emails `p4demo+*`), never edits `seed.js`.
- Only `ItemStatusPage.jsx` is a shared-ish frontend file; the change is purely additive
  (one import + one `<RoutingRationale />` mount), trivial to resolve if it ever collides.

---

## 12. Seed (`seed-routing.js`, additive — mirrors `seed-trust.js`)

Idempotent demo data that always produces the same routing bars:
- Reuse / create demo items spanning the personas:
  - **Priya** — ₹500 footwear, Grade C, worn soles, no demand → expect **donate** (uneconomical resell).
  - **Rahul** — baby monitor (electronics), Grade B, high local demand → expect **resell/peer-redistribute**.
  - **Anjali** — DSLR, Grade A, high city demand → expect **resell** (top recovery).
  - **Hygiene case** — innerwear Grade B → expect **donate** via `HYGIENE_SENSITIVE` gate.
  - **Counterfeit case** — fraud_rejected grade → expect **liquidate** via `COUNTERFEIT_DETECTED`.
- Run `computeRoutingDecision` for each and print a decision table (path + ₹ recovery + gate).

---

## 13. Test Matrix (`routing.scoring.test.js` — pure, no DB)

| # | Scenario | Expect |
|---|---|---|
| 1 | Grade A, high resale %, high demand | chosen=`resell`, top netRecovery |
| 2 | Grade C, low resale, zero demand, cheap item, far warehouse | chosen=`donate` (resell uneconomical) |
| 3 | Grade D, no demand | chosen=`donate`, gate `GRADE_D_NO_DEMAND` |
| 4 | Hygiene category, Grade B | chosen=`donate`, gate `HYGIENE_SENSITIVE` |
| 5 | fraud_rejected grade | chosen=`liquidate`, gate `COUNTERFEIT_DETECTED` |
| 6 | Restricted tier + returns path | chosen=`return-to-seller`, gate `RESTRICTED_USER_REPEAT_OFFENDER` |
| 7 | sell-used path | `return-to-seller` absent from candidates |
| 8 | returns path | `return-to-seller` present |
| 9 | reverseLogisticsCost monotonic in distance & weight | cost increases |
| 10 | determinism | same inputs → identical output object |

Run: `npm test` (Jest is already used — see `grading.validation.test.js`).

---

## 14. Definition of Done

- `POST /api/routing/compute { itemId }` returns a ranked 6-path decision with ₹ recovery,
  a clear winner, and any hard gates applied — for every seeded persona.
- `GET /api/routing/:itemId` returns the persisted decision.
- `Item` transitions `GRADED → ROUTED` and a `ROUTED` lifecycle event is written (via P1's writer).
- `ItemStatusPage` renders the rationale bars for a routed item.
- `routing.scoring.test.js` passes (all 10 cases).
- `seed-routing.js` prints the expected decision table on a fresh DB.
- Zero edits to grading/trust/items/demand/ml-service/contracts.

---

## 15. Build Order (suggested, ~half a day solo)

1. `routing.config.js` (constants) → `routing.scoring.js` (pure math) → unit tests. **Test-first; no DB needed.**
2. `routing.service.js` (orchestration, defensive demand wrapper).
3. `routing.validation.js` + `routing.controller.js` (wire HTTP).
4. `seed-routing.js` → run → eyeball the decision table.
5. Frontend `routing.js` service + `RoutingRationale.jsx` → mount on `ItemStatusPage`.
6. Full pass: seed → compute → GET → render. Clean up temp artefacts.
