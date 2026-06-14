# Second-Life Disposition & Resale — Consolidated Plan (replaces P4 + P5 + P6)

> **What this doc is.** A revision that folds the old Phase 4 (Smart Routing), Phase 5 (Resale
> Marketplace + Listing) and Phase 6 (Demand Registry) into **one problem** with **two
> parallelizable build phases**. It supersedes `Phase4-SmartRouting-Implementation.md`,
> `Phase4-Updates-Summary.md`, and the P5/P6 sections of `ImplementationPlan.md`.
>
> **Already done (verified in repo):** P0 foundation, P1 dual-intake + Item state machine, P2
> grading (`grades` collection, `getGradeByItemId`, `estimatedResalePct`, `defects`, `rationale`,
> `confidence`, `flaggedForReview`), P3 trust (`getTrustProfile(userId) → { tier, score }`), P3.5
> integration (`markGraded` closes `GRADING → GRADED`), P7 prevention (purchase-side, independent).

---

## 0. Plan Overview — In Plain English (read this first)

> **Goal of this section:** a non-technical logistics teammate should finish it understanding
> exactly where a product goes, for every branch, and which "smart bit" makes each decision.

### The big idea
A product **does not move until we've decided it's worth moving and where to**. Grading happens
from **photos**, so while the AI figures out the item's condition and value, the item is *still
sitting in the customer's house*. That gives us a free window to make a smart decision before
paying for a single kilometre of transport. Every move afterward has to earn its cost.

### The journey of one returned/used item, stage by stage

**Stage 1 — At the customer's house.** They start a return (from an order) or a "sell my used
item" listing and upload photos. Nothing has physically moved.

**Stage 2 — AI grades it (item still at home).** The grading AI gives it a grade (A–D), a quality
score, and an estimated resale value. *Algorithm: the existing P2 vision pipeline (Gemini +
Rekognition).*

**Stage 3 — AI tags it (item still at home).** A language model reads the item and writes a few
short search tags, e.g. *"running shoes, red, size 9"*. *Algorithm: LLM (Gemini), with a plain
keyword fallback if the LLM is unavailable.*

**Stage 4 — We look for a nearby buyer who already wants it.** Buyers can post **"Looking for…"**
ads in the marketplace ("looking for red running shoes, size 9, under ₹2000"). We match the item's
tags against those posts and keep only the buyers who live **nearby**. *Algorithms: tag/text
matching + a geographic radius search (`$geoNear` on a map index).*

**Stage 5 — We decide what happens to the item.** Three questions drive everything:
1. **Is the customer trustworthy?** (from their trust score, P3)
2. **Is it cheap to move the item to a warehouse?** (reverse-logistics cost)
3. **Does someone nearby want it right now?** (Stage 4 result)

### The decision tree (this is the part to show the logistics person)

```
Graded item
   │
   ├─ Is it fake / a banned hygiene item / broken-with-nobody-wanting-it?
   │     └─ YES → DONATE or SCRAP locally. (Never ship. Stop.)
   │
   ├─ Is the customer a known returns-abuser (restricted)?
   │     └─ YES → REJECT: ship back to them, NO refund. (Stop.)
   │
   └─ Otherwise weigh trust + cost + nearby demand:
         │
         ├─ Trusted customer AND cheap to move
         │     → APPROVE + REFUND NOW. Item stays at their home (or a local
         │       pickup point) and we collect it later — often batched with
         │       other items in the same area to save trips.
         │
         ├─ A nearby buyer wants it (Stage 4 found matches)
         │     → HOLD the item at the customer's home for up to 48h and ping
         │       those buyers. 
         │         • A buyer claims it  → PEER HANDOFF: item goes straight
         │                                customer → that buyer. Shortest trip,
         │                                no warehouse at all.
         │         • Nobody claims in 48h → ship to the BEST WAREHOUSE, then list.
         │
         └─ Low-trust customer (but not banned)
               → DO NOT refund yet. Item must go to a warehouse, get physically
                 inspected to confirm the photos were honest, THEN refund.
                 (This catches "photographed a good item, shipped a brick.")
```

