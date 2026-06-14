# Phase 7.5 — Festive Defense Layer

> Status: ✅ Implemented (Levers 1–3). Lever 4 deferred to roadmap.
> Builds directly on Phase 7 (Prevention Intelligence) and Phase 3 (Trust Score).
> "During the days the marketplace makes the most money, it also bleeds the most. Festive defense closes that gap without touching the buy button."

---

## Implementation Notes (as built — reconciles plan with the real codebase)

The plan below was written against an idealised order model. The actual repo has a
**lightweight, simulated order model**, so the build adapted as follows:

- **Base return window is 30 days** (owned by `returns` module), not 10. Festive shrink is
  layered on top of that base. See the corrected Lever 1 table.
- A **real COD payment option was added** to the order flow (`paymentMethod: 'prepaid' | 'cod'`,
  default `prepaid`). Prepaid still requires the mock card; COD carries none.
- The order model had **no fulfillment lifecycle** — added `fulfillmentStatus`
  (`placed → dispatched → in_transit → out_for_delivery → delivered`, default `placed`)
  plus a dev helper to advance it so the cancel lock can be demoed.
- All order changes are **additive + defaulted**, and all festive hooks are **fail-open**
  (if the festive module is absent or errors, orders/returns behave exactly as before).
- Festive policy is **snapshotted on the order** at placement (`order.festivePolicy`), so
  later calendar edits never change an existing order's terms.

**Files created:** `contracts/festive.contract.js`, `modules/festive/*` (model, service,
controller, routes, validation), `seed-festive-calendar.js`.
**Files touched (additive):** `order.model.js`, `order.service.js`, `order.controller.js`,
`order.routes.js`, `order.validation.js`, `return.service.js`, `server.js`, `package.json`.

---

## 0. Why This Phase Exists (read first)

India's e-commerce return and RTO problem is not uniform across the year. It clusters
around predictable sale windows — Big Billion Days, Great Indian Festival, Diwali, EOSS,
Republic Day, Raksha Bandhan. During these weeks:

