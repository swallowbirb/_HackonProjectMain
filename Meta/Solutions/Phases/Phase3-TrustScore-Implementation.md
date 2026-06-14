# Phase 3 — Trust Score & Fraud Defence — DETAILED Implementation Guide

> Companion to `Phase3-TrustScore.md` (the plan). This document is the **build-level**
> reference: every file to touch, every function signature, the exact scoring math,
> worked examples, fraud-clamping logic, endpoint contracts, validation rules, the seed
> script, and the test matrix. Follow this top-to-bottom and Phase 3 is done.

---

## 0. Ground Rules (read before writing a single line)

**Folders / files I MUST NOT touch (teammates own them):**
- `backend/src/modules/returns/**` (P1)
- `backend/src/modules/secondhand/**` (P1)
- `backend/src/modules/items/**` (P1, if present)
- `backend/src/modules/grading/**` and the `grades` collection writes (P2 — I only READ)
- `backend/server.js` (route already registered)
- `backend/seed.js` (base seed — I add a separate file instead)
- `backend/src/middleware/auth.middleware.js` (gate in controllers instead)
- `backend/src/contracts/trustProfile.contract.js` (frozen — append-only if unavoidable)

**Files I OWN and will create/edit:**
- `backend/src/modules/trust/trust.service.js` (main logic)
- `backend/src/modules/trust/trust.controller.js`
- `backend/src/modules/trust/trust.routes.js`
- `backend/src/modules/trust/trust.validation.js`
- `backend/src/modules/trust/trust.scoring.js` (NEW — pure scoring functions, no DB)
- `backend/src/modules/trust/trust.middleware.js` (NEW — `attachTrustProfile`)
- `backend/seed-trust.js` (NEW — additive demo seed)
- `backend/src/modules/trust/__tests__/trust.scoring.test.js` (NEW — unit tests)

**The two frozen interfaces:**
1. **P1:** `trust.service.js` exports `getTrustProfile(userId)` → `{ tier, score, ... }` or `null`.
2. **P2:** I read `grades` docs' `fraudCheck = { phash_match, exif_has_camera_data, rekognition_web_match, classification }`.

**Writes:** Phase 3 writes ONLY to the `trustProfiles` collection.

---

## 1. Architecture of the Trust Module

```
                         ┌─────────────────────────────┐
  P1 / P4 code ─────────►│ trust.service.js            │
  (getTrustProfile)      │  • getTrustProfile()        │
                         │  • computeTrustProfile()    │
  HTTP (Express) ───────►│  • addFraudSignal()         │
  trust.routes.js        │  • listFlaggedProfiles()    │
       │                 └──────────────┬──────────────┘
       │                                │ calls (pure, no DB)
       ▼                                ▼
  trust.controller.js          ┌─────────────────────────────┐
  trust.validation.js          │ trust.scoring.js (PURE)      │
  trust.middleware.js          │  • normalizeSignals()        │
                               │  • computeScore()            │
                               │  • scoreToTier()             │
                               │  • applyFraudClamps()        │
                               │  • assembleProfile()         │
                               └─────────────────────────────┘
                                            │ reads
              ┌─────────────────────────────┼─────────────────────────────┐
              ▼              ▼               ▼              ▼               ▼
          orders        returns           users      secondhandItems     grades
        (read-only)   (read-only)      (read-only)    (read-only)     (read-only)
                                            │
                                            ▼ writes
                                      trustProfiles
```

**Why split `trust.scoring.js` out:** the scoring math is pure (inputs → outputs, no
DB, no async). Isolating it makes it trivially unit-testable and lets us retune knobs
without risking the DB plumbing. `trust.service.js` does the I/O (fetch raw data → call
scoring → persist).

---

## 2. Constants & Tunable Knobs

The contract (`trustProfile.contract.js`) already exports `TRUST_TIERS`,
`TIER_THRESHOLDS`, `TRUST_SIGNALS`, `RETURN_RATE_THRESHOLDS`. **Do not edit it.**

Add a LOCAL constants block at the top of `trust.scoring.js` for the things the contract
doesn't cover (saturation points, sudden-shift, fraud penalties). Keep them in one place
so demo-day retuning is a one-line change:

```js
// trust.scoring.js — local tunables (contract stays frozen)
const SCORING = {
  ACCOUNT_AGE_SATURATION_DAYS: 365,   // age that maps to full marks
  PURCHASES_SATURATION_COUNT: 25,     // purchase count that maps to full marks
  RETURN_RATE_ZERO_AT: 0.40,          // return rate where the inverse signal hits 0
  RECENT_RATE_ZERO_AT: 0.50,          // 90d return rate where the inverse signal hits 0

  SUDDEN_SHIFT_MULTIPLIER: 2.0,       // 90d rate >= 2x lifetime rate ...
  SUDDEN_SHIFT_FLOOR: 0.30,           // ... AND 90d rate >= 0.30  => watch

  SOFT_FRAUD_PENALTY: 15,             // points removed per soft-fraud cluster
  HARD_FRAUD_CAP_WATCH: 1,            // >=1 hard hit => cap at watch
  HARD_FRAUD_FORCE_RESTRICTED: 2,     // >=2 hard hits => restricted

  STALE_TTL_HOURS: Number(process.env.TRUST_RECOMPUTE_TTL_HOURS || 24),
};
```

