# Phase 3 — Trust Score & Fraud Defence Layer

## Implementation Plan (Detailed)

> Goal: Attach a **Trust Profile** to every user, computed from their purchase/return
> history, so the downstream pipeline grades items *in the context of who's submitting
> them* — frictionless for genuine users, strict only for risky ones.
>
> End state: Every return / sell-used submission can resolve a trust profile (tier +
> score + signals) at submission time, the profile is persisted and lazily recomputed,
> a fraud-signal ingestion API lets Phase 2 feed cross-cutting signals in, and the
> tier visibly changes downstream behaviour (gated in P4 routing / P1 UI).

---

## Where This Sits

```
P0 (done) ──► P3 (this) ──┐
                          ├──► P4 Routing (consumes trust tier)
P1 (teammate, parallel) ──┘
P2 Grading (not started) ──► feeds cross-cutting fraud signals into P3 via API
```

- **Upstream dependency:** Only P0 — Atlas cluster, seed data with user order/return histories.
- **Parallel to:** P1 (Dual-Intake, teammate's branch) and P2 (Grading).
- **Downstream consumers:** P4 (routing hard-gates on tier), P1 UI (tier-specific evidence flow).

---

## Integration Contracts (LOCKED with teammates)

These are agreed boundaries. Treat them as frozen interfaces — do not cross them.

### With Phase 1 (Dual-Intake) teammate

- **Hands-off folders:** `returns/`, `secondhand/`, `items/` are **theirs**. Phase 3
  must not create, edit, or delete any file in those folders.
- **Required export:** `trust.service.js` MUST export a function named **exactly**
  `getTrustProfile(userId)` that returns `{ tier, score }` (extra fields allowed) or
  `null` when the user can't be resolved. P1 calls this from their code.
  - It is allowed to stay a stub/501-equivalent (e.g. return a default
    `{ tier: 'standard', score: 50 }` or `null`) early on — the **name and return
    shape are the contract**, the internals can land later.
- P1 owns the call site and any `trustTierAtIntake` field on their records. P3 never
  writes to their collections.

### With Phase 2 (Grading) teammate

- Grading owns the `grades` collection. On each grade it annotates the evidence bundle
  with a fraud block:
  ```js
  // on the persisted grade document (grades collection)
  fraudCheck: {
    phash_match: Boolean,            // perceptual-hash match vs catalog/stock
    exif_has_camera_data: Boolean,   // false = stripped metadata (stock-photo signal)
    rekognition_web_match: Boolean,  // image found on open web
    classification: String           // e.g. "clean" | "soft_fraud" | "hard_fraud"
  }
  ```
- **P2 does not compute any trust score.** That is entirely Phase 3's job.
- **Consequence for P3 design:** Phase 3 **pulls** these fields by querying the
  `grades` collection (read-only) during trust computation, rather than relying solely
  on a push API. The `POST /:userId/signals` endpoint stays as a secondary/manual path,
  but the primary fraud-signal source is the grade's `fraudCheck` block.

### What Phase 3 owns (and others must NOT touch)

- `backend/src/modules/trust/**` (all five files).
- `backend/seed-trust.js` (new, additive).
- Any new trust-only frontend component folder (e.g. `components/trust/`).
- Phase 3 reads (never writes) `orders`, `returns`, `users`, `secondhandItems`,
  `grades`. It writes only to `trustProfiles`.

---

## Current State (What We Have)

- `backend/src/modules/trust/` is **already scaffolded**:
  - `trust.model.js` — **fully defined** `TrustProfile` Mongoose schema (userId unique, tier enum, score, signals[], accountAge, lifetimePurchases, lifetimeReturns, returnRate, recentReturnRate90d, bracketingFlag, wardrobingFlag, lastComputed). **Reuse as-is, extend minimally.**
  - `trust.service.js` — stub functions with TODOs: `computeTrustProfile`, `getTrustProfile`, `addFraudSignal`.
  - `trust.controller.js` — `getTrustProfile`, `recomputeTrust` returning 501.
  - `trust.routes.js` — `GET /health`, `GET /:userId`, `POST /:userId/recompute`. **Already registered** at `/api/trust` in `server.js`.
  - `trust.validation.js` — empty `validateGetTrust` passthrough.
- `backend/src/contracts/trustProfile.contract.js` — **locked contract**: `TRUST_TIERS`, `TIER_THRESHOLDS`, `TRUST_SIGNALS` (weights), `RETURN_RATE_THRESHOLDS`. This is the source of truth for scoring constants.
- Data available for computation (no schema changes needed):
  - `Order`: `buyerId`, `sellerId`, `productId`, `totalPrice`, `status` (completed/cancelled/refunded), `createdAt`, `paymentDetails.mockCreditCard`.
  - `Return`: `userId`, `orderId`, `reason` (enum), `status`, `claimDescription`, `evidencePhotos[]`, `createdAt`.
  - `User`: `createdAt` (→ account age), `role`, `banned`, `suspended`, `email`.
  - `SecondhandItem`: `userId`, `status` (for successful-resale-completion signal).
- Atlas index `trustProfiles { userId: 1 } unique` and `items { userId: 1, status: 1 }` were created in P0 (Task 0.3).

**Implication:** Most of Phase 3 is filling in `trust.service.js` + `trust.controller.js` against an already-correct model and contract. The schema work is done.

---

## Merge-Safety Strategy (teammate is on P1 in parallel)

P3 logically fires "on return / sell-used initiation" — but `return.service.js`,
`return.controller.js`, `secondhand.service.js` and the P1 frontend are **owned by the
teammate's Phase 1 branch**. To avoid major conflicts:

**Rules for this phase:**

1. **Do not edit P1's files.** No changes to `returns/*` or `secondhand/*` modules.
   Instead, P3 exposes a clean, self-contained seam that P1 calls with **one line**
   when it merges (see Task 3.6 — Integration Seam).
2. **Do not edit `server.js`.** The `/api/trust` route is already registered. Any new
   trust endpoints go inside `trust.routes.js`, which is owned entirely by P3.
3. **Do not edit the shared `seed.js`.** Add a separate, idempotent
   `backend/seed-trust.js` that augments existing seeded users with the demo
   trust scenarios (a "Watch"-tier user, a high-return-rate user, a clean
   40-purchases-first-return user). It only *reads* existing users/orders and
   *inserts* extra orders/returns; it never rewrites the base seed.
4. **Keep admin/dashboard endpoints inside the trust module** (e.g.
   `GET /api/trust/admin/flagged`) rather than touching the existing `admin/` module.
5. **Frontend (if built this phase):** put everything under a new
   `trust/`-scoped component folder and a single self-contained page/badge component.
   Do not modify P1's intake screens; expose a `<TrustBadge userId>` component P1 can
   drop in later. Coordinate before touching any shared layout/nav file.
6. **Contract is frozen.** Treat `trustProfile.contract.js` as read-only. If a new
   constant is genuinely needed, append a new export rather than editing existing ones,
   and flag it to the team.

**The integration contract both branches agree on (write it down, pin it in chat):**

> "On return / sell-used initiation, P1 calls `trustService.getTrustProfile(userId)`
> (lazy-computes if missing/stale) and stores the returned `tier` on the item record
> as `trustTierAtIntake`. P3 owns the computation; P1 owns the call site and the field."

This means P3 ships a working service + API now; P1 wires the single call when ready.
Until then P3 is fully testable on its own via the REST endpoints and `seed-trust.js`.

---

## Task Breakdown

### Task 3.1 — Trust scoring core (history-based signals)

**What:** Implement `computeTrustProfile(userId)` in `trust.service.js` using the locked
contract weights. Pure read over `Order` / `Return` / `User` / `SecondhandItem`.

**Signals to compute (all derivable from existing data):**

| Signal (contract key) | Source | Direction |
|---|---|---|
| `ACCOUNT_AGE_DAYS` | `now - User.createdAt` | positive |
| `LIFETIME_PURCHASES` | `Order.countDocuments({ buyerId, status: 'completed' })` | positive |
| `VERIFIED_PURCHASE` | user has ≥1 completed order (purchase legitimacy) | positive |
| `RETURN_RATE` | lifetime returns ÷ lifetime purchases | negative |
| `RECENT_RETURN_RATE_90D` | returns in last 90d ÷ purchases in last 90d | negative |
| `BRACKETING_FLAG` | see Task 3.2 | negative |
| `WARDROBE_FLAG` | see Task 3.2 | negative |

**Scoring algorithm:**
1. Normalise each raw signal to a 0–1 contribution (e.g. account age saturates at
   ~365 days → 1.0; lifetime purchases saturate at e.g. 25; return rates inverted).
2. Weighted sum using `TRUST_SIGNALS[key].weight`, respecting `direction`
   (positive adds, negative subtracts from a baseline).
3. Scale to 0–100 → `score`.
4. Map `score` → `tier` using `TIER_THRESHOLDS` (verified 90+, trusted 75+,
   standard 50+, watch 30+, restricted <30).
5. **Hard overrides** (independent of score):
   - `User.banned` → `restricted`.
   - `returnRate ≥ CRITICAL_RETURN_RATE (0.65)` → `restricted`.
   - `returnRate ≥ HIGH_RETURN_RATE (0.40)` → at most `watch`.
   - The brief's canonical case: many purchases + first-ever return → keep `trusted`/`verified`
     (the high `LIFETIME_PURCHASES` + low `RETURN_RATE` should produce this naturally;
     verify with a test).
6. Persist via upsert (`findOneAndUpdate({ userId }, …, { upsert: true })`), writing
   the full `signals[]` array (signal, value, weight, direction) for explainability,
   plus `lastComputed = now`.

**Output:** A persisted `TrustProfile` matching the contract exactly.

---

### Task 3.2 — Pattern detectors (bracketing + wardrobing)

**What:** Two focused aggregation helpers, used by Task 3.1.

1. **Bracketing fingerprint** — repeated multi-size/multi-colour purchases of the same
   SKU with all-but-one returned.
   - Heuristic with current schema: group the user's orders by `productId`; if any SKU
     has `≥ BRACKETING_SAME_PRODUCT_COUNT (2)` orders within a short window and a
     return exists for ≥ all-but-one of them, set `bracketingFlag = true`.
   - Guard with `BRACKETING_MIN_ORDERS (3)` so new users aren't flagged.
   - Note: true size/colour variants aren't modelled yet, so approximate via
     same-`productId` repeat purchases. Document this as a hackathon approximation.

2. **Wardrobing detector** — items consistently returned near the end of the return
   window ("buy, use, return").
   - For each return, compute `daysHeld = Return.createdAt - Order.createdAt`.
   - If a user's returns cluster near `WARDROBE_DAYS_WINDOW (30)` days (e.g. median
     daysHeld ≥ ~25 across ≥2 returns), set `wardrobingFlag = true`.

