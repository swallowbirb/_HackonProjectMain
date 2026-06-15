# Phase 8 — Sustainability Impact & Green Credits

> **What this doc is.** The implementation plan for the sustainability layer: CO₂ + water
> savings per disposition, a redeemable Green Credits wallet, and a full donation flow
> (NGO match + tax-receipt PDF). Grounded in the repo as it stands today — it builds on the
> existing `sustainability` module stubs and hooks into real lifecycle/order events, **not**
> the routing engine (which is still a stub).

---

## 0. Decisions Locked (read first)

| # | Decision | Choice |
|---|---|---|
| Scope | What we track | **CO₂ + water + green credits** (full impact story) |
| Credits | Are they redeemable? | **Yes** — redeemable as a checkout discount |
| Credits display | How shown | Balance on account dashboard + "+X credits" line on the order/confirmation |
| Donation | Full or simplified | **Full** — NGO `$geoNear` match + tax-receipt PDF. *Signing + pickup are mocked.* |
| Seller credit timing | Publish vs sell | **On sell** (`SOLD`), not at publish |

### Green credit rules

| Action | Who earns | Credits | Trigger |
|---|---|---|---|
| Sell-used item gets sold | Seller | 10 | resale `SOLD` |
| Buy a second-hand item | Buyer | 10 | resale `SOLD` (same event) |
| Donate an item | Donor | 25 | `DONATED` confirmed |

> A single resale sale fires **two** awards at once (10 seller + 10 buyer) on the `SOLD` event.
> Donations have no buyer, so only the donor earns — plus the tax-receipt PDF.

---

## 1. What already exists (verified in repo)

- **`sustainability` module** scaffolded: `sustainability.model.js`
  (`itemId, userId, category, co2SavedKg, waterSavedLiters, greenCreditsEarned, eventType`),
  a `CATEGORY_FACTORS` table + three empty service stubs, a controller returning `501`,
  and routes `GET /platform`, `GET /user/:userId` mounted at `/api/sustainability`.
- **`lifecycle.service.appendEvent(itemId, eventType, actor, data)`** — writes every state change.
  Contract has terminal events `SOLD`, `DONATED`, `LIQUIDATED`.
- **`resale` module** — `ResaleListing` with `marketplaceProductId` (mirror `Product` created on
  publish), `sellerId`, `category`, `originalPrice`, `itemId`, `gradeId`, statuses
  `DRAFT|PUBLISHED|UNLISTED|SOLD`.
- **`order` module** — `createOrder()` makes an instant record pointing at `productId`.
  A resale purchase is detectable because `order.productId === ResaleListing.marketplaceProductId`.
- **`Item`** has `category`, `initiatorUserId`, `status`. **`User`** has no credits field yet.

> **Key architectural choice:** routing is a TODO stub, so we **do not** depend on
> `routingDecision.chosenPath`. Every disposition ends by writing a lifecycle event or an order,
> so we hook there. This makes Phase 8 fully independent and demoable today.

---

## 2. Architecture — three triggers, one engine

```
  resale order placed ─┐
   (buyer + seller)    │
                       ├─► sustainability.service ─► compute CO₂/water (counterfactual)
  donate confirmed ────┤        (single engine)    ─► award green credits (ledger)
   (donor)             │                            ─► append lifecycle event
                       │                            ─► (donate only) NGO match + receipt PDF
  [future] routing ────┘
   donate path
```

- **Engine** is pure + idempotent. Impact per item is computed **once** (unique guard on `itemId`).
- **Triggers** are thin and defensive (`try/catch`, fire-and-forget) so a sustainability failure
  never breaks a sale or a donation.
- **Credits** live in a dedicated append-only ledger so the balance is auditable and redemption
  is just a negative entry.

---

## 3. Data models

### 3.1 `GreenCreditLedger` (NEW) — `sustainability/greenCredit.model.js`
Append-only entries; balance = sum of `delta`.
```
{
  userId: ObjectId (ref User, indexed),
  delta: Number,                 // +earned, -spent
  reason: String,                // 'resale_sale_buyer' | 'resale_sale_seller' | 'donation' | 'redeem_checkout'
  itemId: ObjectId,              // null for redemptions
  orderId: ObjectId,             // for purchases/redemptions
  balanceAfter: Number,          // running balance snapshot
  createdAt: Date
}
```
Helper: `awardCredits(userId, delta, reason, refs)` → reads current balance, writes entry,
returns new balance. `getBalance(userId)` → sum of deltas.