Pull these from the contract (do NOT redefine):
- `TIER_THRESHOLDS` → verified 90, trusted 75, standard 50, watch 30, restricted 0.
- `TRUST_SIGNALS[key].weight` → the 7 weights below.
- `RETURN_RATE_THRESHOLDS.HIGH_RETURN_RATE` (0.40), `.CRITICAL_RETURN_RATE` (0.65),
  `.BRACKETING_MIN_ORDERS` (3), `.BRACKETING_SAME_PRODUCT_COUNT` (2),
  `.WARDROBE_DAYS_WINDOW` (30).

**Weights (from contract, sum = 1.00):**

| Contract key | Weight | Direction |
|---|---|---|
| `ACCOUNT_AGE_DAYS` | 0.10 | positive |
| `LIFETIME_PURCHASES` | 0.15 | positive |
| `VERIFIED_PURCHASE` | 0.05 | positive |
| `RETURN_RATE` | 0.25 | negative |
| `RECENT_RETURN_RATE_90D` | 0.20 | negative |
| `BRACKETING_FLAG` | 0.15 | negative |
| `WARDROBE_FLAG` | 0.10 | negative |

---

## 3. The Scoring Math (exact formulas)

Every signal is normalised to a **0–100 contribution score** where **100 = good**.
Negative signals are inverted so "clean" = 100 and "bad" pulls toward 0.

### 3.1 Per-signal normalisation

```
ageScore        = min(accountAgeDays / 365, 1) * 100
purchasesScore  = min(lifetimePurchases / 25, 1) * 100
verifiedScore   = lifetimePurchases >= 1 ? 100 : 0

returnRateScore = max(1 - (returnRate / 0.40), 0) * 100
recent90dScore  = max(1 - (recentReturnRate90d / 0.50), 0) * 100

bracketingScore = bracketingFlag ? 0 : 100
wardrobeScore   = wardrobingFlag ? 0 : 100
```

Edge case: a user with **zero purchases** has an undefined return rate. Treat
`returnRate = 0` and `recentReturnRate90d = 0` (no returns yet → no penalty), so
`returnRateScore = 100`. This is intentional (innocent until proven).

### 3.2 Weighted sum → raw score

```
rawScore =
    ageScore        * 0.10
  + purchasesScore  * 0.15
  + verifiedScore   * 0.05
  + returnRateScore * 0.25
  + recent90dScore  * 0.20
  + bracketingScore * 0.15
  + wardrobeScore   * 0.10

// rawScore is already 0–100 (weighted average of 0–100 values)
```

### 3.3 Apply fraud adjustments (from Task 3.3)

```
score = rawScore - (softFraudHits > 0 ? SOFT_FRAUD_PENALTY : 0)
score = clamp(score, 0, 100)
```

### 3.4 Score → tier

```
if score >= 90 → verified
elif score >= 75 → trusted
elif score >= 50 → standard
elif score >= 30 → watch
else → restricted
```

### 3.5 Hard tripwires (override tier downward — applied LAST)

Order matters: compute the tier from score, then apply the strongest applicable clamp.

```
tier = scoreToTier(score)

// kill switches → restricted
if user.banned                                   → restricted
if returnRate >= 0.65                            → restricted
if hardFraudHits >= 2                            → restricted

// caps → at most watch
if returnRate >= 0.40                            → min(tier, watch)
if suddenShift                                   → min(tier, watch)
if hardFraudHits >= 1                            → min(tier, watch)
if bracketingFlag && wardrobingFlag              → min(tier, watch)
if softFraudHits >= 1 && anyPatternFlag          → escalate one tier down

where:
  suddenShift = (recentReturnRate90d >= 2.0 * returnRate) && (recentReturnRate90d >= 0.30)
  anyPatternFlag = bracketingFlag || wardrobingFlag || (returnRate >= 0.40)
  min(tier, watch) means "no better than watch" (clamp upward tiers down to watch)
```

Implement `min(tier, X)` via tier rank: `verified=4, trusted=3, standard=2, watch=1, restricted=0`; clamp = `rank = Math.min(rank, targetRank)`.

---

## 4. Worked Examples (verification targets — bake into tests)

### Persona A — Genuine power user (Priya): 40 purchases, 1 return, 730d old

| Signal | Raw | Normalised | ×Weight | Contribution |
|---|---|---|---|---|
| Account age | 730d | 100 | 0.10 | 10.0 |
| Lifetime purchases | 40 | 100 | 0.15 | 15.0 |
| Verified | yes | 100 | 0.05 | 5.0 |
| Return rate | 1/40 = 0.025 | 93.75 | 0.25 | 23.4 |
| Recent 90d | 0 | 100 | 0.20 | 20.0 |
| Bracketing | false | 100 | 0.15 | 15.0 |
| Wardrobe | false | 100 | 0.10 | 10.0 |
| **rawScore** | | | | **98.4** |