**Output:** Two booleans fed into the score; reasons captured in `signals[]`.

---

### Task 3.3 — Cross-cutting fraud signals (PULL from `grades`, plus manual API)

**What:** Fold Phase 2's fraud annotations into the trust score. Per the locked P2
contract, grading writes a `fraudCheck` block on each grade document — P3 **reads** it.

**Primary path — pull from `grades` (read-only):**
- During `computeTrustProfile`, query the user's grade documents and read each
  `fraudCheck` block: `{ phash_match, exif_has_camera_data, rekognition_web_match, classification }`.
- Derive normalised fraud signals:
  - `phash_match === true` → **hard fraud** (stock/catalog photo lifted).
  - `rekognition_web_match === true` → **hard fraud** (image exists on open web).
  - `exif_has_camera_data === false` → **soft fraud** (metadata stripped; weak alone).
  - `classification === 'hard_fraud'` → trust P2's verdict directly.
- Count `hardFraudHits` and `softFraudHits` across the user's grades.

**Secondary path — manual/mocked ingestion API:**
- `addFraudSignal(userId, signal, value, direction)` for signals not on the grade doc
  yet: `PHOTO_OF_SCREEN` (moiré), `TIME_TO_RETURN_ANOMALY`, `LOCKER_WEIGHT_MISMATCH`
  (mocked empty-box / item-swap). Appends to `signals[]` and re-scores.