### 3.2 `SustainabilityImpact` (EXISTING — extend slightly)
Add `unique` index on `itemId` for idempotency, and widen `eventType` enum to
`['resale_sale', 'donation', 'liquidate']`. Keep `co2SavedKg`, `waterSavedLiters`,
`greenCreditsEarned`, `userId` (the beneficiary — buyer for sales, donor for donations).

### 3.3 `Ngo` (NEW) — `sustainability/ngo.model.js`
```
{
  name: String,
  categoriesAccepted: [String],
  location: { type: 'Point', coordinates: [lng, lat] },  // 2dsphere index
  pickupRadiusKm: Number,
  contact: { phone, email, address },
  city: String
}
```

---

## 4. Backend — service implementation

### 4.1 `CATEGORY_FACTORS` (fill the existing table)
Keep the existing keys, add a `source` string per row (cited), and a `default` bucket fallback.
Counterfactual = footprint of manufacturing a new item, scaled by a **diversion factor**:

| eventType | diversion factor | meaning |
|---|---|---|
| `resale_sale` | 1.0 | displaces a new purchase fully |
| `donation` | 1.0 | same ecological displacement |
| `liquidate` | 0.1 | low certainty of displacing new manufacturing |

`co2SavedKg = co2PerItem × factor`; `waterSavedLiters = waterPerItem × factor`.

### 4.2 `computeImpact(itemId, category, beneficiaryUserId, eventType)`
- Idempotent upsert by `itemId` (skip if an impact doc already exists).
- Resolve factors (category → `CATEGORY_FACTORS`, else `default`).
- Compute CO₂/water; write a `SustainabilityImpact` doc.
- Returns `{ co2SavedKg, waterSavedLiters, source }` for the UI.

### 4.3 `recordResaleSale({ resaleListing, order })`  *(called from order.service)*
1. `computeImpact(itemId, category, order.buyerId, 'resale_sale')`.
2. `awardCredits(order.buyerId, 10, 'resale_sale_buyer', {itemId, orderId})`.
3. `awardCredits(resaleListing.sellerId, 10, 'resale_sale_seller', {itemId, orderId})`.
4. `lifecycle.appendEvent(itemId, 'SOLD', {role:'system'}, {orderId})`.
5. Mark `resaleListing.status = 'SOLD'`; set item status `SOLD`.

### 4.4 `recordDonation({ itemId, donorId })`  *(called from donate controller)*
1. Match nearest NGO (`matchNearestNgo(category, donorLocation)` via `$geoNear`).
2. `computeImpact(itemId, category, donorId, 'donation')`.
3. `awardCredits(donorId, 25, 'donation', {itemId})`.
4. Generate tax-receipt PDF (`pdfkit`) → store URL; SHA-256 hash placeholder for the
   signature, labelled `// TODO(KMS)`.
5. `lifecycle.appendEvent(itemId, 'DONATED', {role:'ngo'}, {ngoId, receiptUrl})`; item → `DONATED`.
6. If a resale draft exists for the item, `unlist` it.
7. Returns `{ ngo, receiptUrl, impact, creditsEarned }`.

### 4.5 Summaries (replace the 501 stubs)
- `getUserImpactSummary(userId)` → `{ totalCo2Kg, totalWaterL, creditBalance, itemCount, recentLedger }`.
- `getPlatformImpactSummary()` → platform totals (used internally; no homepage ticker this phase).

### 4.6 Redemption
- `redeemCredits(userId, amount, orderId)` → validates balance ≥ amount, writes a negative
  `redeem_checkout` ledger entry, returns discount value (₹). Called by the checkout flow.
- Conversion: **1 credit = ₹10** discount (demo-clear). Cap redemption at order subtotal.

---

## 5. Integration hooks (the only edits outside the module)

| File | Edit | Defensive? |
|---|---|---|
| `orders/order.service.js` | After `createOrder`, look up `ResaleListing` by `marketplaceProductId === productId`; if found + `PUBLISHED`, call `recordResaleSale`. Accept optional `redeemCredits` amount → apply discount to `totalPrice` + write redeem entry. | Yes — wrapped in try/catch, never blocks the order |
| `lifecycle.service.js` | *(optional)* on `LIQUIDATED`, fire `computeImpact(..., 'liquidate')` for platform totals | Yes |