No tripwires → **score 98 → Verified ✅** (canonical brief case: loyal customer's first
return is NOT punished).

### Persona B — Watch user: 20 purchases, 45% return rate, 180d old

| Signal | Raw | Normalised | ×Weight | Contribution |
|---|---|---|---|---|
| Account age | 180d | 49.3 | 0.10 | 4.9 |
| Purchases | 20 | 80 | 0.15 | 12.0 |
| Verified | yes | 100 | 0.05 | 5.0 |
| Return rate | 0.45 | 0 | 0.25 | 0.0 |
| Recent 90d | 0.45 | 10 | 0.20 | 2.0 |
| Bracketing | false | 100 | 0.15 | 15.0 |
| Wardrobe | false | 100 | 0.10 | 10.0 |
| **rawScore** | | | | **48.9** |

scoreToTier(48.9) = standard, BUT `returnRate 0.45 ≥ 0.40` → cap at **Watch ✅**.

### Persona C — Restricted user: 70% return rate

`returnRate 0.70 ≥ 0.65` → **Restricted ✅** (kill switch; score ~22 would land there anyway).

### Persona D — Wardrobing user: mid-history + wardrobingFlag

wardrobeScore drops to 0 (loses 10 weighted pts). Combined with a moderate return rate,
slides standard → **Watch** via the soft+pattern escalation. `wardrobingFlag` visible in
`signals[]`.

### Persona E — Sudden-shift user: 30 lifetime purchases, lifetime rate 10%, but 90d rate 40%

`returnRate = 0.10` (looks fine), `recentReturnRate90d = 0.40`.
`suddenShift = (0.40 ≥ 2.0×0.10=0.20) && (0.40 ≥ 0.30)` → true → cap at **Watch ✅**.
This is the case a flat-threshold model would miss — the account *was* good.

### Persona F — New account, zero history, 5d old

| Signal | Normalised | ×Weight | Contribution |
|---|---|---|---|
| Account age (5d) | 1.4 | 0.10 | 0.1 |
| Purchases (0) | 0 | 0.15 | 0.0 |
| Verified (no) | 0 | 0.05 | 0.0 |
| Return rate (0) | 100 | 0.25 | 25.0 |
| Recent 90d (0) | 100 | 0.20 | 20.0 |
| Bracketing (false) | 100 | 0.15 | 15.0 |
| Wardrobe (false) | 100 | 0.10 | 10.0 |
| **rawScore** | | | **70.1 → Trusted** |

Intentional: no history ≠ guilty. They land at Trusted (not Verified — they haven't
earned the age/purchase marks).

### Persona G — Photo-fraud user: clean history but 1 phash_match grade

rawScore high (say 80), but `hardFraudHits = 1` → cap at **Watch**. Two hard hits → **Restricted**.

---

## 5. File-by-File Build

### 5.1 `trust.scoring.js` (NEW — pure, no DB, no async)

**Responsibility:** all math. Input is a plain object of raw facts; output is a plain
profile object. No mongoose, no awaits. This is what the tests hammer.

**Exports:**

```js
module.exports = {
  SCORING,                 // the tunables block (section 2)
  normalizeSignals,        // (facts) -> { ageScore, purchasesScore, ... , contributions[] }
  computeRawScore,         // (normalised) -> Number 0-100
  scoreToTier,             // (Number) -> tier string
  clampTier,               // (tier, maxTier) -> tier string  (downward clamp)
  applyTripwires,          // (tier, facts) -> { tier, appliedTripwires[] }
  assembleProfile,         // (facts) -> { tier, score, signals[], flags... }  (orchestrator)
};
```

**`facts` input shape (built by the service from DB reads):**

```js
{
  accountAgeDays: Number,
  lifetimePurchases: Number,
  lifetimeReturns: Number,
  returnRate: Number,            // 0..1
  recentReturnRate90d: Number,   // 0..1
  bracketingFlag: Boolean,
  wardrobingFlag: Boolean,
  banned: Boolean,
  hardFraudHits: Number,
  softFraudHits: Number,
}
```

**`assembleProfile(facts)` algorithm (pseudocode):**

```
norm   = normalizeSignals(facts)
raw    = computeRawScore(norm)
score  = clamp(raw - (facts.softFraudHits > 0 ? SOFT_FRAUD_PENALTY : 0), 0, 100)
tier0  = scoreToTier(score)
{ tier, appliedTripwires } = applyTripwires(tier0, facts)

return {
  tier,
  score: Math.round(score),
  signals: norm.contributions,   // [{ signal, value, weight, direction, contribution }]
  appliedTripwires,              // ["RETURN_RATE_HIGH", "SUDDEN_SHIFT", ...] for explainability
  flags: { bracketingFlag, wardrobingFlag },
}
```