- `POST /api/trust/:userId/signals` → `{ signal, value, direction }`.

**Fraud → tier clamping (applied AFTER the weighted history score):**
- `hardFraudHits >= 1` → tier capped at `watch`.
- `hardFraudHits >= 2` → forced `restricted`.
- `softFraudHits >= 1` → −15 points off score (soft, not decisive alone).
- `softFraudHits >= 1` **AND** any negative history flag (bracketing / wardrobing /
  high return rate) → escalate one tier downward (soft+pattern = strong combined signal).

> P2 owns producing `fraudCheck`; P3 owns reading it and all scoring. Until P2 lands,
> `seed-trust.js`/tests write sample `fraudCheck` blocks (or use the manual API) to
> prove tier divergence.

---

### Task 3.4 — Service API surface + lazy recompute

**What:** Finalise the public service functions.

- `getTrustProfile(userId)` — **P1's required interface.** Returns `{ tier, score }`
  (the full profile object, which includes `tier` and `score`, satisfies this) or
  `null` if the user can't be resolved. Fetch profile; if missing **or** `lastComputed`
  older than a TTL (24h, or `TRUST_RECOMPUTE_TTL_HOURS` env), recompute then return.
  This exact name + return shape is a frozen contract with the P1 teammate.
- `computeTrustProfile(userId)` — force compute + upsert (Tasks 3.1–3.2).
- `addFraudSignal(...)` — Task 3.3.
- `listFlaggedProfiles({ tier, page, limit })` — for the admin/seller dashboard
  (Watch/Restricted users, or non-empty fraud signals).