No other module is touched. Routing stays a stub; when it's built, its `donate` path simply calls
`recordDonation` — same seam.

---

## 6. HTTP endpoints (`sustainability.routes.js`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/sustainability/user/:userId` | balance + CO₂/water summary + recent ledger |
| GET | `/api/sustainability/item/:itemId` | per-item impact (resale PDP badge) |
| POST | `/api/sustainability/donate/:itemId` | trigger donation flow (NGO match + receipt + credits) |
| GET | `/api/sustainability/receipt/:itemId` | fetch/download the tax-receipt PDF |
| POST | `/api/sustainability/redeem` | `{ amount, orderId }` → apply credit discount |
| GET | `/api/sustainability/ngos?category=&lng=&lat=` | *(debug)* nearby NGO match |

(`/platform` stays but is internal-only this phase.)

---

## 7. Frontend surfaces (scoped)

1. **Green credits balance** on the account dashboard — number + recent ledger entries.
2. **"+X credits earned"** line on the order/donation confirmation screen.
3. **Redeem-credits toggle at checkout** — "Use N credits (−₹N)"; calls `/redeem`.
4. **Per-listing badge** on the resale PDP — "♻️ Buy second-hand · earn 10 credits · saves ~X kg CO₂".

> Dropped this phase: homepage platform ticker, standalone wallet-history page.

Plus a small **"Donate instead"** action on the owner's item status / resale-draft page that calls
`POST /donate/:itemId` and then shows the NGO + downloadable receipt + credits earned.

---

## 8. Seeds

`seed-sustainability.js` (additive, idempotent — mirror `seed-trust.js`):
- 4–6 NGOs across the two demo cities with `2dsphere` coordinates + accepted categories.
- (Optional) backfill a few historical `SustainabilityImpact` docs so dashboards aren't empty on
  a fresh DB.

---

## 9. Build order

1. **Models + factors** (`greenCredit.model`, `ngo.model`, extend `SustainabilityImpact`, fill
   `CATEGORY_FACTORS`). ~30 min.
2. **Service** (`computeImpact`, `awardCredits`/`getBalance`, summaries, `recordResaleSale`,
   `recordDonation`, `redeemCredits`). Core.
3. **Donation extras** (`matchNearestNgo` via `$geoNear`, `pdfkit` receipt). +1 dep (`pdfkit`).
4. **Controller + routes** (replace 501s, add donate/receipt/redeem/item endpoints).
5. **Order hook** (resale-sale detection + optional redeem discount).
6. **Seeds**.
7. **Frontend** (4 surfaces + donate action).

**Rough effort:** backend ≈ half a day; donation PDF + NGO ≈ 1 hour; frontend ≈ half a day.

---

## 10. Definition of Done

- Buying a published resale listing awards **10 credits to the buyer and 10 to the seller**, writes
  a `SOLD` lifecycle event, and records the item's CO₂/water savings — all idempotently.
- Donating an item matches the nearest NGO, awards the donor **25 credits**, records CO₂/water,
  produces a **downloadable tax-receipt PDF**, and (if listed) unlists the resale draft.
- The account dashboard shows the credit **balance** + CO₂/water totals; the order/donation
  confirmation shows **"+X credits"**.
- Checkout can **redeem** credits as a ₹ discount (1 credit = ₹10, capped at subtotal).
- The resale PDP shows the per-item **earn-credits + CO₂-saved** badge.
- A sustainability failure never breaks an order or a donation (all hooks defensive).
- `seed-sustainability.js` populates NGOs (and optional history) on a fresh DB.

---

## 11. Deliberately deferred (flagged TODO)

- Ed25519/KMS signing on the receipt → SHA-256 placeholder (`TODO(KMS)`), consistent with the rest
  of the repo.
- Real NGO pickup scheduling → mocked as an event field.
- Homepage platform ticker + wallet-history page.
- Routing engine's `donate` path auto-calling `recordDonation` (wired the moment routing lands —
  the seam already exists).
- CO₂/water figures are estimates with cited sources, not audited LCAs (disclaimer shown in UI).