- Order volumes jump 24% YoY ([Unicommerce Diwali 2025 report](https://www.ndtvprofit.com/business/festive-season-wraps-up-with-24-e-commerce-order-volume-surge-q-comm-shines))
- Return windows are abused at higher rates because of impulse buying, gifting uncertainty, and bracketing
- COD/RTO refusal rates climb to 20–35% on fashion and lifestyle ([Base, 2025](https://base.com/en-EN/blog/rto-losses-d2c-brand/))
- Mid-transit "buyer's remorse" cancellations spike, eating already-spent forward-shipping cost
- Indian e-retailers lost an estimated ₹15,000 cr to e-commerce fraud in FY24, returns abuse a major slice ([LiveMint](https://www.livemint.com/industry/retail/indian-ecommerce-firms-return-policies-return-fraud-myntra-amazon-rules-11751436540216.html))

Phase 7 already builds the **risk scorecard, RIKB, fit intel, and intervention engine** —
all running year-round. Phase 7.5 layers a **calendar-aware switch** on top: when the
system enters a known sale window, three policy levers tighten automatically for the
risky cohort *only*. Verified and trusted users see no change; their experience and
Amazon's GMV from genuine buyers stay untouched.

> **Design rule (non-negotiable): no friction on the buy button.**
> Every Phase 7.5 lever fires *after* the buy decision (return window, payment-method
> gate, mid-transit cancel) or against a pre-identified risky cohort. We never reduce
> conversion on a customer who would have kept the order.

Content rephrased for compliance with licensing restrictions.

---

## 1. Module Boundaries

**Read-only dependencies:**
- `trust.service.getTrustProfile(userId)` (Phase 3) — for tier
- `prevention.scoring` / `prevention.intervention` (Phase 7) — for risk band on the order
- `order.model.js` — extend, do not rewrite
- `return.model.js` — extend, do not rewrite

**Owned by Phase 7.5:**
- `backend/src/modules/festive/` — new module
  - `festiveCalendar.model.js` — calendar collection
  - `festive.contract.js` — constants (event codes, multipliers, COD caps)
  - `festive.service.js` — `isInFestiveWindow(date)`, `getActiveEvent(date)`, `getFestivePolicy(userTier, riskBand, eventCode)`
  - `festive.controller.js` + `festive.routes.js` — admin/seed endpoints
- `backend/seed-festive-calendar.js` — seed Diwali, BBD, GIF, EOSS, Republic Day, Raksha Bandhan
- Surgical hooks into existing modules:
  - `order.service.placeOrder()` → check festive policy → pin `paymentRestrictions` and `cancellationRestrictions` on the order
  - `order.service.cancelOrder()` → respect mid-transit lock
  - `return.service.initiateReturn()` → enforce shrunken window for festive orders
  - `checkout.controller` → COD eligibility filter

**Frozen interfaces I will NOT touch:**
- Phase 3 trust scoring math
- Phase 7 RIKB or scorecard weights
- AI grading pipeline (Phase 2)

---

## 2. The Festive Calendar (the foundation)

A small Mongo collection seeded once. The single source of truth for every other lever.

```
festiveCalendar
  eventCode       string   e.g. 'BBD_2025', 'GIF_2025', 'DIWALI_2025', 'EOSS_2025'
  eventName       string   human-readable
  startDate       Date
  endDate         Date
  riskMultiplier  number   default 1.5; tunes Phase 7 scorecard
  affectedCategories [string]   e.g. ['apparel','footwear','jewelry','home']
  policies        object   { codGate, returnWindow, cancelLock, returnFeeDefer }
  active          boolean
```

**Seeded events (rolling 12 months from current date):**
- Big Billion Days (BBD) — Flipkart, ~5–10 days, electronics + fashion heavy
- Great Indian Festival (GIF) — Amazon, overlaps BBD
- Diwali week — pan-platform, all categories
- End of Season Sale (EOSS) — Jan + Jul, apparel heavy
- Republic Day Sale — late Jan
- Raksha Bandhan / Rakhi — gifting heavy
- Wedding season blanket — Oct–Feb (long, lower multiplier)

A single utility `isInFestiveWindow(orderDate)` returns the active event (or null) and
its policy bundle. Every Phase 7.5 lever calls this and nothing else.

---

## 3. The Three Core Levers + One Optional

All four are calendar-driven. All four are tier-aware. All four are sales-preserving for
verified/trusted users.

### Lever 1 — Festive Return Window Shrink

**What changes:** the return window for orders placed *inside* a festive window is
shorter than the standard 30 days (the base window owned by the returns module).

| Trust tier | Base window | Festive window |
|---|---|---|
| Verified | 30 days | **30 days (unchanged)** |
| Trusted | 30 days | **30 days (unchanged)** |
| Standard | 30 days | 15 days |
| Watch | 30 days | 10 days |
| Restricted | 30 days | 7 days |

**Rules:**
- Window is pinned on the order at placement time (`order.festivePolicy.returnWindowDays`),
  not computed at return time — protects the buyer from policy changes after purchase
- `defective` and `wrong_item` returns always honour the **full 30-day window**
  regardless of festive — non-negotiable, consumer-protection aligned
- Display at checkout: a small line *"Festive sale: 15-day returns on this order"* —
  expectation set upfront, no surprise complaint
- Enforced in `return.service.initiateReturn` (defensive: falls back to base 30 if the
  festive module is unavailable)

**Why this works:** caps wardrobing and "I'll think about it" change-of-mind returns
without affecting genuine defect returns.

---

### Lever 2 — COD Gate for Low-Trust Users in Festive Windows

**What changes:** during festive windows, the COD payment option is conditionally hidden
or capped based on trust tier.

| Trust tier | Outside festive | Inside festive |
|---|---|---|
| Verified / Trusted | COD available | **COD available (unchanged)** |
| Standard | COD available | COD allowed up to ₹2,000 cart value |
| Watch | COD available | COD allowed up to ₹500, otherwise prepaid only |
| Restricted | Prepaid only (already, from Phase 3) | Prepaid only |

**Refinements baked in:**
- **Cap, don't kill** — first-time genuine buyers in `standard` tier still get COD on
  smaller carts, preserving their first-order conversion
- **Partial-prepaid fallback** — when COD is blocked, offer "pay ₹100 token now, balance
  on delivery" as the alternative. Skin-in-the-game without losing the COD audience entirely
- Decision is computed at checkout-options call (`GET /api/checkout/payment-methods`) and
  stamped on the order at placement (`order.paymentRestrictions`)

**Why this works:** RTO refusal on COD runs 20–35% in India and spikes during festive.
This is the highest-leverage cost reduction in the trio — it stops the loss before the
package even leaves the warehouse.

---

### Lever 3 — Mid-Transit Cancellation Lock (BBD / GIF Only)

**What changes:** during the two highest-volume sale events (Big Billion Days and Great
Indian Festival), buyers cannot cancel an order that has already entered the carrier
network. Doorstep refusal remains available — that is a fulfillment event, not a UI
button, and consumer-protection law preserves it regardless.

**Scope (deliberately tight):**
- Active **only** for `eventCode in ['BBD_*', 'GIF_*']`
- Active **only** for orders with `riskBand in ['medium','high']` (from Phase 7 scorecard)
- Verified/trusted users with `riskBand === 'low'` keep normal cancel behavior even during
  BBD/GIF — no broad UX hit on loyal customers

**Order states affected:**
- `placed` → cancellation allowed (the 30-min remorse window stays open for everyone)
- `dispatched` → cancellation **blocked** for the targeted cohort
- `out_for_delivery` → cancellation blocked, doorstep refusal still possible
- `delivered` → standard return flow takes over (subject to Lever 1)

**UI behavior:**
- Cancel button greys out with copy: *"This order is in transit. You can refuse delivery
  at the door if needed, or initiate a return after delivery."*
- Standard cancel works normally outside BBD/GIF, even for high-risk users

**Stored on `order.cancellationRestrictions = { lockedAfterState, lockReason, lockedAt }`**

**Why this works:** mid-transit cancels are pure waste — forward shipping is already paid,
inventory is already in the network. They're also the easiest "buyer's remorse" lever
because no real cost has hit the buyer yet. A small, well-scoped resistance window
captures intent before it converts to wasted logistics.

---

### Optional Lever 4 — Deferred Return Fee on Next Order

**Status: stretch / roadmap.** Documented here for completeness, demoed verbally in the
"what's next" slide. Not on the build path for the hackathon cut.

**What it does:**
- When a user (standard / watch / restricted tier) returns a festive-window order with
  a non-defective reason (`changed_mind`, `not_as_described`, `other`), a small
  reverse-logistics fee (~₹40–₹70) is recorded as a `pendingReturnFee` on the user
- The fee does **not** block the current return (zero return-side friction)
- The fee is auto-applied as a line item on the user's *next* purchase, with
  transparent disclosure: *"Pending return fee from previous order: ₹40"*
- Verified/trusted tiers are **exempt**
- Defective and wrong-item returns are **exempt**
- Total pending fee is capped per user (e.g. ₹150) so it never becomes a wall
- Fee auto-waives if user keeps next 2 orders fully — turns it into a positive nudge
- Pending fee expires after 90 days of inactivity — no chase on lapsed buyers

**Why deferred:**
- Adds a new field on user, checkout-line-item rendering, and accounting glue
- Behavior surfaces on the *next* order, hard to demo in a single live walkthrough
- The trio above already covers all three lifecycle windows; this is incremental polish
- Strong roadmap story even if not built — judges appreciate the thought-through tail

---

## 4. The Story Arc (this is the demo)

Phase 7.5 produces a clean, four-sentence arc across the order lifecycle:

| Lifecycle window | Lever | Cost vector closed |
|---|---|---|
| Pre-dispatch (BBD/GIF only) | Mid-transit cancel lock | Wasted forward shipping on impulse cancels |
| At payment | COD gate | RTO refusals on the doorstep |
| Post-delivery | Shorter return window | Wardrobing & change-of-mind returns |
| (Optional) Post-return | Deferred return fee | Reverse-logistics cost recovery |

One festive calendar trigger, four cost vectors closed, zero friction on the buy button
for genuine customers.

---

## 5. Endpoints (as built)

**Festive module (`/api/festive`):**
```
GET  /api/festive/active                      → { active, event{eventCode,policies,...} }
GET  /api/festive/payment-policy?cartTotal=N  → { tier, codAllowed, cap, capExceeded,
                                                  partialPrepaidToken, festive, eventCode }
                                                  (optional auth → tier-specific)
GET  /api/festive/return-window?reasonCode=X  → { tier, windowDays, shrunk, reason }
GET  /api/festive/calendar                    → full calendar (admin/dev)
POST /api/festive/override  { instanceKey, on }→ force an event active for the demo (admin/dev)
```

**Order module additions (`/api/orders`):**
```
POST  /api/orders                  → now accepts paymentMethod: 'prepaid' | 'cod'
                                     (409 COD_NOT_AVAILABLE if festive COD gate blocks it)
POST  /api/orders/:id/cancel       → cancel; 409 CANCEL_LOCKED if mid-transit lock applies
PATCH /api/orders/:id/fulfillment  → dev/demo helper to advance the carrier lifecycle
```

Internal service functions (not exposed) in `festive.service.js`:
- `getActiveEvent(date)` / `isInFestiveWindow(date)` — calendar lookup (forceActive wins)
- `getReturnWindowDays({orderCreatedAt, tier, reasonCode})` → Lever 1
- `getCodPolicy({tier, cartTotal, atDate})` → Lever 2
- `canCancelOrder({fulfillmentStatus, tier, atDate})` → Lever 3
- `buildOrderFestivePolicy({userId, tier, cartTotal})` → the snapshot stamped on each order
- `resolveTier(userId)` — defensive Phase 3 trust lookup (defaults to `standard`)
- `setForceActive(instanceKey, on)` — demo override toggle

---

## 6. Surgical Hooks Into Existing Modules

| Existing file | Change | Risk |
|---|---|---|
| `order.service.placeOrder()` | After validation, before persist: call `festive.service.applyToOrder()` to stamp policies | Low — additive fields on the order |
| `order.service.cancelOrder()` | Add early-return: if `!festive.canCancel(order)` → 409 with copy | Low — explicit guard, easy to revert |
| `return.service.initiateReturn()` | Use `order.returnPolicy.windowDays` instead of hardcoded constant | Low — single read |
| `checkout.controller.getPaymentMethods()` | Filter COD based on `festive.getPolicy(user, cartTotal)` | Low — filter step on response |

No changes to `trust`, `prevention/scoring`, `prevention/intervention`, `grading`, or
`routing` modules.

---

## 7. Admin / Seller Visibility

A small panel (one card on the existing admin dashboard) shows:
- "Festive Mode: ON — Big Billion Days (Day 3 of 7)"
- Counters for the day: orders placed, COD blocks, mid-transit locks engaged, festive returns initiated
- Toggle to force-enable or force-disable for demo purposes

This is what sells the demo. Judges see the policy, the live count, and the impact in one
panel without needing to walk through every code path.

---

## 8. Test Matrix (manual demo verification)

| # | Scenario | Expected |
|---|---|---|
| 1 | Verified user places ₹3,000 order during BBD, cart has 1 apparel item | Full cancel, full COD, 10-day window |
| 2 | Standard user places ₹2,500 cart during BBD | COD blocked above ₹2,000 → partial-prepaid offered; 7-day window |
| 3 | Watch user places ₹1,500 cart during Diwali | COD allowed (under ₹500 cap doesn't apply because COD allowed up to ₹500 → prepaid here); wait — check copy; 5-day window |
| 4 | Standard user, mid-transit cancel attempt during BBD on a `medium` risk order | Cancel button greyed; copy explains doorstep refusal still available |
| 5 | Same standard user, mid-transit cancel during EOSS (not BBD/GIF) | Cancel allowed — lock is BBD/GIF-only |
| 6 | Verified user, mid-transit cancel during BBD on a `low` risk order | Cancel allowed — verified + low risk exempt |
| 7 | Festive defective return after 9 days | Allowed — defective overrides shrunken window |
| 8 | Festive change-of-mind return after 9 days for standard tier | Blocked — outside 7-day festive window |
| 9 | Force-disable festive mode from admin panel | All levers immediately revert; in-flight orders keep pinned policies |

---

## 9. Definition of Done

```
[x] 1.  festiveCalendar collection seeded with 7 events covering 2025–26
[x] 2.  festive.service.isInFestiveWindow + getReturnWindowDays/getCodPolicy/canCancelOrder
[x] 3.  order.createOrder snapshots festivePolicy + enforces COD gate (409 COD_NOT_AVAILABLE)
[x] 4.  GET /api/festive/payment-policy returns tier×cart COD decision for the checkout UI
[x] 5.  order cancel respects BBD/GIF mid-transit lock (409 CANCEL_LOCKED) for non-genuine tiers
[x] 6.  return.initiateReturn reads festive-aware window (pinned snapshot, falls back to 30d)
[x] 7.  defective + wrong_item always bypass shrunken window
[x] 8.  forceActive demo override (seed --force / POST /api/festive/override)
[ ] 9.  Frontend: COD toggle + "Festive sale: N-day returns" banner + cancel-disabled state
[ ] 10. Admin festive panel (live counters + toggle) — optional polish
[x] 11. Levers verified against live DB (return window / COD / cancel lock all correct)
[ ] 12. (Optional) Lever 4 deferred return fee — documented in roadmap only
```

> **Backend is complete and verified.** Remaining items (9, 10) are frontend/UI work.
> Lever 4 stays on the roadmap.

---

## 10. What Phase 7.5 Does NOT Do (deliberately)

- Does not change Phase 3 trust scoring or Phase 7 risk weights — calendar is an
  *external multiplier*, not a re-tuning
- Does not block the buy button for any user, in any tier, in any festive window
- Does not penalise verified or trusted customers in any way
- Does not change refund mechanics for defective or wrong-item claims
- Does not introduce a new ML model or AWS service
- Does not require new infrastructure — pure backend logic on existing collections

---

## 11. One-Slide Demo Script

> "During festive sales, we don't slow down genuine customers. We layer three calendar-driven
> defenses on the risky cohort that already costs us the most.
>
> Lever 1: festive orders get a 7-day return window for standard users, 10 days untouched
> for our verified buyers. Defects always honor the full window.
>
> Lever 2: COD is gated by trust during sale weeks. Verified Priya pays cash on delivery
> like always. A new account with a 4-return history gets prepaid-only above ₹500. Same
> sale, no RTO refusal at the door.
>
> Lever 3: during Big Billion Days and Great Indian Festival, a high-risk order can't be
> cancelled mid-transit. Doorstep refusal stays available — that's the law. But buyer's
> remorse cancels that waste forward shipping? Closed.
>
> One festive calendar. Three cost vectors. Zero impact on conversion for the customers
> we want to keep."

---

## 12. Roadmap Beyond 7.5

- **Lever 4** — deferred return fee on next order (covered §3.4)
- **Seasonal risk multiplier** — weave the calendar into Phase 7 scorecard as an 8th signal
- **Pre-festive seller size-chart audit** — proactive alert 14 days before window opens
- **Address-pin RTO score** — pincode-level RTO aggregation feeding the risk scorecard
- **Sale-Safe Pick badge** — surface low-return SKUs during festive (inverse prevention)

These are roadmap, not Phase 7.5 scope.