Keep functions pure-ish and dependency-light so P4 can import the service directly
(`require('../trust/trust.service')`) without an HTTP hop.

---

### Task 3.5 — Controllers, routes, validation

**What:** Wire the service to HTTP, all inside the P3-owned trust module files.

**Endpoints (extend `trust.routes.js` — already mounted at `/api/trust`):**

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | already exists |
| `GET` | `/:userId` | get (lazy-compute) a user's trust profile |
| `POST` | `/:userId/recompute` | force recompute |
| `POST` | `/:userId/signals` | ingest a cross-cutting fraud signal (Task 3.3) |
| `GET` | `/admin/flagged` | list watch/restricted/flagged profiles (dashboard) |

- Implement the three currently-stubbed/501 controllers + the two new ones.
- Add real validation in `trust.validation.js` (valid ObjectId for `:userId`; for
  `/signals`, `signal` is a known key, `direction ∈ {positive,negative}`).
- Use the existing error-handling pattern (`next(error)` → `error.middleware`).

**Auth note:** `getTrustProfile`/`recompute` should be self-or-admin; `/admin/flagged`
admin-only. Reuse the existing `auth.middleware`. Flag clearly if the middleware's
admin check needs a helper — but **don't modify the middleware** if avoidable; gate in
the controller instead to stay merge-safe.

---

### Task 3.6 — Integration seam for Phase 1 (no P1 file edits)

**What:** Ship the hook P1 will call, without touching P1's files.

- Export a tiny Express middleware from the trust module,
  `attachTrustProfile(req, res, next)`, that resolves `req.user`/`req.params.userId`
  → `req.trustProfile = await getTrustProfile(userId)`. P1 (or P4) can mount it on
  their routes with one line when they're ready.