### "Best warehouse" is NOT "nearest warehouse"
This is the subtle, important bit. If we always shipped to the closest warehouse, we'd often pay to
move an item *away* from the people who want it, then pay again to ship it back across the region
when it sells. Instead we pick the warehouse that is **cheap to reach AND sits where buyers for
this kind of item actually are** — so it sells fast and the second trip is short. *Algorithm: a
weighted score per warehouse = expected sale value (boosted by nearby demand) minus cost-to-get-there
minus expected cost-to-deliver-to-a-buyer.*

The **Admin Demand Map** makes this visible: search "shoe" and every warehouse on the Chhattisgarh
map lights up with a demand number, so you can *see* why the engine picked the warehouse it did.

### Where the product physically ends up (summary)

| Branch | Physical path |
|---|---|
| Peer handoff | Customer's home → nearby buyer's home (one short hop) |
| Resell via warehouse | Customer's home → best warehouse → buyer's home |
| Refurbish | Customer's home → repair partner → warehouse → buyer's home |
| Low-trust resell | Customer's home → warehouse (inspect) → buyer's home |
| Donate | Customer's home → nearby NGO |
| Liquidate | Customer's home → bulk lot (B2B) |
| Return-to-seller / reject | Customer's home → original seller (no resale) |

### Which algorithm does which job (one-glance table)

| Decision / job | Technique used | Plain reason |
|---|---|---|
| Grade item from photos | P2 AI vision pipeline (Gemini + Rekognition) | Objective condition + resale value |
| Turn an item into search tags | **LLM (Gemini)**, keyword fallback | So we can match it to buyer posts |
| Match item to buyer "Looking for" posts | **Tag/text match** | Find who wants this exact thing |
| Keep only nearby buyers / warehouses | **`$geoNear` geo-index** | Distance is the whole point |
| Pick the disposition path (resell/donate/…) | **Deterministic weighted scorecard** | Explainable, same input → same answer |
| Pick the best warehouse | **Weighted net-recovery score (cost vs demand)** | Sell fast, ship short |
| Distance & shipping cost | **Haversine + weight-bracket formula** | Cheap, no external API |
| Refund now vs hold for inspection | **Trust score (P3) + cost threshold** | Trust the loyal, check the risky |
| How long to hold at the customer's home | **Trust tier + item durability** | Free storage, but the item ages |

> **Honest note for the team:** the *decisions* are real algorithms running on real (small, seeded)
> data. The *physical movements* (pickups, warehouse intake, courier legs, the 48h timer) are
> **simulated** as state changes and events — we are demonstrating the brain, not integrating trucks.

---

## 1. The One Problem

Once an item is **graded**, three questions remain, and they're really one:
**where does it go, who nearby wants it, and how does it become a trustworthy purchasable listing?**
Demand is an input to the routing score *and* the trigger for peer handoff; routing's `resell`
decision is the only thing that creates a listing; the grade drives the math, the price, and the
listing's condition story. One pipeline:

```
GRADED ─► tag (LLM) ─► match nearby buyer posts (geo) ─► ROUTING DECISION ─► chosenPath
                                                              │
   ┌──────────────────────────────────────────────────────────┤
   ├─ peer-redistribute → customer → nearby buyer (handoff)
   ├─ resell / refurbish → BEST WAREHOUSE (cost×demand) → Resale Listing → storefront
   ├─ donate → nearby NGO            ├─ liquidate → B2B lot
   └─ return-to-seller → refund flow (+ trust refund-hold)
```

---

## 2. Feature List

### 2A. Routing & Disposition (the brain)
- Deterministic **6-path scoring engine** (`resell`, `refurbish`, `donate`, `liquidate`,
  `return-to-seller`, `peer-redistribute`); grade-driven economics; reverse-logistics cost.
- **Hard gates** override the math (counterfeit → liquidate, Grade-D+no-demand → donate,
  hygiene → donate/liquidate, restricted-user-returns → return-to-seller).
- **Refund-timing decision** (NEW): trusted + cheap-to-move → **refund immediately**; standard →
  refund on resolution; low-trust → **refund held until warehouse inspection** (your instruction).
- **Hold-at-home matching window** (NEW): instead of shipping straight to a warehouse, hold the
  item at the customer's home for up to `MATCH_WINDOW_HOURS` (default 48) and try a peer match
  first; ship only on timeout. Free storage; enables pickup batching.
- **Best-warehouse selection** (NEW): choose the warehouse that maximizes net recovery
  (`resale value × nearby-demand − inbound cost − expected outbound cost − holding cost`), not the
  nearest one.