**`normalizeSignals` returns a `contributions[]` array** matching the contract's
`signals[]` shape so the persisted profile is self-explaining:

```js
contributions = [
  { signal: 'ACCOUNT_AGE_DAYS', value: 730, weight: 0.10, direction: 'positive', contribution: 10.0 },
  { signal: 'RETURN_RATE',      value: 0.025, weight: 0.25, direction: 'negative', contribution: 23.4 },
  ... // one per signal
]
```

**`applyTripwires` returns the applied tripwires** so `/admin/flagged` and the UI can
say *why* a user is gated. Apply in this precedence (strongest wins):

```
1. banned                      -> restricted
2. returnRate >= 0.65          -> restricted
3. hardFraudHits >= 2          -> restricted
4. returnRate >= 0.40          -> clampTier(tier, 'watch')
5. suddenShift                 -> clampTier(tier, 'watch')
6. hardFraudHits >= 1          -> clampTier(tier, 'watch')
7. bracketing && wardrobing    -> clampTier(tier, 'watch')
8. softFraudHits>=1 && pattern -> clampTier(tier, oneTierDown(tier))
```

---

### 5.2 `trust.service.js` (REPLACE the stub — DB I/O + orchestration)

**Imports:** `TrustProfile` model, `Order`, `Return`, `User`, `SecondhandItem`, `Grade`
(read-only), the contract, and `trust.scoring.js`.

> NOTE on requiring P2's model: require it lazily/defensively so Phase 3 doesn't crash if
> the grading model file isn't merged yet:
> ```js
> let Grade = null;
> try { Grade = require('../grading/grading.model'); } catch (_) { Grade = null; }
> ```
> If `Grade` is null, `hardFraudHits = softFraudHits = 0` (no fraud data yet).

**Function 1 — `gatherFacts(userId)` (private helper):**

```
user = await User.findById(userId).lean()
if (!user) return null

accountAgeDays = floor((now - user.createdAt) / 86400000)

lifetimePurchases = await Order.countDocuments({ buyerId: userId, status: 'completed' })
lifetimeReturns   = await Return.countDocuments({ userId })

// 90-day window
since90 = now - 90*86400000
purchases90 = await Order.countDocuments({ buyerId: userId, status:'completed', createdAt: { $gte: since90 } })
returns90   = await Return.countDocuments({ userId, createdAt: { $gte: since90 } })

returnRate          = lifetimePurchases > 0 ? lifetimeReturns / lifetimePurchases : 0
recentReturnRate90d = purchases90 > 0 ? returns90 / purchases90 : 0

bracketingFlag = await detectBracketing(userId)        // section 5.3
wardrobingFlag = await detectWardrobing(userId)         // section 5.3
{ hardFraudHits, softFraudHits } = await readFraudSignals(userId)  // section 5.4

return { accountAgeDays, lifetimePurchases, lifetimeReturns, returnRate,
         recentReturnRate90d, bracketingFlag, wardrobingFlag,
         banned: !!user.banned, hardFraudHits, softFraudHits }
```

**Function 2 — `computeTrustProfile(userId)`:**

```
facts = await gatherFacts(userId)
if (!facts) return null
profile = assembleProfile(facts)   // pure scoring

doc = await TrustProfile.findOneAndUpdate(
  { userId },
  {
    userId,
    tier: profile.tier,
    score: profile.score,
    signals: profile.signals,
    accountAge: facts.accountAgeDays,
    lifetimePurchases: facts.lifetimePurchases,
    lifetimeReturns: facts.lifetimeReturns,
    returnRate: facts.returnRate,
    recentReturnRate90d: facts.recentReturnRate90d,
    bracketingFlag: facts.bracketingFlag,
    wardrobingFlag: facts.wardrobingFlag,
    lastComputed: new Date(),
  },
  { upsert: true, new: true, setDefaultsOnInsert: true }
).lean()

return doc
```

