# Phase 8 — Logistics Wiring, Warehouse-Demand Populator & Seller Returns Dashboard

> **Status:** Plan (not yet implemented).
> **Audience:** Whoever picks up the "wire the combined phase to everything else" task.
> **Prerequisite phases (already built by the team):** P1 Dual Intake, P2 AI Grading,
> P3 Trust, P3.5 Integration, the Combined Routing/Demand/Resale phase (see
> `Combined-Routing-Resale-Plan.md`), and P7 Prevention.
> **Source of truth = code.** This plan was written after reading the live modules
> (`routing/`, `demand/`, `resale/`, `items/`) and follows them where docs and code diverge.

---

## 0. What this phase delivers (in one breath)

Three things, all small, all prototype-scale:

1. **A warehouse-demand populator** — a tiny, hand-curated dataset of *demand per
   product-type per Chhattisgarh city/warehouse*, so the "best warehouse" routing
   maths runs on real-looking signal **without** storing thousands of buyer posts.
2. **Full wiring of the combined Routing/Demand/Resale phase to the rest of the
   pipeline** — grading now auto-flows into routing, routing reads the demand
   populator, and a returned package gets an **emulated delivery journey** (discrete,
   time-derived stages — *no map, no moving dot, no live tracking UI*).
3. **A minimal seller "Returns" dashboard tab** — once a return is picked up from the
   customer's house, the **original seller of that product** sees live-ish stats:
   original price, cost spent so far, projected/realised loss, and a plain-English
   logistics status line ("Transporting to Raipur Central Hub" / "Handing off to a
   nearby buyer").

### 0.1 Explicit non-goals (the user asked for these to NOT exist)

- ❌ No live map, no Leaflet, no SVG map, no moving marker, no route polyline.
- ❌ No real-time GPS / courier tracking. "Real-time" here = a stats panel that a
  seller page **polls every few seconds** while a purely time-derived emulation advances.
- ❌ **Nothing added to the admin dashboard.** The existing `DemandMapPage` stays as-is
  or can be ignored; this phase does not touch admin surfaces.
- ❌ No new managed services, no background worker/cron, no GPU. Everything is derived
  on read from a single timestamp.

---

## 1. Current state — what's built and the gaps (verified against code)

### 1.1 What already works
- `routing.scoring.js` / `routing.warehouse.js` — pure, tested disposition brain +
  "best warehouse, not nearest" selection. Consumes `demandByWarehouse: { [code]: 0-100 }`.
- `routing.config.js` — 7 seeded Chhattisgarh warehouses (Raipur, Bhilai, Bilaspur,
  Korba, Durg, Raigarh, Jagdalpur) with coords/capacity/categories.
- `routing.service.computeRoutingDecision(itemId)` — gathers grade + trust + demand,
  decides, picks warehouse, persists a `RoutingDecision`, walks `GRADED → ROUTED`,
  and hands off to resale via `safeCreateResaleDraft`.
- `demand.service` — Want posts, `matchDemandForItem`, and `demandByWarehouse(term)`
  (currently **counts Want posts** near each warehouse).
- `resale.service` — `createDraftFromRouting` (DRAFT listing), `publish` (walks
  `ROUTED → IN_TRANSIT → LISTED`, mirrors a Product), seller listing queries.
- `SellerDashboard.jsx` — already imports resale service fns and renders resale
  listings + a prevention `ReturnInsightsPanel`. Easy to add one more tab.

### 1.2 The three gaps this phase closes

| # | Gap | Evidence in code |
|---|---|---|
| **G1** | **Grading never auto-triggers routing.** The item stops at `GRADED`; routing only fires from the UI "Run routing engine" button or `POST /api/routing/compute`. | `item.service.markGraded` ends at `GRADED` + logs "Ready for routing"; no call to `routingService`. |
| **G2** | **Demand is computed by counting buyer Want posts**, which is the storage-heavy thing the user wants gone. | `demand.service.demandByWarehouse(term)` runs a `$geoWithin` count of `Want` docs per warehouse. |
| **G3** | **No logistics/shipment concept at all.** Nothing marks "picked up from the customer's house", nothing emulates the journey, and the original seller has no view of it. | State machine has `IN_TRANSIT` but only `resale.publish` ever sets it; no shipment fields anywhere; no seller-returns endpoint. |

---

## 2. Part A — The Warehouse-Demand Populator

### 2.1 The idea, restated simply
We want a **dead-simple lookup table**: for each warehouse (one per major Chhattisgarh
city), how much demand exists there for each **product type** (shoe, clothes, laptop,
phone, chair, …). That's it. No per-user posts, no geo math at query time, no thousands
of rows.

Scale: **7 warehouses × ~8–10 product types ≈ 70 numbers.** Negligible storage.

### 2.2 Where the demand lives — recommended design

**Embed the demand on the `Warehouse` document** (no new collection). Add two fields:

```
Warehouse {
  code, name, city, location, capacity, categories,   // existing
  // NEW — the populator writes these:
  demandByType: {            // product-type → demand 0-100
    shoe: 82, clothes: 60, laptop: 25, phone: 40, chair: 15, ...
  },
  topSearches: [             // honours the user's "top searches per area" idea
    { term: 'shoe', score: 82 },
    { term: 'phone', score: 40 }, ...
  ],
  demandUpdatedAt: Date
}
```

Why embed rather than a separate `WarehouseDemand` collection:
- One read gets a warehouse and all its demand. No join, no aggregation.
- The whole dataset is ~7 small docs.
- The routing code already loads warehouses; it gets demand for free.

> If a separate collection is preferred for cleanliness, use
> `warehouseDemand { warehouseCode, productType, score }` (~70 docs) — the plan works
> the same way. Recommendation: **embed**, for the prototype.

### 2.3 Product-type → category bridge
Routing keys demand by **category** (`Electronics`, `Clothing`, `Sports`, …) but humans
think in **product types** (shoe, laptop, jacket). Keep a tiny static map in the
populator so a "shoe" demand can answer a `Sports`/`Footwear` routing query:

```
TYPE_TO_CATEGORY = {
  shoe: 'Sports', sneakers: 'Sports', cricket bat: 'Sports',
  clothes: 'Clothing', jacket: 'Clothing', tshirt: 'Clothing',
  laptop: 'Electronics', phone: 'Electronics', headphones: 'Electronics',
  chair: 'Home & Garden', table: 'Home & Garden', washing machine: 'Home & Garden',
  textbook: 'Books', ...
}
```

The populator writes **both** the per-type numbers (for the seller-facing/topSearches
flavour) **and** a rolled-up `demandByCategory` (max or mean of the types in that
category) so routing can read one number per category directly.

### 2.4 How we generate the numbers (deterministic city archetypes)
No randomness that changes between runs. Give each city a **demand archetype** reflecting
its real economic character, then derive type scores from it with small fixed offsets:

| City / Warehouse | Archetype | High-demand types (example) |
|---|---|---|
| Raipur (RAIPUR-01) | Capital metro | phone, laptop, clothes, shoe |
| Bhilai (BHILAI-01) | Steel/industrial | automotive, chair/table, washing machine |
| Bilaspur (BILASPUR-01) | Education + retail | textbook, clothes, shoe |
| Korba (KORBA-01) | Power/industrial town | electronics, washing machine |
| Durg (DURG-01) | Twin-city, sports | shoe, cricket bat, toys |
| Raigarh (RAIGARH-01) | Industrial fringe | home & garden, chair |
| Jagdalpur (JAGDALPUR-01) | Smaller/regional | clothes, textbook (lower overall) |

Each archetype is a hard-coded object `{ type: score }`. The populator just upserts it.
This is curated, explainable, and stable across demos (judges see the same map every time).

### 2.5 The populator script
`backend/seed-warehouse-demand.js` (npm script `seed:warehouse-demand`):
- Idempotent upsert by `code` (same pattern as `seed-demand.js`).
- For each warehouse in `routing.config.WAREHOUSES`, write `demandByType`, derived
  `demandByCategory`, `topSearches` (sorted desc), and `demandUpdatedAt`.
- Print a small table to the console for a sanity check.
- Standalone — does **not** require any Want posts to exist.

> The existing `seed-demand.js` (Want posts) can stay for the peer-buyer matching
> demo, but the **warehouse-selection demand no longer depends on it.**

---

## 3. Part B — Wiring everything up

### 3.1 B1 — Auto-trigger routing after grading (closes G1)
In `item.service.markGraded`, after the item is set to `GRADED` and the
`FLOW_COMPLETE` log is written, **fire-and-forget** a routing call:

```
// pseudo, inside markGraded after status = GRADED
if (!isRejected && !grade.flaggedForReview) {
  const routingService = require('../routing/routing.service');
  routingService.computeRoutingDecision(String(itemId))
    .catch(err => ItemLogger.log(itemId, 'ROUTING_ERROR',
      `⚠️ Auto-routing failed (non-blocking) — ${err.message}`, { level: 'warn' }));
}
```

Rules:
- **Fire-and-forget**, never blocks/needs awaiting (mirrors how grading is triggered
  from `attachEvidence`).
- **Fail-open**: a routing error just logs to the dev sidebar; the item stays `GRADED`
  and the manual "Run routing engine" button still works as a fallback.
- Skip when `flaggedForReview` (human review) or `REJECTED` (fraud).
- `computeRoutingDecision` is already idempotent (upsert by `itemId`), so a later manual
  recompute is safe.

Result: a real return now flows **INITIATED → … → GRADED → ROUTED automatically**, and
the `RoutingRationale` panel on `ItemStatusPage` populates without a manual click.

### 3.2 B2 — Routing reads the demand populator (closes G2)
Rewrite `demand.service.demandByWarehouse` to read the embedded warehouse demand instead
of counting Want posts:

```
demandByWarehouse(term) →
  load warehouses
  resolve term → category via TYPE_TO_CATEGORY (term may be a category already)
  for each warehouse: score = warehouse.demandByCategory[category] ?? warehouse.demandByType[term] ?? 0
  return [{ warehouseCode, demand: score (0-100), raw: score, warehouse }]
```

- Signature and return shape are **unchanged** (`[{ warehouseCode, demand, raw, warehouse }]`),
  so `routing.service.safeDemandByWarehouse` and the admin `DemandMapPage` keep working
  with zero changes on their side.
- **Fallback**: if a warehouse has no `demandByType` yet (populator not run), fall back
  to the old Want-count path so nothing breaks. (Keep the old function body as
  `demandByWarehouseFromWants` and call it when the table is empty.)
- The routing call in `computeRoutingDecision` already does
  `safeDemandByWarehouse(category)` → feeds `chooseWarehouse({ demandByWarehouse })`.
  No change needed there; it just gets better numbers.

**Peer-buyer "nearby demand count"** (`matchDemandForItem`, used for the
peer-redistribute trigger and the "📍 N buyers within X km" line) **stays on Want posts**
— that's a genuinely geo/peer signal and the existing `seed-demand.js` covers it. The
populator only replaces the *warehouse-selection* demand. (Document this split clearly so
nobody thinks the two demand signals are the same thing.)

### 3.3 B3 — Surface the routing decision on the status payload (small fix)
`item.service.getItemStatus` returns `routingDecision: null  // populated in P4`. Populate
it for completeness (the seller dashboard and status page can then read one payload):

```
const routingService = require('../routing/routing.service');
routingDecision = await routingService.getDecisionByItemId(itemId).catch(() => null);
```
Defensive/optional; the `RoutingRationale` component already fetches it separately, so
this is a nicety, not a blocker.

### 3.4 B4 — "Pickup from customer's house" → emulated transit (closes G3)
This is the heart of the seller-facing feature. See Part C for the full shipment model.
Wiring summary:
- New action **"mark picked up"** (demo button / endpoint) transitions
  `ROUTED → IN_TRANSIT` and stamps `shipment.startedAt = now`.
- From that timestamp, the journey is **derived on every read** — no worker.
- On arrival (progress ≥ 1):
  - **Resale-class path** → call `resale.service.publish(...)` for that item's draft
    listing (which already walks `IN_TRANSIT → LISTED` and mirrors a Product). The item's
    "second life" goes live automatically.
  - **Peer-redistribute** → mark delivered to the buyer (status line shows handed off;
    optionally flip to `SOLD` for the demo).
  - **Donate / liquidate / return-to-seller** → terminal status line, no listing.

### 3.5 B5 — Keep resale publish aligned
`resale.publish` already handles `ROUTED → IN_TRANSIT → LISTED` defensively (it checks the
current status). Because B4 may have already moved the item to `IN_TRANSIT`, publish will
simply do the `IN_TRANSIT → LISTED` leg. No conflict; just confirm the guard order.

---

## 4. Part C — The emulated shipment / logistics model

### 4.1 Principle: derive, don't track
We store **one timestamp** and a small static plan, then compute the current stage and
accrued cost from elapsed wall-clock on each read. No background job, no DB writes between
pickup and arrival (except the seller optionally refreshing).

### 4.2 Where it's stored
Add a `shipment` sub-document to the **`RoutingDecision`** (it already owns
`chosenWarehouse`, `matchWindow`, `refundTiming`, and is 1:1 with the item):

```
RoutingDecision.shipment {
  status: 'awaiting_pickup' | 'in_transit' | 'arrived' | 'delivered' | 'cancelled',
  destinationType: 'warehouse' | 'peer' | 'seller' | 'ngo' | 'liquidator',
  destinationLabel: 'Raipur Central Hub (Raipur)' | 'Nearby buyer (≤25 km)' | ...,
  originLabel: "Customer's address (Raipur)",      // we don't have a real address → city of origin
  startedAt: Date | null,
  totalDurationMs: Number,        // demo-scaled, see 4.4
  distanceKm: Number,             // from routing breakdown (inbound) or peer hop
  totalLogisticsCost: Number,     // ₹ — inbound cost (warehouse) or one hop (peer)
  legs: [ { label, atFraction } ] // e.g. Picked up @0, In transit @0.1, Arrived @1
}
```

### 4.3 The legs (status lines the seller sees)
Computed from `progress = clamp((now - startedAt) / totalDurationMs, 0, 1)`:

**Warehouse path**
| Fraction | Status line |
|---|---|
| `0` | "Picked up from customer — awaiting dispatch" |
| `0 < p < 0.15` | "Dispatched — leaving origin" |
| `0.15 ≤ p < 0.95` | "Transporting to {warehouse name} ({city}) — {km} km" |
| `p ≥ 1` | "Arrived at {warehouse name} — listing for resale" |

**Peer path** (peer-redistribute, `matchWindow.active`)
| Fraction | Status line |
|---|---|
| `0` | "Held at customer's home for nearby buyer" |
| `0 < p < 1` | "Handing off to a nearby buyer (≤ {radiusKm} km)" |
| `p ≥ 1` | "Delivered to nearby buyer" |

**Donate / liquidate / return-to-seller** → single static line ("Routed for donation to a
local NGO", etc.); no journey needed, cost = local handling only.

### 4.4 Demo time-scaling
Real cross-city transit is days; a demo can't wait. Use a **compressed clock**:
`totalDurationMs = SHIPMENT_DEMO_SECONDS * 1000` (env-tunable, default **90s**), optionally
nudged by distance so a farther warehouse visibly takes a little longer. The seller page
polls every 3–4s and watches the status line and cost advance over ~1.5 minutes.

### 4.5 Cost accrual
- **Pickup base fee** (`CARRIER.baseFee`, ₹40) charged immediately at `startedAt`.
- **Distance cost** accrues linearly with progress:
  `costSoFar = baseFee + (totalLogisticsCost - baseFee) * progress`.
- `totalLogisticsCost` comes straight from the routing decision:
  - warehouse path → `chosenWarehouse.breakdown.inbound`,
  - peer path → one short hop (`CARRIER.baseFee`, effectively ~flat),
  - else → `reverseLogisticsCost` already on the decision.

### 4.6 Financial model for the original seller (prototype accounting)
Simple, explainable, clearly labelled "estimated":

| Field | Source |
|---|---|
| **Original price** | `Product.price` (original product the return came from). |
| **Refund to customer** | = original price (line total) — money out, shown once picked up. |
| **Logistics cost so far** | `costSoFar` from 4.5 (grows as it moves). |
| **Projected recovery** | resale path → listing `suggestedPrice`/`price`; liquidate → `resaleValue × 0.2`; donate/return-to-seller → 0. |
| **Realised recovery** | 0 until the listing is `SOLD`, then the sale price. |
| **Net so far** | `realisedRecovery − refund − logisticsCostSoFar` (negative = loss). |
| **Projected net** | `projectedRecovery − refund − totalLogisticsCost`. |

> Note in the UI copy that this is a **simplified prototype model** (no taxes, no
> platform commission, no restocking). Enough to tell the loss-recovery story honestly.

### 4.7 New endpoints (routing module — no new module)
Keep it inside `routing/` since shipment is 1:1 with the routing decision:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/routing/:itemId/pickup` | Mark picked up: `ROUTED → IN_TRANSIT`, stamp `shipment.startedAt`, build `legs`/cost. Idempotent. |
| `GET` | `/api/routing/:itemId/shipment` | Return the **derived** shipment state (status line, progress, costSoFar, financials). |
| `GET` | `/api/routing/seller/returns` | List all returns whose **original product seller = req.user**, each with item, decision, derived shipment + financials. Powers the dashboard tab. |

Auth: pickup + seller-returns require auth; seller-returns filters by the authenticated
seller (admin may pass through). Reuse the original-seller resolution already in
`resale.service.resolveSellerId` (extract it to a shared helper, e.g.
`resolveSellerId(item)` exported from resale or a small `sellerResolver` util).

### 4.8 On-arrival completion (derived, lazy)
We avoid a worker by completing **lazily on read**: when `GET /shipment` (or the seller
list) computes `progress ≥ 1` and the shipment is still `in_transit`, it performs the
arrival side-effect once (guarded/idempotent):
- resale path → `resale.service.publish` (→ `LISTED`) and set `shipment.status='arrived'`;
- peer path → `shipment.status='delivered'`.
This keeps "no background job" true while still advancing state. (Acceptable for a
prototype; note it in the code so nobody expects a scheduler.)

---

## 5. Part D — Seller "Returns" dashboard tab (minimal, no map)

### 5.1 Placement
Add one tab to the existing `SellerDashboard.jsx` (it already has tabs for products,
offers, resale listings, and a prevention panel). New tab label: **"Returns"** (icon:
`Package`/`Truck` from lucide, already imported set).

### 5.2 Data
- New service fn in `frontend/src/services/routing.service.js`:
  `getSellerReturns()` → `GET /api/routing/seller/returns`.
- New service fn: `markPickedUp(itemId)` → `POST /api/routing/:itemId/pickup`
  (a demo button labelled **"Mark picked up from customer"** on each awaiting card —
  this stands in for the warehouse scan/courier event).
- The tab **polls** `getSellerReturns()` every 3–4s while open (same pattern as
  `ItemStatusPage`/dev-logs) so the status line + cost update "live-ish".

### 5.3 Each return card (minimal)
```
┌────────────────────────────────────────────────────────┐
│ {product title}              [Status pill: In transit]   │
│ Grade B · Return reason: changed_mind                     │
│                                                            │
│ 🚚 Transporting to Raipur Central Hub (Raipur) — 42 km     │
│ ▓▓▓▓▓▓░░░░░░  55%                                         │
│                                                            │
│ Original price   ₹3,000    Refund paid     ₹3,000         │
│ Cost so far      ₹128      Projected recov. ₹2,100         │
│ Net so far      −₹3,128    Projected net   −₹1,028         │
│                                                            │
│ [ Mark picked up from customer ]   (only before pickup)    │
└────────────────────────────────────────────────────────┘
```
- Plain text + a simple progress bar (reuse the framer-motion bar pattern already in
  `RoutingRationale`/`DemandMapPage`). **No map.**
- Group/sort: awaiting-pickup first, then in-transit, then completed.
- Peer path shows "Handing off to a nearby buyer" instead of a warehouse line.
- Empty state: "No returns for your products yet."

### 5.4 Which seller sees what
- For a **return**, the card appears for the **original product's seller**
  (`Product.sellerId`). That's the person who needs the loss view.
- For a **sell-used** item, the initiator is the seller; this tab is primarily about
  returns, so sell-used items can be excluded here (they already appear under the
  resale-listings tab). Keep scope tight: **Returns tab = items with `intakePath='return'`.**

---

## 6. Files touched / added (summary)

### Backend
| File | Change |
|---|---|
| `backend/src/modules/demand/warehouse.model.js` | **Add** `demandByType`, `demandByCategory`, `topSearches`, `demandUpdatedAt`. |
| `backend/seed-warehouse-demand.js` | **New** populator (curated city archetypes, idempotent upsert). |
| `backend/package.json` | **Add** `seed:warehouse-demand` script. |
| `backend/src/modules/demand/demand.service.js` | **Rewrite** `demandByWarehouse` to read the table (fallback to want-count); add `TYPE_TO_CATEGORY`. |
| `backend/src/modules/items/item.service.js` | **B1**: auto-trigger routing in `markGraded`; **B3**: populate `routingDecision` in `getItemStatus`. |
| `backend/src/modules/routing/routing.model.js` | **Add** `shipment` sub-doc. |
| `backend/src/modules/routing/routing.service.js` | **Add** `markPickup`, `getShipmentState` (derived), `getSellerReturns`; lazy on-arrival publish. |
| `backend/src/modules/routing/routing.controller.js` + `routing.routes.js` | **Add** pickup / shipment / seller-returns endpoints. |
| `backend/src/modules/resale/resale.service.js` | **Export** a shared `resolveSellerId` (or move to a small util) for the seller-returns query. |

### Frontend
| File | Change |
|---|---|
| `frontend/src/services/routing.service.js` | **Add** `getSellerReturns`, `markPickedUp`, `getShipment`. |
| `frontend/src/pages/SellerDashboard.jsx` | **Add** "Returns" tab + polling + return cards. |
| `frontend/src/components/routing/SellerReturnCard.jsx` | **New** minimal card (status line, progress bar, financials). |

### Docs
| File | Change |
|---|---|
| `Meta/Solutions/UnifiedTechnicalDocumentation.md` | Update §14 TODO register (G1/G2/G3 resolved), §8 demand note, add shipment to the data flow. |

---

## 7. Data model changes (precise)

```
// warehouse.model.js — additive, all optional/defaulted (no migration needed)
demandByType:     { type: Map, of: Number, default: {} },   // or Mixed object
demandByCategory: { type: Map, of: Number, default: {} },
topSearches:      [{ term: String, score: Number }],
demandUpdatedAt:  { type: Date, default: null },

// routing.model.js — additive shipment sub-doc
shipment: {
  status:          { type: String, enum: ['awaiting_pickup','in_transit','arrived','delivered','cancelled'], default: 'awaiting_pickup' },
  destinationType: { type: String, default: null },
  destinationLabel:{ type: String, default: null },
  originLabel:     { type: String, default: null },
  startedAt:       { type: Date,   default: null },
  totalDurationMs: { type: Number, default: 0 },
  distanceKm:      { type: Number, default: 0 },
  totalLogisticsCost:{ type: Number, default: 0 },
  legs:            { type: Array,  default: [] },
}
```
All additive and nullable → honours the project's **additive-only across phase
boundaries** rule. No existing field renamed or removed.

---

## 8. Build & run order (for whoever implements)

1. **Warehouse model fields** → run nothing yet.
2. **`seed-warehouse-demand.js`** → `npm run seed:warehouse-demand`. Confirm the console
   table shows sensible per-city numbers.
3. **`demandByWarehouse` rewrite** → re-run `seed-routing.js`; confirm chosen warehouses
   shift toward high-demand cities and decisions still print.
4. **B1 auto-routing** → start a real return end-to-end; confirm `ItemStatusPage` shows a
   routing decision **without** clicking "Run routing engine".
5. **Shipment model + endpoints** → `POST /pickup`, poll `GET /shipment`; watch progress
   and cost advance over ~90s; confirm arrival auto-publishes the resale listing.
6. **Seller dashboard tab** → log in as the demo seller, see the returned item, click
   "Mark picked up", watch the card update.

---

## 9. Edge cases & prototype shortcuts (decided here so nobody re-litigates)

- **No customer address on `Item`.** Origin defaults to the routing `DEFAULT_ORIGIN`
  (Raipur) / seller location; `originLabel` shows the origin city, not a street. Fine for
  the prototype.
- **Pickup before routing.** If `pickup` is called on a non-`ROUTED` item, return `409`
  ("not routed yet"). The dashboard only shows the pickup button when `status === 'ROUTED'`.
- **Refund timing vs loss view.** The seller's "refund paid" line reflects the routing
  `refundTiming` (immediate/on-resolution/on-inspection) — if held, show "Refund pending
  (held until inspection)" and treat it as not-yet-paid in "net so far".
- **Idempotency.** `pickup` is a no-op if already in transit; arrival side-effect is
  guarded by `shipment.status`.
- **Fail-open everywhere.** Auto-routing, demand read, and shipment derivation all degrade
  to safe defaults (item stays put, demand = 0, status = awaiting) rather than throwing.
- **Donate/liquidate/return-to-seller** returns still appear in the seller tab with a
  terminal status line and the correct (often zero) recovery, so the loss story is honest.

---

## 10. Demo narrative this unlocks

A buyer returns a pair of shoes → grading finishes → **routing now fires automatically**,
reads that **Durg has high "shoe" demand** from the populator, and picks the Durg warehouse
over nearer-but-emptier ones. The buyer's status page shows the decision with no clicks.
The **original seller** opens their dashboard's **Returns** tab, clicks "Mark picked up",
and watches a card move from *"Picked up from customer"* → *"Transporting to Durg Junction
Warehouse — 38 km"* → *"Arrived — listing for resale"* over ~90 seconds, with **cost
ticking up and projected loss shrinking** as the item heads toward a high-demand resale
market. No map, no tracking dot — just honest numbers and a plain-English status line.
```


---

## 11. Part E — Peer Transactions (when a nearby buyer already wants it)

> Added after review: the shipment section showed peer **status lines** but never
> explained the actual transaction. This part fills that hole. Everything here is
> prototype-scale and reuses the existing order flow — no new payment rails.

### 11.1 What "peer" actually means here
When an item is graded and routing finds **real nearby demand**, the cheapest, greenest
disposition is to **never send it to a warehouse at all** — hand it straight from the
returning customer's home to a buyer who already posted that they want it. One short hop,
no warehouse leg, fastest second life.

The crucial point the current code already gives us: the demand match is **not an
anonymous count**. `demand.service.matchDemandForItem` returns `posts` — actual `Want`
documents, each with a real `userId` (the buyer) and a location. So a peer decision
already has concrete candidate buyers attached; we just never did anything with them.

### 11.2 The actors in a peer handoff
- **Returner** — the customer who initiated the return; physically holds the item at home
  during the hold-at-home window (`matchWindow`, default 48h, demo-scaled).
- **Peer buyer** — owner of a matched `Want` post nearby.
- **Original seller** — `Product.sellerId`; sees the outcome in the Returns dashboard
  (peer = their best-case recovery).
- **Platform** — mediates money (buyer pays platform → platform refunds returner). Same
  "no real escrow, platform-mediated" assumption used everywhere else.

### 11.3 The flow, end to end
```
routing picks peer-redistribute (demand.count > 0, matchWindow.active)
        │
        ▼
[1] Create PeerOffer docs for the top N matched buyers (status 'offered'),
    all sharing one expiresAt = matchWindow.expiresAt.
    Create the resale listing as usual but keep it OFF the public storefront
    (status DRAFT, peerRedistribute = true) — it's reserved for peers first.
        │
        ▼
[2] Notify those buyers (reuse notifyMatches → in-app flag). Buyer sees them in a
    "Items near you" feed (Looking-For page).
        │
        ▼
[3] First buyer to CLAIM wins (atomic reserve): their offer → 'reserved',
    listing → 'RESERVED' for that buyerId with reservedUntil = now + claimTTL.
    All sibling offers for the same item → 'closed'.
        │
        ├── buyer PAYS before reservedUntil ──────────────────────────────┐
        │        ▼                                                          │
        │   [4] Purchase via existing order flow on the mirror Product.    │
        │       PeerOffer → 'purchased'; listing → 'SOLD';                 │
        │       item walks ROUTED → IN_TRANSIT → LISTED → SOLD;            │
        │       shipment = one-hop handoff (returner → buyer), demo-scaled.│
        │                                                                  │
        └── reservedUntil passes with no payment ─────────────────────────┤
                 ▼                                                          │
            [5a] Reservation lapses → offer 'expired', listing back to     │
                 peer-available; re-notify remaining buyers (if window      │
                 still open).                                               │
                                                                           ▼
[5b] Whole matchWindow expires with no purchase → FALLBACK:
     drop the peer path, pick the best non-peer alternative from the routing
     decision's rankedAlternatives (normally resell-via-best-warehouse),
     publish the listing to the public storefront, and run the normal
     warehouse shipment emulation (Part C). The return still resolves.
```

### 11.4 Reservation & the double-claim race (edge case the docs flagged)
"Double peer-claim → first claim reserves with TTL" is enforced with a single atomic
update, no locks:

```
// claim(offerId, buyerUserId)
const offer = await PeerOffer.findOneAndUpdate(
  { _id: offerId, status: 'offered', expiresAt: { $gt: new Date() } },
  { $set: { status: 'reserved', buyerUserId, reservedAt: new Date(),
            reservedUntil: new Date(Date.now() + CLAIM_TTL_MS) } },
  { new: true }
);
if (!offer) → 409 "Already reserved or expired";   // someone else won the race
// close siblings + flip the listing to RESERVED for this buyer
```
`CLAIM_TTL_MS` (time to pay after claiming) is short and demo-scaled (e.g. 5 min real,
configurable). Distinct from the longer `matchWindow` (how long peers get first dibs at all).

### 11.5 Payment — reuse, don't reinvent
On payment we reuse exactly what `resale.publish` already does: create/keep the **mirror
`Product`** and let the buyer purchase through the **existing order flow**. The only peer
difference is that the mirror Product is **not browsable on the public storefront** while
reserved — the buyer reaches it through the offer (a direct "Buy now" on the offer card).
On successful order:
- `PeerOffer.status = 'purchased'`, `purchasedAt = now`;
- listing `status = 'SOLD'`;
- item state machine `ROUTED → IN_TRANSIT → LISTED → SOLD` (reuses existing transitions; a
  small hook on resale-product order completion flips listing+item to SOLD — same hook the
  normal storefront purchase needs anyway);
- shipment switches to the **one-hop handoff** leg.

### 11.6 Shipment for the peer hop
Same derived-from-one-timestamp model as Part C, just a different, shorter journey:
| Fraction | Status line (seller + buyer) |
|---|---|
| `0` | "Reserved by a nearby buyer — arranging handoff" |
| `0 < p < 1` | "On its way to {buyer area} — ≤ {radiusKm} km" |
| `p ≥ 1` | "Delivered to buyer — peer handoff complete" |

`totalLogisticsCost` for peer = a single short hop (`CARRIER.baseFee` + a few km), which is
why the seller's loss view shows peer as the **best-case** outcome (highest net recovery,
lowest logistics).

### 11.7 Buyer-facing surface (minimal)
- Reuse **`LookingForPage`** (the buyer's "looking for…" page already exists). Add a
  section **"Available near you"** that lists this buyer's active `PeerOffer`s.
- Each offer card: item title, grade + condition lane, photos, peer price, distance,
  expiry countdown, and a **Claim / Buy now** button.
- Claim → reserve → the same button becomes **Pay now** (existing checkout on the mirror
  product). On pay, card flips to "Purchased — on its way".
- No map; just a list with a distance label and a countdown.

### 11.8 Peer pricing
Peer price uses the **same grade × demand formula** (`computeSuggestedPrice`) as a normal
resale listing — optionally a small "direct from owner, skip-the-warehouse" discount
(e.g. −5%) to reflect the lower logistics cost and to make the peer offer attractive. Keep
it one configurable constant (`PEER_DISCOUNT_PCT`, default 0 for v1; turn on if desired).

### 11.9 Trust & refund interaction (don't bypass Phase 3)
- The **returner's** refund timing still follows the routing/trust rules (a low-trust
  returner's refund can still be held until inspection — but for peer there's no warehouse
  inspection, so a low-trust returner should **not** be eligible for peer-redistribute in
  the first place). Add a guard: peer-redistribute requires the returner to be
  `standard`-or-better trust; restricted/watch returners skip peer and go to warehouse
  (where the physical re-grade gate lives). This keeps the anti-"shipped a brick" protection.
- The **peer buyer** is a normal purchaser; standard checkout, no special handling.

### 11.10 New/changed pieces for peer (additive)

**Backend**
| File | Change |
|---|---|
| `backend/src/modules/demand/peerOffer.model.js` | **New** lightweight `PeerOffer` collection (see shape below). |
| `backend/src/contracts/resaleListing.contract.js` | **Add** `'RESERVED'` to `RESALE_STATUSES` (additive). |
| `backend/src/modules/resale/resale.model.js` | **Add** `reservedForUserId`, `reservedUntil` (nullable). Keep `RESERVED` listings out of `getStorefront` (it already filters `status: 'PUBLISHED'`, so reserved is hidden for free). |
| `backend/src/modules/routing/routing.service.js` | On `peer-redistribute`: create `PeerOffer`s for top-N matched posts; add the `standard+` trust guard; on `matchWindow` expiry, fall back to best non-peer alternative. |
| `backend/src/modules/demand/` (peer service or extend demand.service) | `createPeerOffers(item, decision, posts)`, `getOffersForBuyer(userId)`, `claimOffer(offerId, userId)` (atomic), `purchaseOffer(offerId, userId)` (→ order flow), `expireStaleOffers()` (called lazily on read, like the shipment arrival side-effect). |
| `backend/src/modules/.../order completion hook` | On an order for a resale mirror Product, flip listing → `SOLD` and item `LISTED → SOLD` (needed for the storefront path too; peer just reuses it). |

**Frontend**
| File | Change |
|---|---|
| `frontend/src/pages/LookingForPage.jsx` | **Add** "Available near you" section listing the buyer's `PeerOffer`s with Claim/Pay buttons + countdown. |
| `frontend/src/services/demand.service.js` (or new `peer.service.js`) | `getMyPeerOffers`, `claimPeerOffer`, `purchasePeerOffer`. |

**PeerOffer shape**
```
PeerOffer {
  itemId, routingDecisionId, listingId,
  wantId, buyerUserId,           // matched buyer (Want owner)
  returnerUserId, sellerUserId,  // for the seller loss view + handoff
  category, title, images, grade, conditionLane, price,
  distanceKm,
  status: 'offered' | 'reserved' | 'purchased' | 'closed' | 'expired',
  offeredAt, expiresAt,          // expiresAt = matchWindow.expiresAt (first-dibs window)
  reservedAt, reservedUntil,     // reservedUntil = reservedAt + CLAIM_TTL (pay-by)
  purchasedAt, orderId
}
```
Tiny and append-only-ish; a TTL index on `expiresAt` can auto-clean old docs.

### 11.11 Lazy expiry (no scheduler, consistent with the rest of the phase)
Like the shipment arrival side-effect, peer expiry is resolved **on read**: whenever the
buyer offers feed, the seller returns list, or a routing/shipment endpoint runs, call a
guarded `expireStaleOffers()` that (a) lapses reservations past `reservedUntil` and (b)
triggers the §11.3 [5b] warehouse fallback for items whose `matchWindow` has fully expired
with no purchase. Keeps the "no background worker" guarantee true.

### 11.12 Peer in the seller Returns dashboard
The peer case shows up in the same Returns tab (Part D) with peer-flavoured copy:
- Status pill: **Peer handoff**.
- Status line: "Reserved by a nearby buyer" → "On its way to buyer" → "Delivered — peer handoff complete".
- Financials: recovery = peer sale price (realised on purchase), logistics = one hop →
  the smallest loss / best net of any path. Good demo contrast vs the warehouse case.

### 11.13 Updated demo narrative (peer branch)
Rahul's used baby monitor is graded **B**. Routing reads nearby demand and finds **3
parents within 25 km** who posted "looking for a baby monitor" → it picks
**peer-redistribute** instead of a warehouse. Three `PeerOffer`s go out; the first parent
to tap **Claim** reserves it (the other two now see "already reserved"), pays through the
normal checkout, and the seller's Returns card shows **"Delivered — peer handoff complete,
net +₹X"** — the cheapest possible outcome, one short hop, no warehouse. Had no one claimed
within the window, the same item would have quietly fallen back to the best-warehouse
resale path with zero manual intervention.
```