- Ranked rationale output + **live rationale UI** (six ₹-labelled bars, winner, gate badge,
  refund-hold notice, "📍 N buyers within R km").

### 2B. Demand Registry + Buyer "Looking For" Posts (the geo layer)
- **Buyer "Looking for…" posts** (NEW): a buyer publishes a free-text want ("looking for red
  running shoes size 9 under ₹2000") with their location; stored with category + LLM-extracted tags
  + a `2dsphere` location.
- **LLM tagging of incoming items** (NEW): when a return/sell is graded, an LLM turns the item into
  search tags; deterministic keyword fallback if the LLM is down.
- **Tag + geo matching**: match item tags against nearby posts (`$geoNear`); feeds the routing
  demand signal and the peer-handoff trigger.
- **Notify-on-match (in-app)**: matching nearby buyers get pinged when an item becomes available
  (email/SMS = TODO).

### 2C. Admin Demand Map (NEW — the demo centrepiece)
- A **map of Chhattisgarh** with ~6–8 self-seeded warehouses.
- A **search bar with ~5–10 hardcoded product terms** ("shoe", "washing machine", "office chair",
  "smartphone", …).
- Searching a term overlays a **normalized demand number on each warehouse icon**, computed by the
  real `$geoNear` algorithm over seeded buyer posts/wants near each warehouse.
- Purpose: *visually demonstrate the warehouse-selection + demand algorithms* on small, controlled,
  self-populated data.

### 2D. Resale Marketplace (the storefront)
- Auto-created **`ResaleListing`** (own collection; leaves the existing marketplace untouched) when
  routing picks a resell-class path; DRAFT → PUBLISHED.
- **Grade-driven price** (`originalPrice × estimatedResalePct × demandMultiplier`); **seller can
  override**.
- **Grade-backed product page**: grade, quality score, **the AI reasoning behind the grade**,
  defects, condition lane, and **previous-owner notes**.
- **Previous-owner notes** (NEW): after grading, the returner/seller can add free-text notes that
  surface on the resale page.
- **Deterministic listing copy** from grade + product data (optional single-LLM polish = stretch).
- Resale lane on Home/Search; buyer purchase reuses the existing order flow.

### 2E. Seller Tools
- Seller-dashboard **Resale Listings** tab: grade, condition, demand count, suggested vs current
  price, status; **inline price edit**; publish/unlist.

### 2F. Trust artefact (optional/stretch, kept light)
- **Product Health Card**: SHA-256 hash chain over the item's existing lifecycle events + a QR to a
  public verification page. **KMS/Ed25519 signing = TODO.**

---

## 3. Logistics Edge Cases & How We Handle Them (the "flaws" list)

Thinking through the flow surfaces real problems. Each is handled by a rule or honestly deferred.

| # | Case / flaw | How the plan handles it |
|---|---|---|
| 1 | **Reverse logistics costs more than the item** ("shoes cheaper than the box") | Cost calculator runs first; if cost > recovery → donate/liquidate **locally**, never ship. |
| 2 | **Shipping to nearest warehouse, then far to a buyer = double cost** | Best-warehouse score factors *both* inbound and expected outbound; a farther warehouse near demand can win. |
| 3 | **Photo-graded item is gamed** (good photos, ships a brick) | Low-trust items go to a warehouse for **physical re-grade before refund**; if warehouse grade ≠ photo grade, re-price/adjust refund. |
| 4 | **Two buyers claim the same peer item** | First valid claim **reserves** the item (lock); others see "no longer available." |
| 5 | **Buyer expresses interest but never pays** | Reservation has a short TTL; on expiry the item re-enters routing → warehouse. |
| 6 | **Demand count ≠ guaranteed sales** (notify 50, 1 buys) | Demand is a *signal* with a conversion factor in the score, not a promise; we don't route 50 items expecting 50 sales. |
| 7 | **Stale "wants"** (posted months ago, dead) | Posts carry `expiresAt` + `active`; matching ignores expired posts. |
| 8 | **Item ages while held** (electronics depreciate, fashion goes off-season) | Hold-at-home window length scales **down** for fast-depreciating/seasonal categories; a holding-cost term sits in the score. |
| 9 | **Customer wants their money now, but we're holding for a match** | Trust gates this: trusted users are **refunded immediately** so they don't care where the item waits; only standard/low-trust users experience the hold. |
| 10 | **One courier trip for one item is wasteful** | Holding at home enables **pickup batching** — collect several items in an area in one run (modeled, not literally scheduled). |
| 11 | **Peer handoff fails** (buyer cancels) | State machine allows **re-routing**: item returns to the routing engine and falls through to warehouse. |
| 12 | **Warehouse near demand is full** | Warehouse score can fall back to second-best; capacity is a seeded field (capacity enforcement itself = TODO). |
| 13 | **Hygiene/safety items** can't peer-redistribute regardless of demand | Hard gate forces donate/liquidate before any demand logic runs. |
| 14 | **Remote seller, tiny item** (pickup cost > value) | Same as #1 → donate locally or buyer self-pickup for peer. |
| 15 | **Buyer-side fraud on peer posts** (sniping underpriced items) | Buyer trust is checked on claim (reuses P3); low-trust buyers can't fast-claim (rule stubbed; full enforcement = TODO). |
| 16 | **Refund held but item still movable** | Refund decision and physical movement are **decoupled** — the item can peer-handoff or ship while the refund stays held pending verification. |

**Deliberately deferred (TODO, flagged so nobody assumes they're done):** real courier/batching
scheduling, hard warehouse-capacity enforcement, warehouse category specialization, buyer-side
fraud enforcement, real notifications (email/SMS/WhatsApp), and the physical inspection station
(modeled as a state, not a real workflow).

---

## 4. Exact Tech Stack

All existing in the repo except one small, optional frontend map library.

| Layer | Tech |
|---|---|
| Backend | Node.js + Express (module-per-domain) |
| Data | MongoDB Atlas M0 via Mongoose; `2dsphere` indexes on posts + warehouses |
| Routing/warehouse math | Pure JavaScript (Haversine + weighted scorecards); **no ML, no network** |
| Item → tags | **Gemini** (one cheap call) with deterministic keyword fallback |
| Tag matching | MongoDB query / keyword overlap on `tags[]` + `$geoNear` geo-filter |
| Grading / trust sources | `grading.service.getGradeByItemId`, `trust.service.getTrustProfile` (read-only) |
| Lifecycle | `lifecycle.service.appendEvent` + `item.service.transitionStatus` |
| Listing copy | Deterministic template (default); optional Gemini polish via existing `ml-service` (stretch) |
| Admin map (frontend) | **react-leaflet + OpenStreetMap tiles** (free), or a hardcoded SVG/coordinate plot fallback to avoid the dep |
| Health Card (optional) | Node `crypto` SHA-256 hash chain + `qrcode` npm |
| Frontend | React (Vite), Tailwind + shadcn/ui, framer-motion, lucide-react, axios |
| Tests | Jest | 
| Seeds | Additive idempotent scripts (mirror `seed-trust.js`) |

> **Not added (TODO/stretch):** AWS KMS/Ed25519, blockchain, trained-ML routing, custom vision,
> real payments/escrow, real notifications, real courier/scheduling.

---

## 5. Parallelization & Step 0 (Frozen Contracts — do together first)

Two teams build simultaneously against a few frozen contracts and **defensive seam functions** (the
`safeMatchDemand` pattern already in the repo). Neither phase blocks the other.

- **Phase A — Routing, Demand, Matching & Admin Map** (backend-heavy + map UI). The brain + geo.
- **Phase B — Resale Marketplace & Seller Tools** (full-stack). The storefront + seller side.

### Step 0 — write these together, then split (~45 min)

**`backend/src/contracts/resaleListing.contract.js`** (NEW): `RESALE_STATUSES`,
`RESALE_TRIGGER_PATHS = ['resell','refurbish','peer-redistribute']`, and the ResaleListing shape
(`itemId, gradeId, routingDecisionId, sellerId, intakePath, title, description, category, images,
originalPrice, suggestedPrice, price, conditionLane, grade, qualityScore, gradeRationale, defects,
previousOwnerNotes, demandCount, healthCardId, status, peerRedistribute`).

**`backend/src/contracts/demand.contract.js`** (NEW): the buyer-post / want shape
(`userId, text, tags[], category, maxPrice, condition, location{lng,lat}, radiusKm, expiresAt,
active`) and the **warehouse shape** (`code, name, city, location{lng,lat}, capacity, categories[]`).

**Three seam functions (name + shape = the contract):**
1. `demand.service.matchDemandForItem(category, tags, location, radiusKm) → { count, radiusKm, posts }` — Phase A implements & consumes (wrapped `safeMatchDemand`).
2. `demand.service.demandByWarehouse(term) → [{ warehouseCode, demand }]` — Phase A (powers the map).
3. `resale.service.createDraftFromRouting({ itemId, routingDecision, grade }) → ResaleListing|null` — Phase B implements, Phase A calls via `safeCreateResaleDraft` (degrades gracefully).

Shared price formula: `suggestedPrice = round(originalPrice × grade.estimatedResalePct × (1 + min(demandCount/10, 0.5)))`.

---

## 6. Phase A — Routing, Demand, Matching & Admin Map

**Goal:** a graded item gets tagged, matched to nearby buyer posts, routed (with refund-timing +
best-warehouse logic), and handed off to Phase B for resell paths. Plus the admin demand map.

### Files Team A owns
**Create:** `routing/routing.config.js`, `routing/routing.scoring.js`,
`routing/routing.warehouse.js` (warehouse-selection), `routing/__tests__/*.test.js`,
`demand/warehouse.model.js`, `demand/matching.service.js` (LLM tagging + tag/geo match),
`seed-routing.js`, `seed-demand.js` (Chhattisgarh warehouses + geo-distributed posts),
`frontend/src/services/routing.js`, `frontend/src/services/demand.js`,
`frontend/src/components/routing/RoutingRationale.jsx`,
`frontend/src/components/demand/{WantButton,NearbyDemandBadge,LookingForForm}.jsx`,
`frontend/src/pages/admin/DemandMapPage.jsx`.
**Edit (own module):** `routing/{routing.service,routing.controller,routing.validation,routing.routes,routing.model}.js`
(append `refundHold`, `refundHoldReason`, `chosenWarehouse`, `matchWindow` fields to the model),
`demand/{demand.service,demand.controller,demand.validation,demand.routes}.js`.
**Coordinated additive mount:** `ItemStatusPage.jsx` (mount `<RoutingRationale/>` in the existing
placeholder slot); `App.jsx`/admin nav (one route for the map).

### Tasks
- **A1 — `routing.config.js`:** carrier rates, weight brackets, condition/demand factors, hygiene
  list, `MATCH_WINDOW_HOURS=48` (+ a demo override env), holding-cost + depreciation per category,
  and the **Chhattisgarh warehouse list** (code/name/city/lat/lng).
- **A2 — `routing.scoring.js`** (pure, test-first): `haversine`, `reverseLogisticsCost`,
  `scorePaths`, `applyHardGates`, `rankAndChoose`, and `decide(inputs) → { chosenPath,
  rankedAlternatives, hardGatesApplied, reverseLogisticsCost, refundHold, refundHoldReason }`.
  Refund-timing rule: restricted+returns → reject; low-trust → `refundHold:true`; trusted + low
  inbound cost → `refundTiming:'immediate'`. 10+ case test matrix incl. determinism.
- **A3 — `routing.warehouse.js`** (pure, tested): `chooseWarehouse({ sellerLoc, category, weight,
  resaleValue, demandByWarehouse }) → { warehouseCode, score, breakdown }` =
  `resaleValue × (1 + w·demand) − inbound − expectedOutbound − holdingCost`. Demonstrates the
  "not nearest, but best" logic; unit-tested with a near-but-low-demand vs far-but-high-demand case.
- **A4 — `matching.service.js`:** `generateTags(item, grade)` (Gemini, deterministic fallback);
  `matchDemandForItem(category, tags, location, radiusKm)` (`$geoNear` + tag overlap);
  `demandByWarehouse(term)` (per-warehouse `$geoNear` count, normalized 0–100 for the map);
  `notifyMatches(listingId)` (in-app flag).
- **A5 — demand module HTTP:** buyer posts CRUD (`POST/GET/DELETE /api/demand/posts`),
  `GET /api/demand/match` (debug), `GET /api/demand/map?term=shoe` (map data),
  warehouse list endpoint. `seed-demand.js` seeds warehouses + ~30–50 posts around two demo cities
  so map + matching fire on real (small) data.
- **A6 — `routing.service.computeRoutingDecision(itemId)`:** read item→grade→trust→price→category;
  `generateTags` → `safeMatchDemand`; guard `flaggedForReview→409`, not-`GRADED`→422; `decide`;
  if resell-class and a peer match exists → set `matchWindow` (hold-at-home) state; else
  `chooseWarehouse`; set `refundHold`; upsert `RoutingDecision`; `transitionStatus → ROUTED`; then
  `safeCreateResaleDraft(itemId)`. Emit the `ItemLogger.log` chain
  (`ROUTING_START/DEMAND/GATE/WAREHOUSE/DECISION/STATUS_UPDATE/FLOW_COMPLETE`).
- **A7 — Frontend:** `RoutingRationale.jsx` (six bars, winner, gate badge, **refund-hold notice**,
  "📍 N buyers within R km", chosen-warehouse line); `LookingForForm` (buyer post creation) +
  `WantButton`; **`DemandMapPage.jsx`** — react-leaflet map of Chhattisgarh, hardcoded search terms,
  demand number overlaid per warehouse via `GET /api/demand/map`.
- **A8 — Seeds & tests:** `seed-routing.js` personas (Priya→donate, Rahul→peer/resell,
  Anjali→resell, hygiene→donate gate, counterfeit→liquidate gate, low-trust→refundHold); print the
  decision + chosen-warehouse table. Scoring + warehouse unit tests pass.

### Phase A DoD
- `POST /api/routing/compute {itemId}` returns ranked paths + chosen warehouse + refund decision for
  every persona; `GET /api/routing/:itemId` returns it.
- Buyer posts + `$geoNear` matching work on seeded data; routing demand factor reflects them.
- **Admin map**: searching a term shows normalized demand per Chhattisgarh warehouse.
- Best-warehouse test proves a farther high-demand warehouse can beat a nearer low-demand one.
- Low-trust returns set `refundHold`; trusted+cheap set immediate refund — both shown in the UI.
- Resale handoff degrades gracefully if Phase B isn't merged.

---

## 7. Phase B — Resale Marketplace & Seller Tools

**Goal:** a routed resell-class item becomes a grade-backed, priced, purchasable listing; the
original owner can add notes; the seller edits price and publishes.

### Files Team B owns
**Create (NEW module):** `backend/src/modules/resale/{resale.model,resale.service,resale.controller,
resale.validation,resale.routes}.js`; `backend/seed-resale.js`; `frontend/src/services/resale.js`;
`frontend/src/pages/{ResaleMarketplacePage,ResaleListingDetailPage}.jsx`;
`frontend/src/components/resale/*`.
**Fill stubs (own):** `healthCard/healthCard.service.js` (+ controller/routes) — *optional/stretch*.
**Coordinated additive edits (flag in chat):** `items/item.model.js` + `item.service.js` (add
`ownerNotes` + `addOwnerNotes` + `PATCH /api/items/:id/notes`); `SellerDashboard.jsx` (Resale tab);
`ItemStatusPage.jsx` ("Add notes" box, different region from A's mount); `App.jsx` + `server.js`
(resale routes); `{HomePage,SearchResultsPage}.jsx` (resale lane — deferrable).

### Tasks
- **B1 — `resale.model.js`** per the frozen contract (own collection; never touch `Product`).
- **B2 — `createDraftFromRouting({ itemId, routingDecision, grade })`** (the seam Phase A calls):
  only act on `RESALE_TRIGGER_PATHS`; resolve `sellerId` (sell-used→initiator; returns→original
  product seller, else platform); `suggestedPrice` from grade×demand; `conditionLane` from
  `GRADE_TO_CONDITION_LANE`; snapshot grade/score/rationale/defects; copy `item.ownerNotes`;
  deterministic `title`/`description`; pick photos from the grade evidence bundle; create `DRAFT`;
  idempotent upsert by `itemId`.
- **B3 — Listing lifecycle:** `publish` (DRAFT→PUBLISHED; item `ROUTED→IN_TRANSIT→LISTED`; calls
  `demand.notifyMatches` defensively), `unlist`, `updatePrice` (seller/admin only; keep
  `suggestedPrice`), `getPublicListing`, `getStorefront({category,conditionLane,page})`,
  `getSellerListings(sellerId)`.
- **B4 — Owner notes:** additive `item.ownerNotes` + `addOwnerNotes` (initiator-only, status ≥
  GRADED) + `PATCH /api/items/:id/notes`; listing reflects updated notes.
- **B5 — HTTP:** `/api/resale` routes (`GET /`, `GET /:id`, `GET /seller/mine`, `POST /:id/publish`,
  `POST /:id/unlist`, `PATCH /:id/price`) + validation + seller/admin auth; register in `server.js`.
- **B6 — Storefront FE:** `ResaleMarketplacePage` (grid + condition-lane filter);
  `ResaleListingDetailPage` (**grade badge + quality score + AI grade rationale + defects +
  condition lane + previous-owner notes** + buy via existing order flow); resale lane on Home/Search.
- **B7 — Seller dashboard:** Resale Listings section (grade, condition, demand, suggested vs current
  price, status) + inline price edit + publish/unlist.
- **B8 — Owner-notes UI** on `ItemStatusPage` once status ≥ GRADED.
- **B9 — `seed-resale.js`**: published listings for the routed personas so the storefront is demoable.
- **B10 — Health Card** *(stretch)*: SHA-256 hash chain over lifecycle events + QR → public verify
  page; link `healthCardId`. **KMS/Ed25519 = TODO.**

### Phase B DoD
- Routed resell-class item → `DRAFT` listing → publish → storefront.
- Resale PDP shows grade + score + **reasoning** + defects + condition lane + **owner notes**.
- Owner can add notes post-grading; seller can edit price + publish/unlist; buyer can purchase.
- `seed-resale.js` populates a demoable storefront on a fresh DB.

---

## 8. Trust Integration (explicit)

| Requirement | Decision | Where |
|---|---|---|
| Lower trust → **more evidence fields** on the intake form | **TODO — write, don't implement.** Add `// TODO(trust-tiered-evidence)` in the evidence-form path. | doc note + comment |
| **Very low trust → stop the refund** until manual verification | **Implement.** Routing sets `refundHold=true` (+ reason) for restricted/low-trust returns; low-trust items must reach a warehouse for physical re-grade before refund. UI shows "Refund withheld — manual verification required." Disbursement stays mocked, so the hold is the meaningful signal. | Phase A — `routing.service`/`routing.model`/`RoutingRationale` |
| Trusted + cheap-to-move → **refund now** | **Implement** as `refundTiming:'immediate'`; item held at home / batched pickup. | Phase A |

We only **read** `getTrustProfile` and act on the tier — Phase 3 stays frozen.

---

## 9. Build Order & Coordination

1. **Joint Step 0 (~45 min):** write the two contracts + the three seam signatures + price formula. Commit, branch.
2. **Phase A & B run in parallel.** A is testable immediately (scoring/warehouse tests, seeds, map,
   REST). B is testable against `createDraftFromRouting` driven by a seeded routing decision.
3. **Known integration touch-points (small, additive):** `ItemStatusPage.jsx` (A: rationale, B:
   notes — different regions), `App.jsx`/`server.js` (B routes + A map route), `SellerDashboard.jsx`
   (B), Home/Search resale lane (B, deferrable).
4. **Merge & smoke test:** seed → grade → `POST /routing/compute` → (map shows demand) → resell
   decision + chosen warehouse → `createDraftFromRouting` → publish → buy. Confirm the Developer
   Logs Sidebar shows the full chain.

**Rough effort:** Phase A ≈ 1–1½ days solo; Phase B ≈ 1–1½ days solo; parallel wall-clock ≈ 1½–2 days.

---

## 10. One-Paragraph Summary

A graded item is tagged by an LLM, matched against nearby buyers' "Looking for" posts, then run
through a deterministic routing brain that weighs the grade, the submitter's trust, real geo-demand,
and the cost to move it — deciding whether to refund now, hold the item at home for a 48h peer match,
or ship it to the *best* warehouse (the one near buyers, not just the nearest), and withholding the
refund for risky returners until a physical re-check. Resell-class decisions hand off via one
defensive seam to a resale module that turns the item into a grade-backed, honestly-priced listing
showing the AI's reasoning, the defects, and notes the previous owner adds after grading; the seller
tunes the price and publishes; nearby buyers get pinged; and an admin demand map over Chhattisgarh
makes the whole warehouse-vs-demand algorithm visible on small seeded data. Two teams build the
brain and the storefront in parallel, meeting only at the frozen `ResaleListing` contract.
```