**Function 3 — `getTrustProfile(userId)` (P1's frozen interface):**

```
existing = await TrustProfile.findOne({ userId }).lean()
isStale = !existing || (now - existing.lastComputed) > STALE_TTL_HOURS*3600*1000
if (isStale) {
  const fresh = await computeTrustProfile(userId)
  return fresh   // null if user not found  -> satisfies "{tier,score} or null"
}
return existing  // contains tier + score
```

**Function 4 — `addFraudSignal(userId, signal, value, direction)`:**

```
profile = await TrustProfile.findOne({ userId })
if (!profile) { await computeTrustProfile(userId); profile = await TrustProfile.findOne({ userId }) }
if (!profile) return null

profile.signals.push({ signal, value, weight: 0, direction: direction || 'negative' })
await profile.save()
// re-run full compute so the new signal influences fraud counts/score
return await computeTrustProfile(userId)
```

> For the manual API, persist the injected signal somewhere `readFraudSignals` can see it.
> Simplest: keep a tiny `manualFraudSignals` array on the TrustProfile doc (append-only)
> and count hard/soft from it in `readFraudSignals`. (This is an append to OUR model only.)

**Function 5 — `listFlaggedProfiles({ tier, page = 1, limit = 20 })`:**

```
filter = tier ? { tier } : { tier: { $in: ['watch','restricted'] } }
[items, total] = await Promise.all([
  TrustProfile.find(filter).sort({ score: 1 }).skip((page-1)*limit).limit(limit).lean(),
  TrustProfile.countDocuments(filter),
])
return { items, total, page, limit, totalPages: ceil(total/limit) }
```

**Exports:** `{ getTrustProfile, computeTrustProfile, addFraudSignal, listFlaggedProfiles }`.

---

### 5.3 Pattern detectors (inside `trust.service.js`)

**`detectBracketing(userId)`:**

```
orders = await Order.find({ buyerId: userId, status: 'completed' }).select('productId createdAt').lean()
if (orders.length < BRACKETING_MIN_ORDERS) return false      // 3

groupByProduct = group orders by productId (skip null productId)
for each productId group with count >= BRACKETING_SAME_PRODUCT_COUNT (2):
    orderIds = ids of that group
    returnsForGroup = await Return.countDocuments({ userId, orderId: { $in: orderIds } })
    if (returnsForGroup >= group.length - 1) return true     // kept <=1, returned the rest
return false
```

> Hackathon approximation note: real size/colour variants aren't modelled, so we proxy
> "bought 4 sizes" with "bought same productId multiple times." Document in code comment.

**`detectWardrobing(userId)`:**

```
returns = await Return.find({ userId }).select('orderId createdAt').lean()
if (returns.length < 2) return false

daysHeldList = []
for each ret:
    order = await Order.findById(ret.orderId).select('createdAt').lean()
    if (order) daysHeldList.push((ret.createdAt - order.createdAt)/86400000)

if (daysHeldList.length < 2) return false
median = median(daysHeldList)
return median >= (WARDROBE_DAYS_WINDOW - 5)   // >= ~25 of a 30-day window
```

> Optimisation: batch-fetch orders with `Order.find({ _id: { $in: orderIds } })` instead
> of N queries. Build a Map for O(1) lookup.

---

### 5.4 `readFraudSignals(userId)` (reads P2's `grades` + our manual signals)

```
let hardFraudHits = 0, softFraudHits = 0

if (Grade) {
  // grades link to items; in hackathon scope, query grades by the user's items.
  // Pragmatic approach: grades store a userId or we resolve via the item.
  // If grade docs are reachable by userId, query directly; else skip gracefully.
  grades = await Grade.find({ /* userId or itemId in user's items */ }).select('fraudCheck').lean()
  for each g with g.fraudCheck:
      fc = g.fraudCheck
      if (fc.phash_match === true) hardFraudHits++
      if (fc.rekognition_web_match === true) hardFraudHits++
      if (fc.classification === 'hard_fraud') hardFraudHits++
      if (fc.exif_has_camera_data === false) softFraudHits++
      if (fc.classification === 'soft_fraud') softFraudHits++
}

// manual signals stored on our own TrustProfile.manualFraudSignals
profile = await TrustProfile.findOne({ userId }).select('manualFraudSignals').lean()
for each s in (profile?.manualFraudSignals || []):
    if (HARD_SIGNALS.includes(s.signal)) hardFraudHits++
    else softFraudHits++

return { hardFraudHits, softFraudHits }
```

where `HARD_SIGNALS = ['REVERSE_IMAGE_HIT','LOCKER_WEIGHT_MISMATCH','PHOTO_OF_SCREEN']`
(treat moiré as hard) and soft = everything else.

> **Coordinate with P2** on how a grade is tied to a user (does the grade doc carry
> `userId`, or only `itemId`?). If only `itemId`, we resolve via the item — but items are
> P1's collection (read-only is fine). Add this to Open Questions and confirm before
> wiring; until confirmed, `readFraudSignals` returns zeros gracefully (no crash).

---

### 5.5 `trust.model.js` (MINIMAL extension — additive only)

The model is already complete. Add ONE optional field for the manual-signal path:

```js
// append inside the schema, additive, backward-compatible
manualFraudSignals: {
  type: [{
    signal: String,
    value: mongoose.Schema.Types.Mixed,
    direction: { type: String, enum: ['positive','negative'], default: 'negative' },
    addedAt: { type: Date, default: Date.now },
  }],
  default: [],
},
```

Nothing else changes. The existing `signals[]` still holds the explainability snapshot.

---

### 5.6 `trust.controller.js` (REPLACE 501 stubs)

```js
const trustService = require('./trust.service');

// GET /api/trust/:userId
const getTrustProfile = async (req, res, next) => {
  try {
    const profile = await trustService.getTrustProfile(req.params.userId);
    if (!profile) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: profile });
  } catch (e) { next(e); }
};

// POST /api/trust/:userId/recompute
const recomputeTrust = async (req, res, next) => {
  try {
    const profile = await trustService.computeTrustProfile(req.params.userId);
    if (!profile) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: profile });
  } catch (e) { next(e); }
};

// POST /api/trust/:userId/signals
const addSignal = async (req, res, next) => {
  try {
    const { signal, value, direction } = req.body;
    const profile = await trustService.addFraudSignal(req.params.userId, signal, value, direction);
    if (!profile) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: profile });
  } catch (e) { next(e); }
};

// GET /api/trust/admin/flagged
const listFlagged = async (req, res, next) => {
  try {
    // admin gate WITHOUT touching auth.middleware:
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin only' });
    }
    const { tier, page, limit } = req.query;
    const data = await trustService.listFlaggedProfiles({
      tier, page: Number(page) || 1, limit: Number(limit) || 20,
    });
    res.json({ success: true, ...data });
  } catch (e) { next(e); }
};

module.exports = { getTrustProfile, recomputeTrust, addSignal, listFlagged };
```

---

### 5.7 `trust.routes.js` (extend — NO server.js change)

```js
const express = require('express');
const router = express.Router();
const ctrl = require('./trust.controller');
const { validateUserId, validateSignal } = require('./trust.validation');
const { requireAuth, attachUser } = require('../../middleware/auth.middleware');

router.get('/health', (req, res) =>
  res.status(200).json({ module: 'trust', status: 'ok' }));

// admin route BEFORE '/:userId' so 'admin' isn't captured as a userId
router.get('/admin/flagged', requireAuth, attachUser, ctrl.listFlagged);

router.get('/:userId', validateUserId, ctrl.getTrustProfile);
router.post('/:userId/recompute', validateUserId, ctrl.recomputeTrust);
router.post('/:userId/signals', validateUserId, validateSignal, ctrl.addSignal);

module.exports = router;
```

> Route ordering matters: `/admin/flagged` must be declared before the parametric
> `/:userId` or Express will match `admin` as a `userId`.

---

### 5.8 `trust.validation.js` (real validation)

```js
const mongoose = require('mongoose');
const { TRUST_SIGNALS } = require('../../contracts/trustProfile.contract');

const KNOWN_SIGNALS = [
  ...Object.keys(TRUST_SIGNALS),
  'REVERSE_IMAGE_HIT','EXIF_ANOMALY','PHOTO_OF_SCREEN',
  'TIME_TO_RETURN_ANOMALY','LOCKER_WEIGHT_MISMATCH',
];

const validateUserId = (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.userId)) {
    return res.status(400).json({ success: false, message: 'Invalid userId' });
  }
  next();
};

const validateSignal = (req, res, next) => {
  const { signal, direction } = req.body;
  if (!signal || !KNOWN_SIGNALS.includes(signal)) {
    return res.status(400).json({ success: false, message: 'Unknown or missing signal' });
  }
  if (direction && !['positive','negative'].includes(direction)) {
    return res.status(400).json({ success: false, message: 'direction must be positive|negative' });
  }
  next();
};

module.exports = { validateUserId, validateSignal };
```

---

### 5.9 `trust.middleware.js` (NEW — the P1/P4 seam)

```js
const { getTrustProfile } = require('./trust.service');

/**
 * attachTrustProfile — mount on any route to expose req.trustProfile.
 * Resolves userId from req.user._id (preferred) or req.params.userId.
 *
 * P1 usage (one line in their route):
 *   const { attachTrustProfile } = require('../trust/trust.middleware');
 *   router.post('/returns', requireAuth, attachUser, attachTrustProfile, ctrl.initiate);
 * Then in their controller: req.trustProfile.tier  // 'verified'|'trusted'|...
 */
const attachTrustProfile = async (req, res, next) => {
  try {
    const userId = (req.user && req.user._id) || req.params.userId;
    req.trustProfile = userId ? await getTrustProfile(userId) : null;
    next();
  } catch (e) { next(e); }
};

module.exports = { attachTrustProfile };
```

---

## 6. `seed-trust.js` (NEW — additive demo seed)

**Location:** `backend/seed-trust.js`. **Never edits `seed.js`.** Idempotent and
re-runnable (it tags everything it creates and deletes only those on re-run).

**Structure:**

```js
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('./src/config/database');
const User   = require('./src/modules/users/user.model');
const Order  = require('./src/modules/orders/order.model');
const Return = require('./src/modules/returns/return.model');   // READ/insert OWN demo rows only
const TrustProfile = require('./src/modules/trust/trust.model');
const trustService = require('./src/modules/trust/trust.service');

const TAG = 'p3-trust-demo';   // marker on every record we create (e.g. storeName/claimDescription)

async function clearPrevious() {
  const demoUsers = await User.find({ email: /p3demo\+/ }).select('_id').lean();
  const ids = demoUsers.map(u => u._id);
  await Order.deleteMany({ buyerId: { $in: ids } });
  await Return.deleteMany({ userId: { $in: ids } });
  await TrustProfile.deleteMany({ userId: { $in: ids } });
  await User.deleteMany({ _id: { $in: ids } });
}

async function makeUser(handle, extra = {}) {
  return User.create({
    clerkId: `mock_p3_${handle}`, email: `p3demo+${handle}@example.com`,
    role: 'buyer', firstName: handle, ...extra,
  });
}

async function makeOrders(user, count, { daysAgoSpread = 365 } = {}) { /* insert N completed orders */ }
async function makeReturns(user, orderDocs, count, { daysHeld } = {}) { /* insert N returns */ }
```

**Personas to create (then call `computeTrustProfile` on each and print the result):**

| Handle | Setup | Expected tier |
|---|---|---|
| `power` | 40 orders over 2y, 1 return | verified |
| `clean-mid` | 12 orders, 1 return, 200d old | trusted |
| `watch-rate` | 20 orders, 9 returns (45%) | watch |
| `restricted-rate` | 15 orders, 11 returns (73%) | restricted |
| `wardrobe` | 6 orders, 3 returns all held ~28d | watch |
| `bracketing` | 4 orders same productId, 3 returned | watch |
| `sudden-shift` | 30 orders/3 lifetime returns, but 4 of last 5 (90d) returned | watch |
| `newbie` | 0 orders, 3d old | trusted |
| `banned` | 10 orders, banned=true | restricted |

**Verification print at the end:**

```js
for (const u of created) {
  const p = await trustService.computeTrustProfile(u._id);
  console.log(`${u.firstName.padEnd(16)} score=${p.score} tier=${p.tier}`);
}
```

**Run:** `node seed-trust.js`. Expected console output mirrors the table above.

---

## 7. `<TrustBadge>` (OPTIONAL frontend, fully self-contained)

**Location:** `frontend/src/components/trust/TrustBadge.jsx` (own folder; imports nothing P1 owns).

```jsx
import { useEffect, useState } from 'react';

const TIER_STYLES = {
  verified:  { label: 'Verified',  color: '#0a7f3f', bg: '#e6f6ec' },
  trusted:   { label: 'Trusted',   color: '#1565c0', bg: '#e7f0fb' },
  standard:  { label: 'Standard',  color: '#616161', bg: '#f0f0f0' },
  watch:     { label: 'Watch',     color: '#b26a00', bg: '#fff4e0' },
  restricted:{ label: 'Restricted',color: '#b00020', bg: '#fde7ea' },
};

export default function TrustBadge({ userId, apiBase = '/api' }) {
  const [profile, setProfile] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!userId) return;
    fetch(`${apiBase}/trust/${userId}`)
      .then(r => r.json())
      .then(j => j.success ? setProfile(j.data) : setErr(j.message))
      .catch(e => setErr(String(e)));
  }, [userId, apiBase]);

  if (err) return <span style={{ color:'#b00020' }}>trust: {err}</span>;
  if (!profile) return <span>…</span>;
  const s = TIER_STYLES[profile.tier] || TIER_STYLES.standard;
  return (
    <span title={`Score ${profile.score}/100`}
      style={{ color:s.color, background:s.bg, padding:'2px 8px', borderRadius:12, fontSize:12, fontWeight:600 }}>
      {s.label} · {profile.score}
    </span>
  );
}
```

> Do NOT wire it into shared nav/layout this phase — hand it to P1/P9 to place. Defer
> entirely if backend time is tight; the JSON from `/api/trust/:userId` is the
> demo-critical deliverable.

---

## 8. Endpoint Reference (final contract)

| Method | Path | Auth | Body / Query | Returns |
|---|---|---|---|---|
| GET | `/api/trust/health` | none | — | `{ module, status }` |
| GET | `/api/trust/:userId` | none (or self) | — | `{ success, data: TrustProfile }` (404 if no user) |
| POST | `/api/trust/:userId/recompute` | none (or self) | — | `{ success, data: TrustProfile }` |
| POST | `/api/trust/:userId/signals` | none | `{ signal, value?, direction? }` | `{ success, data: TrustProfile }` |
| GET | `/api/trust/admin/flagged` | admin | `?tier&page&limit` | `{ success, items[], total, page, limit, totalPages }` |

**TrustProfile response shape (matches contract + additive fields):**

```json
{
  "userId": "…", "tier": "watch", "score": 49,
  "signals": [{ "signal":"RETURN_RATE","value":0.45,"weight":0.25,"direction":"negative","contribution":0 }],
  "accountAge": 180, "lifetimePurchases": 20, "lifetimeReturns": 9,
  "returnRate": 0.45, "recentReturnRate90d": 0.45,
  "bracketingFlag": false, "wardrobingFlag": false,
  "lastComputed": "2026-06-13T…Z"
}
```

---

## 9. Test Matrix (`trust.scoring.test.js` + smoke)

**Unit (pure scoring — no DB, fast):** feed `facts` objects, assert `{ score, tier }`.

| # | facts | Expect |
|---|---|---|
| 1 | power user (A) | tier=verified, score≈98 |
| 2 | watch-rate (B) | tier=watch (returnRate cap) |
| 3 | restricted-rate (C) | tier=restricted |
| 4 | **40 purchases, 1 return** | tier ∈ {verified,trusted} — NEVER watch/restricted |
| 5 | wardrobe flag + mid history | tier=watch |
| 6 | bracketing+wardrobe both | tier=watch |
| 7 | sudden-shift (E) | tier=watch |
| 8 | new account (F) | tier=trusted, score≈70 |
| 9 | banned=true, good score | tier=restricted |
| 10 | hardFraudHits=1, good score | tier capped watch |
| 11 | hardFraudHits=2 | tier=restricted |
| 12 | softFraudHits=1 only | score −15, tier unchanged unless threshold crossed |
| 13 | softFraudHits=1 + bracketing | escalate one tier down |

**Integration smoke (run backend, hit endpoints):**

- `GET /api/trust/:seededWatchUser` → `tier: 'watch'`.
- `POST /api/trust/:cleanUser/signals { signal:'LOCKER_WEIGHT_MISMATCH' }` → tier drops.
- `POST /api/trust/:user/recompute` → fresh `lastComputed`.
- `GET /api/trust/admin/flagged` as admin → lists watch+restricted; as non-admin → 403.
- Lazy recompute: manually backdate `lastComputed`, call `GET /:userId`, confirm it recomputes.
- Regression: existing routes (`/api/orders`, `/api/products`, …) still 200.

**Run:** `npm test` (or `node --test` if no framework). If no test runner exists, add
`jest` as a devDependency scoped to this module only, or ship a `scripts/trust-check.js`
that imports `trust.scoring.js` and asserts the table — don't force a framework on the repo.

---

## 10. Build Order Checklist (do in this sequence)

```
[ ] 1. trust.scoring.js        — pure math + SCORING knobs (section 3, 5.1)
[ ] 2. trust.scoring.test.js   — lock the 13 cases BEFORE wiring DB (TDD)
[ ] 3. trust.model.js          — add manualFraudSignals[] (additive, 5.5)
[ ] 4. trust.service.js        — gatherFacts, detectors, readFraudSignals, the 5 fns (5.2–5.4)
[ ] 5. getTrustProfile shape   — verify returns {tier,score,...} or null (P1 interface)
[ ] 6. trust.validation.js     — validateUserId, validateSignal (5.8)
[ ] 7. trust.controller.js     — 4 handlers, admin gate in-controller (5.6)
[ ] 8. trust.routes.js         — extend, admin route before :userId (5.7)
[ ] 9. trust.middleware.js     — attachTrustProfile seam (5.9)
[ ] 10. seed-trust.js          — 9 personas, prints scores (section 6)
[ ] 11. run seed + smoke test  — confirm tier table matches expectations (section 9)
[ ] 12. (optional) TrustBadge  — self-contained component (section 7)
[ ] 13. verify no forbidden files touched (section 0) + existing routes still work
```

---

## 11. Definition of Done (Phase 3)

1. ✅ `trust.scoring.js` passes all 13 unit cases; math matches section 4 worked examples.
2. ✅ `getTrustProfile(userId)` returns `{ tier, score, ... }` or `null` — P1 can call it today.
3. ✅ `computeTrustProfile` persists a contract-correct doc with explainable `signals[]`.
4. ✅ Bracketing, wardrobing, and sudden-shift detectors fire on the seeded personas.
5. ✅ Canonical case (40 purchases, 1 return) → verified/trusted, never penalised.
6. ✅ Fraud pull from `grades.fraudCheck` + manual `/signals` both drop the tier correctly.
7. ✅ `/admin/flagged` lists watch+restricted; admin-gated; non-admin → 403.
8. ✅ `node seed-trust.js` reproducibly prints the expected tier table.
9. ✅ NO edits to `returns/`, `secondhand/`, `items/`, `grading/`, `server.js`, base
   `seed.js`, or `auth.middleware.js`. Writes only to `trustProfiles`.
10. ✅ Existing routes regression-free; (optional) `<TrustBadge>` renders tier + score.

---

## 12. Open Questions (confirm before/while building)

1. **Grade ↔ user link:** Does P2's grade doc carry `userId`, or only `itemId`? Drives
   `readFraudSignals`. Until confirmed, it returns zeros (no crash).
2. **Self-vs-admin on `GET /:userId`:** Public for demo simplicity, or restrict to
   self/admin? Currently open; tighten if needed without touching middleware.
3. **Device/payment fingerprint** (`Order.paymentDetails.mockCreditCard`): implement a
   "same card across N accounts" detector now, or defer to P9? Recommend defer.
4. **Test runner:** Confirm whether the repo has Jest. If not, ship `scripts/trust-check.js`
   rather than adding a framework.