- Document the agreed field: P1 stores `trustTierAtIntake` on the return/secondhand
  record. **P3 does not add this field** (it lives on P1's models); P3 only provides
  the value. Add a one-paragraph note to the integration contract in chat + this doc.
- Provide a short usage snippet in the trust module's header comment so P1 can copy it.

**Result:** Zero overlap with P1's working tree; integration is a single import + call
that merges cleanly.

---

### Task 3.7 — Demo seed augmentation (separate file)

**What:** `backend/seed-trust.js` — idempotent, additive, never edits base `seed.js`.

Creates/garantees the trust-tier demo scenarios on top of existing seeded users:
- **Genuine power user:** ~40 completed orders, 0–1 returns → computes to `verified`/`trusted`.
- **Watch-tier user:** return rate ~0.45 (above `HIGH_RETURN_RATE`) → `watch`.
- **Restricted user:** return rate ≥0.65 and/or `banned` → `restricted`, or carries two
  hard fraud signals injected via `addFraudSignal`.
- **Wardrobing user:** several returns all near 28–30 days held → `wardrobingFlag`.
- **Bracketing user:** repeat same-`productId` orders, all-but-one returned → `bracketingFlag`.

Run with `node seed-trust.js`. Re-runnable (clears only the trust artefacts it created).

---

### Task 3.8 — Trust badge component (frontend, optional / merge-safe)

**What:** A single self-contained React component `<TrustBadge userId />` that calls
`GET /api/trust/:userId` and renders tier (colour-coded) + score + top reasons.

- Lives in its own folder; imports nothing P1 owns.
- P1/P4 can drop it into intake/routing screens later. **Do not** wire it into shared
  nav/layout this phase — leave that to the P9 integration pass or coordinate first.
- If frontend time is tight, this is the one task to defer; the backend + admin JSON
  is the demo-critical deliverable.

---

### Task 3.9 — Tests & verification

**What:** Prove tier divergence and the canonical brief cases.

- Unit-test the scoring math against the seeded personas:
  - 40 purchases + first return → not penalised (trusted/verified).
  - 45% return rate → `watch`.
  - 65%+ return rate or banned → `restricted`.
  - wardrobing/bracketing flags set on the crafted users.
- Endpoint smoke tests: `GET /:userId`, `POST /:userId/recompute`,
  `POST /:userId/signals` flips tier downward, `GET /admin/flagged` returns the
  watch/restricted set.
- Confirm lazy recompute fires when `lastComputed` is stale.
- Run the backend, hit each endpoint (curl/REST client), confirm no regressions to
  existing routes.

---

## How to Judge a Customer — Good vs Fraud (Detection Criteria)

This is the heart of the phase. The goal: **a genuine customer should be obvious in one
glance, and a fraudster should trip at least one sharp tripwire.** We use a two-layer
model — a smooth weighted score for "how good," plus hard tripwires for "definitely bad."

### Layer 1 — Trust-building signals (push score UP)

| Signal | "Good customer" reading | Normalisation (raw → 0–100) | Weight |
|---|---|---|---|
| Account age | Established account, not freshly minted for abuse | 0d→0, saturates 365d→100 | 0.10 |
| Lifetime purchases | Real buying history, skin in the game | 0→0, saturates 25 orders→100 | 0.15 |
| Verified purchase | Has ≥1 completed order | yes→100 / no→0 | 0.05 |
| Return rate (inverse) | Rarely returns | 0%→100, ≥40%→0 (linear) | 0.25 |
| Recent-90d rate (inverse) | No recent spike | 0%→100, ≥50%→0 (linear) | 0.20 |
| No bracketing | Doesn't buy-many-return-most | clean→100 / flagged→0 | 0.15 |
| No wardrobing | Doesn't buy-use-return | clean→100 / flagged→0 | 0.10 |

`score = Σ(normalised × weight)` → 0–100. All signals start at 100 (innocent until
proven otherwise); bad behaviour pulls the score down.

### Layer 2 — Fraud tripwires (override the score downward)

These are sharp, behaviour-based, and hard to fake. They clamp the tier regardless of
how good the Layer-1 score looks:

| Tripwire | Source | Verdict |
|---|---|---|
| `User.banned` | users | → `restricted` (kill switch) |
| Lifetime return rate ≥ 0.65 | orders + returns | → `restricted` |
| Lifetime return rate ≥ 0.40 | orders + returns | cap at `watch` |
| **Sudden-shift:** 90d rate ≥ 2× lifetime rate AND 90d rate ≥ 0.30 | returns | cap at `watch` (pattern change = classic account takeover / turned-bad) |
| `phash_match` true OR `rekognition_web_match` true (any grade) | grades.fraudCheck | hard fraud → cap at `watch`; 2+ → `restricted` |
| `exif_has_camera_data` false (soft) | grades.fraudCheck | −15 pts; escalate a tier if combined with any pattern flag |
| Bracketing AND wardrobing both set | orders + returns | → `watch` |
| `LOCKER_WEIGHT_MISMATCH` (mocked) | manual signal | hard fraud (empty-box/swap) |

### The decision summary (what each profile "looks like")

**A trusted customer (Verified / Trusted, score ≥ 75):**
- Account age > ~180 days, ≥ 10 lifetime purchases.
- Lifetime return rate < ~15%, no 90-day spike.
- No bracketing / wardrobing flags.
- Zero hard fraud hits from grades.
- *Canonical case:* 40 purchases, first-ever return → ~98 → **Verified**. The system
  must NOT punish a long-loyal customer's first return. (DoD test #4.)

**A standard customer (score 50–74):**
- Thinner history (new but clean) or a modest return rate (15–40%).
- No tripwires. Default flow, no friction.
- *New account, zero history* → ~70 → **Trusted-ish**: innocent until proven, but the
  low account-age + no-purchase contributions keep them out of Verified.

**A bad / fraud customer (Watch / Restricted, score < 50 OR any tripwire):**
- Return rate ≥ 40% (watch) or ≥ 65% (restricted).
- A sudden 90-day return spike vs lifetime baseline (turned-bad / takeover).
- Bracketing (buys 4 sizes, keeps 1, returns 3) + wardrobing (returns at day 28–30).
- Any stock-photo / web-match hit from grading → photo fraud.
- Banned, or 2+ hard fraud hits → restricted, manual review only.

### Why these criteria are "easily detectable"

- **Return rate** is the single strongest, cheapest separator — one division over data
  we already have. Weighted highest (0.25).
- **Sudden-shift detection** (90d vs lifetime) catches accounts that *were* good and
  turned bad — a pure-threshold model misses these, so it's a dedicated tripwire.
- **Bracketing + wardrobing** are behavioural, not gameable by a single nice photo.
- **Grade-side photo fraud** (phash/web-match) is the hard, near-binary signal — when
  it fires, intent is clear, so it clamps the tier directly rather than just nudging the
  score.
- Layering a smooth score UNDER hard tripwires means: genuine users glide through, and a
  fraudster has to beat *every* tripwire, not just average out a good-looking score.

### Tunable knobs (change these to sharpen detection)

All live in `trustProfile.contract.js` (extend, don't rewrite) or a small local consts
block, so we can retune during the demo without touching logic:
- Saturation points (365d age, 25 purchases) — lower them to reward smaller histories.
- Return-rate floors (0.40 watch / 0.65 restricted) — already in contract.
- Sudden-shift multiplier (2×) and floor (0.30) — new tunables.
- Soft-fraud penalty (−15) and hard-fraud counts (1 → watch, 2 → restricted).

---

## Execution Order & Dependencies

```
Task 3.1 (scoring core) ──► Task 3.2 (pattern detectors) ──► Task 3.4 (service API)
        │                                                          │
        └──► Task 3.3 (fraud-signal ingestion) ───────────────────┤
                                                                   ▼
                                              Task 3.5 (controllers/routes/validation)
                                                                   │
                    ┌──────────────────────────────────────────────┼───────────────┐
                    ▼                          ▼                     ▼               ▼
            Task 3.6 (P1 seam)        Task 3.7 (seed-trust)   Task 3.8 (badge)  Task 3.9 (tests)
```

**Critical path:** 3.1 → 3.2 → 3.4 → 3.5 → 3.9.
**Parallelizable:** 3.3 alongside 3.1/3.2; 3.6, 3.7, 3.8 after 3.5.

---

## Estimated Time

| Task | Time |
|---|---|
| 3.1 Scoring core | 60 min |
| 3.2 Pattern detectors | 45 min |
| 3.3 Fraud-signal ingestion API | 30 min |
| 3.4 Service API + lazy recompute | 20 min |
| 3.5 Controllers / routes / validation | 30 min |
| 3.6 Integration seam for P1 | 20 min |
| 3.7 seed-trust.js | 40 min |
| 3.8 TrustBadge component (optional) | 40 min |
| 3.9 Tests & verification | 40 min |

**Total (sequential, incl. optional FE):** ~5 hours
**Backend-only critical path:** ~3 hours

---

## Definition of Done

When ALL of the following are true, Phase 3 is complete:

1. ✅ `computeTrustProfile(userId)` produces a contract-correct `TrustProfile` from
   real order/return history, with explainable `signals[]`.
2. ✅ Bracketing and wardrobing flags compute correctly on crafted users.
3. ✅ Score → tier mapping respects `TIER_THRESHOLDS` plus the hard overrides
   (banned, critical/high return-rate).
4. ✅ The canonical brief case (40 purchases, first return) resolves to a high tier —
   covered by a passing test.
5. ✅ `POST /api/trust/:userId/signals` ingests a cross-cutting fraud signal and
   re-scores, demonstrably dropping the tier.
6. ✅ `GET /api/trust/:userId` lazily recomputes when stale; `/admin/flagged` lists
   watch/restricted users.
7. ✅ `attachTrustProfile` middleware + documented integration contract exist; **no P1
   files, `server.js`, or base `seed.js` were modified.**
8. ✅ `node seed-trust.js` reproducibly creates the five trust-tier demo personas.
9. ✅ Tests pass; all existing routes still work.
10. ✅ (Optional) `<TrustBadge>` renders tier + score for a given user.

---

## Open Questions / Coordinate With Team

- **Field ownership:** Confirm with P1 that `trustTierAtIntake` lives on their
  return/secondhand models and they call `getTrustProfile` at initiation.
- **Auth admin check:** Confirm the existing `auth.middleware` exposes a role/admin
  flag we can gate `/admin/flagged` on without modifying the middleware.
- **Device/payment fingerprint signal:** `Order.paymentDetails.mockCreditCard` is the
  only fingerprint available. Decide whether to implement a light "same card across N
  accounts returning same SKU" detector now or defer to P9 (recommend defer — low demo
  ROI, higher cross-collection complexity).
- **Frontend nav wiring:** Defer mounting `<TrustBadge>` into shared layout until a
  coordinated integration pass to avoid conflicts with P1's nav changes.



  -->TODO-> think of logic
