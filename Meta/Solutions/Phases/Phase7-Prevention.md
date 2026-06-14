# Phase 7 — Prevention Intelligence Layer — DETAILED Implementation Guide

> The build-level reference for the prevention layer. Prevention is **the highest-leverage
> layer in the whole system** — "the most sustainable return is the one that never happens."
> This document gives every file to touch, the exact scorecard math, the model-training plan,
> endpoint contracts, the fit-mining lexicon, worked examples, the seed plan, the cost/storage
> budget, and the test matrix. Follow it top-to-bottom and Phase 7 is done.
>
> Companion to the Phase 7 section of `ImplementationPlan.md` (the plan). This is the build doc.

---

## 0. Why This Is a Redesign (read first — it explains every later decision)

The original Phase 7 was "an XGBoost trained on the Kaggle Misra ModCloth/RentTheRunway
dataset + a KNN fit recommender over body measurements." **Both are infeasible on our actual
schema, and we should not pretend otherwise:**

| Original assumption | Reality in this codebase | Consequence |
|---|---|---|
| Features: order value, **discount %**, **COD-vs-prepaid**, **basket composition** | `order.model.js` has only `productId, quantity, totalPrice, status, paymentDetails.mockCreditCard` — no discount, no payment type, single-item orders | A foreign-trained model's feature space doesn't map to ours |
| Fit KNN over **user body measurements** | No measurement profile exists anywhere on `user.model.js`; we never collect one | The KNN has no query vector |
| **Size variants** per SKU | `product.model.js` has no size/variant field | "bought 3 sizes" can't be read literally |
| Train on a foreign dataset | Different catalog, different population | Predictions are theatre, not signal |

**What we DO have, and will build on instead:**

- `returns` — a clean `reasonCode` enum (`defective | not_as_described | changed_mind |
  wrong_item | other`) **plus free-text `reasonText`**, snapshotted `productCategory`,
  `originalProductId`, `orderTotal`. This is gold.
- `reviews` — `rating` + free-text `text` we can mine for fit/quality language.
- `orders` — purchase history per buyer (kept vs returned is derivable by joining returns).
- `products` — `category`, `price`, `condition`, `brandName/brandId`, `averageRating`,
  `reviewCount`, `totalSales`.
- **Phase 3 trust profiles** — already compute `returnRate`, `recentReturnRate90d`,
  `bracketingFlag`, `wardrobingFlag`, `tier`. Prevention **consumes** these; it never
  recomputes user risk.

**The redesign:** a **closed-loop Prevention Intelligence layer** that turns our own
return/review/order stream into a growing knowledge base, scores risk with a calibrated +
explainable hybrid model, and intervenes with friction sized to the buyer's trust tier —
all at near-zero marginal cost. Every return makes the next purchase smarter. That loop,
on our own data, is the moat — and it's *more* honest than a foreign-data model, not less.

---

## 1. Ground Rules (module boundaries)

**Folders / files I MUST NOT touch (other phases own them):**
- `backend/src/modules/trust/**` (P3 — I only **call** `getTrustProfile(userId)`)
- `backend/src/modules/grading/**`, `routing/**`, `returns/**`, `secondhand/**`, `items/**`
  (read-only where I need data; never write)
- `backend/src/modules/orders/order.service.js` — I add a **non-blocking hook**, I do not
  rewrite the order flow (see §9.2 for the surgical seam)
- `backend/seed.js` (base seed — I ship a separate additive `seed-prevention.js`)
- The Phase 2 grading pipeline in `ml-service/app/services/**` (untouched)

**Files / folders I OWN and will create:**
- `backend/src/modules/prevention/` — the whole module (model, service, scoring, controller,
  routes, validation, job)
- `backend/src/contracts/prevention.contract.js` — canonical constants
- `backend/seed-prevention.js` — additive demo seed
- `ml-service/app/routers/prediction.py` — implement the two stubs (already exists, returns 501)
- `ml-service/app/services/return_risk.py` — model + scorecard (NEW)
- `ml-service/app/services/fit_intel.py` — fit verdict logic (NEW)
- `ml-service/training/` — offline training scripts + synthetic data generator (NEW)
- `ml-service/trained_models/return_model.txt` + `calibrator.joblib` + `feature_spec.json`
  (the `trained_models/.gitkeep` slot already exists)
- `frontend/src/services/prevention.service.js` + a handful of self-contained components

**Frozen interfaces I depend on (do not change them; mock if not merged yet):**
1. **P3:** `require('../trust/trust.service').getTrustProfile(userId)` →
   `{ tier, score, returnRate, recentReturnRate90d, bracketingFlag, wardrobingFlag,
   lifetimePurchases, lifetimeReturns, accountAge, signals[] }` or `null`.
   Tiers: `verified | trusted | standard | watch | restricted`.
2. **Returns:** `return.model.js` fields above. Read-only.
3. **ML service base URL:** backend env `ML_SERVICE_URL` (default `http://localhost:8000`);
   FastAPI `settings.ml_service_url` already exists.

**Writes:** Phase 7 writes ONLY to the `returnInsights` collection (+ its own seed rows).
Refund-timing is **exposed as a pure function** for returns/routing to consume — Phase 7
does not write refund state itself (boundary respect, §8.4).

---

## 2. Architecture of the Prevention Module

```
                         PRE-PURCHASE (per request — cheap, deterministic)
   PDP load ───────────────► GET /api/prevention/product/:productId
                                      │  reads RIKB (1 indexed find) + buyer's own kept-history
                                      ▼
                              { fitVerdict, returnNote, personalizedHint }

   Buy Now / cart ─────────► POST /api/prevention/checkout-risk   { items[], userId }
        │                             │ 1. gather features (RIKB per item + trust profile)
        │                             │ 2. POST ml-service /predict/return  ──► LightGBM + scorecard
        │                             │ 3. fallback to JS scorecard if ML down
        │                             ▼
        │                     intervention.scoring (PURE)  ──► { riskBand, probability,
        │                             topReasons[], intervention, refundTiming }
        │
   Seller dashboard ───────► GET /api/prevention/seller/insights  (their SKUs from RIKB)

─────────────────────────────────────────────────────────────────────────────────────
                         NIGHTLY (batch — the closed loop; LLM here only)
   cron / npm run prevention:recompute ──► prevention.job.recomputeReturnInsights()
        • aggregate returns + reviews + orders  ──►  upsert returnInsights (one doc/SKU)
        • mine fit signal (lexicon over reasonText + review text)
        • ONE Bedrock call per significant complaint cluster → cached seller summary
```

**Stateless ML service, stateful backend.** Mongo lives only in the backend. The backend
computes a clean **feature payload** and hands it to FastAPI; FastAPI runs the model +
scorecard and returns probability + reasons. This keeps `ml-service` Mongo-free (as it is
today) and makes the model independently testable.

**Why mirror Phase 3's split.** `intervention.scoring.js` (backend) and `return_risk.py`'s
scorecard (ML) are **pure functions** — inputs → outputs, no I/O. Same discipline as
`trust.scoring.js`: trivially unit-testable, retune-without-fear, and the natural fallback.

---

## 3. The Data Asset — `returnInsights` (RIKB)

### 3.1 `returnInsight.model.js` (NEW — collection `returnInsights`)

One compact aggregate per product, plus synthetic `(brand, category)` rollup docs for cold
items. **Bounded storage:** ~0.5 KB/doc → 1,000 SKUs ≈ 0.5 MB on a 512 MB M0. We store
aggregates, never raw events.

```js
const mongoose = require('mongoose');

const FIT_VERDICTS = ['runs_small', 'true_to_size', 'runs_large', 'unknown'];

const returnInsightSchema = new mongoose.Schema({
  // Scope: either a specific product, or a category-level rollup (productId null)
  productId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null, index: true },
  brandName:  { type: String, default: null },
  category:   { type: String, index: true },          // always set (for cold-start backoff)

  unitsSold:     { type: Number, default: 0 },
  unitsReturned: { type: Number, default: 0 },
  returnRate:    { type: Number, default: 0 },         // unitsReturned / max(unitsSold,1)

  // histogram over return.reasonCode
  reasonHistogram: {
    defective:        { type: Number, default: 0 },
    not_as_described: { type: Number, default: 0 },
    changed_mind:     { type: Number, default: 0 },
    wrong_item:       { type: Number, default: 0 },
    other:            { type: Number, default: 0 },
  },
  dominantReason: { type: String, default: null },

  // mined fit signal — apparel & footwear (no body measurements involved)
  fitSignal: {
    verdict:       { type: String, enum: FIT_VERDICTS, default: 'unknown' },
    smallMentions: { type: Number, default: 0 },
    largeMentions: { type: Number, default: 0 },
    sampleSize:    { type: Number, default: 0 },       // total fit-relevant texts scanned
    confidence:    { type: Number, default: 0 },       // 0..1
  },

  // mined compatibility signal — electronics category
  compatSignal: {
    verdict:          { type: String, enum: ['issues_reported', 'no_issues', 'unknown'], default: 'unknown' },
    compatMentions:   { type: Number, default: 0 },
    setupMentions:    { type: Number, default: 0 },
    sampleSize:       { type: Number, default: 0 },
    confidence:       { type: Number, default: 0 },
  },

  // mined dimension/appearance signal — furniture & home category
  dimensionSignal: {
    verdict:          { type: String, enum: ['too_large', 'too_small', 'color_mismatch', 'no_issues', 'unknown'], default: 'unknown' },
    largeMentions:    { type: Number, default: 0 },
    smallMentions:    { type: Number, default: 0 },
    colorMentions:    { type: Number, default: 0 },
    sampleSize:       { type: Number, default: 0 },
    confidence:       { type: Number, default: 0 },
  },

  topComplaints: { type: [String], default: [] },      // short extracted phrases (cap 5)
  sellerSummary: { type: String, default: null },      // ONE nightly LLM sentence (cached)

  // before/after return rate tracking (§17)
  previousReturnRate30d: { type: Number, default: null },
  rateChangeDirection:   { type: String, enum: ['improved', 'worsened', 'stable', null], default: null },

  scope: { type: String, enum: ['product', 'category'], default: 'product', index: true },
  lastComputed: { type: Date, default: Date.now },
}, { timestamps: true });

// fast PDP lookup + cold-start backoff
returnInsightSchema.index({ productId: 1 });
returnInsightSchema.index({ scope: 1, category: 1 });

module.exports = mongoose.model('ReturnInsight', returnInsightSchema);
```

### 3.2 Cold-start category priors (in `prevention.contract.js`)

When a SKU has fewer than `MIN_SALES_FOR_OWN_RATE` (default 5) sales, back off to the
category rollup; if even that is thin, use a seeded prior. Each prior cites a public source
in a comment — "estimated, not audited."

```js
// Estimated category return-rate priors (sources cited in comments; clearly labelled estimates)
const CATEGORY_RETURN_PRIORS = {
  apparel:     0.28,   // online apparel returns widely reported ~25–30%
  clothing:    0.28,
  footwear:    0.20,   // shoes ~18–22% (fit-driven)
  shoes:       0.20,
  electronics: 0.08,
  home:        0.10,
  kitchen:     0.10,
  beauty:      0.06,
  cosmetics:   0.06,
  toys:        0.10,
  baby:        0.10,
  books:       0.04,
  media:       0.04,
  default:     0.12,
};
```

### 3.3 Fit-mining lexicon (in `prevention.contract.js`)

A tiny, transparent keyword lexicon — no NLP model needed. Run over `reasonText` (returns)
and `text` (reviews). Weight a mention more when it co-occurs with a fit-relevant reason
(`changed_mind`, `not_as_described`) and less for `defective` (defects aren't fit).

```js
const FIT_LEXICON = {
  small: ['too tight', 'runs small', 'size up', 'snug', 'tight', 'narrow', 'cramped', 'smaller than'],
  large: ['too big', 'runs large', 'size down', 'loose', 'baggy', 'roomy', 'oversized', 'larger than'],
};
const FIT_MIN_MENTIONS = 3;          // need ≥3 fit mentions before we claim a verdict
const FIT_VERDICT_MARGIN = 1.5;      // dominant side must be ≥1.5× the other to call it

// Electronics category: compatibility mismatch lexicon
const COMPAT_LEXICON = [
  'incompatible', 'doesn\'t work with', 'not compatible', 'wrong port', 'not supported',
  'confusing', 'can\'t connect', 'dead on arrival', 'doa', 'doesn\'t fit my', 'not recognized',
];
const COMPAT_MIN_MENTIONS = 3;

// Furniture/Home category: dimension and appearance mismatch lexicon
const DIMENSION_LEXICON = {
  too_large: ['too big', 'too large', 'doesn\'t fit', 'doorway', 'won\'t fit', 'couldn\'t get through',
              'too wide', 'too tall', 'overwhelming', 'massive', 'much bigger'],
  too_small: ['too small', 'smaller than expected', 'tiny', 'looked bigger', 'much smaller',
              'disappointing size', 'compact', 'not as big'],
  color_off: ['color different', 'darker', 'lighter', 'looks nothing like', 'doesn\'t match photo',
              'completely different color', 'more orange', 'more yellow', 'misleading photo'],
};
const DIMENSION_MIN_MENTIONS = 3;
const DIMENSION_VERDICT_MARGIN = 1.5;
```

**Verdict rule:** count `small` vs `large` mentions across the SKU's return/review text.
If `total < FIT_MIN_MENTIONS` → `unknown`. Else if `small ≥ large*MARGIN` → `runs_small`;
if `large ≥ small*MARGIN` → `runs_large`; else `true_to_size`. `confidence =
min(total / 10, 1) * |small−large| / max(small+large,1)`.

### 3.4 The nightly aggregation — `prevention.job.recomputeReturnInsights()`

Pure batch, idempotent, re-runnable. This is the **closed loop**.

```
for each productId that has ANY order OR return:
  unitsSold     = Order.countDocuments({ productId, status: 'completed' })
  returnsForSku = Return.find({ originalProductId: productId }).select('reasonCode reasonText')
  unitsReturned = returnsForSku.length
  returnRate    = unitsReturned / max(unitsSold, 1)
  reasonHistogram = tally reasonCode over returnsForSku
  dominantReason  = argmax(reasonHistogram)

  texts = [...returnsForSku.reasonText, ...Review.find({productId}).text]   // mine fit
  fitSignal = mineFit(texts)                                                // §3.3

  topComplaints = top-5 frequent short phrases from texts (simple n-gram tally)
  upsert returnInsights { productId, category, brandName, scope:'product', ... , lastComputed:now }

# category rollups for cold-start backoff
for each category:
  aggregate product docs in that category → upsert { productId:null, scope:'category', category, ... }

# seller summaries — LLM, BATCHED + CACHED (only for SKUs above a return-rate/volume threshold,
# and only if the complaint cluster changed since last run)
for each product doc with returnRate >= 0.15 AND unitsReturned >= 3 AND clusterChanged:
  sellerSummary = await bedrockSummariseCluster(topComplaints, dominantReason)   // 1 call
  save on the product's returnInsights doc
```

> **Cost rule (non-negotiable):** the LLM is touched ONLY here, ONLY for SKUs that cross a
> volume/return threshold, ONLY when the cluster changed. Everything the PDP/checkout reads
> at request time is precomputed. A nightly run on the demo catalog is a handful of calls.

**Trigger:** `npm run prevention:recompute` (root script → `node backend/seed-prevention.js
--recompute` or a dedicated runner) and a dev/admin endpoint `POST /api/prevention/recompute`.
For the demo, run it after seeding; in prod it's a nightly cron. No streaming, no per-write
recompute.

---

## 4. The Return-Risk Scorecard (PURE — exact math)

Risk is a **0–100 score where 100 = maximum return risk** (opposite polarity to the trust
score, where 100 = good — keep this straight). The scorecard is the explainable core and the
fallback. The LightGBM model (§5) produces the *calibrated probability*; the scorecard
produces the *reasons* and a score we can show when the model is unavailable.

### 4.1 Signals, weights, normalisation (weights sum to 1.00)

| Signal | Weight | Source | Normalised to 100 (max risk) when… |
|---|---|---|---|
| `PRODUCT_RETURN_RATE` | 0.28 | RIKB sku rate (backoff to category) | sku returnRate ≥ 0.40 |
| `FIT_MISMATCH` | 0.20 | RIKB fitSignal + category + buyer action | apparel/footwear & verdict≠true_to_size & buyer didn't act on it |
| `USER_RETURN_BEHAVIOUR` | 0.20 | Phase 3 trust profile | high personal returnRate / recent90d / risky tier |
| `CATEGORY_PRIOR` | 0.12 | `CATEGORY_RETURN_PRIORS` | high-return category (apparel/footwear) |
| `BRACKETING_INTENT` | 0.12 | checkout intent + trust.bracketingFlag | basket has dup SKU/category, or historical bracketer |
| `PRICE_BAND` | 0.04 | `product.price` | mid "try-and-see" band |
| `REVIEW_SENTIMENT_GAP` | 0.04 | `product.averageRating` + RIKB | low rating with enough reviews + complaints |

```
productReturnRateScore = min(skuRate / 0.40, 1) * 100
        where skuRate = (unitsSold >= 5) ? sku.returnRate : categoryPrior

categoryPriorScore     = min(categoryPrior / 0.30, 1) * 100      // apparel .28→93, electronics .08→27

fitMismatchScore       = categoryAwareMismatch(category, insight, buyerActedOnFit):
        // APPAREL / FOOTWEAR — fit signal
        if category ∈ {apparel,clothing,footwear,shoes}:
          score = (verdict ∈ {runs_small,runs_large} && !buyerActedOnFit)
                  ? fitSignal.confidence * 100 : 0
        // ELECTRONICS — compatibility signal
        else if category ∈ {electronics,gadgets,tech}:
          score = (compatSignal.verdict === 'issues_reported')
                  ? compatSignal.confidence * 100 : 0
        // FURNITURE / HOME — dimension signal
        else if category ∈ {furniture,home,kitchen,decor}:
          score = (dimensionSignal.verdict ∈ {too_large,too_small,color_mismatch})
                  ? dimensionSignal.confidence * 100 : 0
        else: score = 0
        // buyerActedOnFit is true if the client passes sizeAdjusted=true (user took the advice)

userReturnBehaviourScore = 0.6*min(returnRate/0.40,1)*100 + 0.4*min(recent90d/0.50,1)*100
        // then FLOOR by tier (the tier already encodes risk):
        if tier == 'restricted' → max(score, 90)
        if tier == 'watch'      → max(score, 60)
        if tier ∈ {verified}    → min(score, 20)    // genuine users capped LOW

bracketingScore        = (intentHasDuplicateSku || intentHasMultiVariantSameCategory) ? 100
                         : (trust.bracketingFlag ? 60 : 0)

priceBandScore         = piecewise(price in ₹):
                           < ₹200   → 20   // cheap impulse buy, low stakes
                           ₹200–₹800 → 100  // mid-range "I'll try it" — riskiest band
                           ₹800–₹3000 → 60  // upper-mid, more considered purchase
                           > ₹3000  → 30   // premium, buyer researches before buying
        // All prices in INR. Catalog uses ₹ throughout.

reviewSentimentGapScore= (reviewCount >= 5 && rating < 3.5) ? ((3.5-rating)/2.5)*100 : 0
```

> Edge cases: cold SKU (0 sales) → `productReturnRateScore` uses category prior, never NaN.
> Missing trust profile (new user) → `returnRate=recent90d=0`, tier treated as `standard`,
> so `userReturnBehaviourScore=0` (innocent until proven — mirrors Phase 3).

### 4.2 Weighted sum → band

```
riskScore = Σ (signalScore × weight)          // 0–100
band = riskScore > 65 ? 'high'
     : riskScore >= 35 ? 'medium'
     : 'low'
topReasons = top-3 signals by (signalScore × weight), rendered as human strings (§4.4)
```

### 4.3 Worked examples (bake these into tests)

**Priya — ₹500 footwear, SKU runs small, she's a VERIFIED loyal buyer, ordering her usual size.**

| Signal | Norm | ×W | Contribution |
|---|---|---|---|
| PRODUCT_RETURN_RATE (sku 0.30) | 75 | 0.28 | 21.0 |
| FIT_MISMATCH (footwear, runs_small, not adjusted, conf 0.8) | 80 | 0.20 | 16.0 |
| USER_RETURN_BEHAVIOUR (verified → capped 20) | 20 | 0.20 | 4.0 |
| CATEGORY_PRIOR (footwear .20) | 67 | 0.12 | 8.0 |
| BRACKETING_INTENT (none) | 0 | 0.12 | 0.0 |
| PRICE_BAND (mid) | 100 | 0.04 | 4.0 |
| REVIEW_SENTIMENT_GAP (fine) | 0 | 0.04 | 0.0 |
| **riskScore** | | | **53 → medium** |

→ band **medium**, top reason **FIT_MISMATCH**. Intervention = **fit nudge "size up"** — a
*helpful* nudge, **no refund delay** (verified). This is the showcase: risk ≠ punishment.
A great customer still gets a useful heads-up that prevents the return.

**Rahul — mid-range electronics, trusted user, healthy SKU.**

PRODUCT_RETURN_RATE (sku .06→15) , FIT_MISMATCH 0 (electronics), CATEGORY_PRIOR (.08→27),
USER low. **riskScore ≈ 14 → low.** No nudge. Frictionless.

**Bracketer — apparel, cart has 3 of the same SKU, standard tier, historical bracketingFlag.**

BRACKETING_INTENT 100×0.12=12, FIT_MISMATCH high, PRODUCT_RETURN_RATE high (apparel),
USER_RETURN_BEHAVIOUR elevated. **riskScore ≈ 78 → high.** Intervention = **bracketing
interception** ("keep the recommended size, skip the extras") **+ cooling-off refund timing**
(standard tier → delayed). Verified users in the same basket would NOT get the delay.

### 4.4 Reason strings (human-readable, for the nudge)

```
PRODUCT_RETURN_RATE → "About {pct}% of these are returned"
FIT_MISMATCH        → "Tends to run {small|large} — most returns cite {tightness|looseness}"
USER_RETURN_BEHAVIOUR→ "Your recent returns are higher than usual"   (only shown for watch/restricted)
CATEGORY_PRIOR      → "{Category} items are returned more often than average"
BRACKETING_INTENT   → "You've added multiple of the same item"
REVIEW_SENTIMENT_GAP→ "Recent reviews mention quality concerns"
```

> Tone rule: never accusatory. For genuine users the nudge is framed as *help* ("size up?"),
> never as suspicion. Suspicion-flavoured reasons (`USER_RETURN_BEHAVIOUR`) are surfaced only
> for `watch`/`restricted`, and even then drive *timing*, not a block.

---

## 5. The LightGBM Return-Risk Model (ML service) — DEFERRED POST-HACKATHON

> **Status:** The JS scorecard (§4) is the primary risk engine for the hackathon.
> The LightGBM model infrastructure is scaffolded and wired so it can be dropped in
> later without changing any backend code — the fallback path runs the scorecard
> automatically when model files are absent. Do NOT spend time training on synthetic
> data during the hackathon; the scorecard already encodes the same logic explicitly.
> When real return labels accumulate post-hackathon, run `train_return_model.py` and
> drop the artifacts into `trained_models/` — the serving code picks them up automatically.

**Why not train now:** on synthetic data, LightGBM would re-learn the scorecard's own
formula with added opacity and no real signal gain. The scorecard is more honest and
more explainable for the demo. The model swap is a documented roadmap step.

### 5.1 Feature spec (`trained_models/feature_spec.json`) — MUST equal what the backend computes

```json
{
  "features": [
    "product_return_rate", "category_prior", "price_band_ordinal", "condition_used",
    "user_return_rate", "user_recent90d", "user_tier_ordinal",
    "first_time_category", "fit_mismatch", "bracketing_intent",
    "review_rating", "review_count_log"
  ],
  "tier_ordinal": { "verified": 0, "trusted": 1, "standard": 2, "watch": 3, "restricted": 4 }
}
```

The backend (§8) builds exactly this vector; the model never sees anything it can't get in
production. **This is the whole point** — schema-matched features eliminate the foreign-data
mismatch the old plan suffered.

### 5.2 Synthetic training data — `ml-service/training/generate_synthetic.py`

We don't yet have enough real labels, and a foreign dataset doesn't map. So we generate a
**schema-matched synthetic dataset** whose feature distributions mirror our seed catalog +
the cited category priors, with a return label drawn from a realistic latent function + noise.

```
for i in range(N=40_000):
    category   = sample from catalog category mix
    cat_prior  = CATEGORY_RETURN_PRIORS[category]
    product_return_rate = clip(Normal(cat_prior, 0.08), 0.01, 0.6)
    price_band_ordinal  = sample {0:cheap,1:mid,2:upper,3:premium} weighted by category
    condition_used      = Bernoulli(0.15)
    user_tier_ordinal   = sample tier mix (most standard/trusted)
    user_return_rate    = tier-conditioned Beta  (verified low … restricted high)
    user_recent90d      = noisy function of user_return_rate
    fit_mismatch        = (category in fit-cats) & Bernoulli(0.3)
    bracketing_intent   = Bernoulli(0.05) but higher for high-tier-ordinal
    review_rating, review_count_log, first_time_category = sampled

    # latent return propensity (the "truth" we let LightGBM learn) + noise
    z = 1.6*product_return_rate + 0.9*cat_prior + 1.2*fit_mismatch
        + 1.4*user_return_rate + 0.8*user_recent90d + 1.1*bracketing_intent
        + 0.3*condition_used + price_band_effect - 0.2*(review_rating-3)
    p = sigmoid(scale*(z - center))
    returned = Bernoulli(p)
```

Honest labelling: this is a **bootstrap**. We document it as such (§ DoD + caveats). The
closed loop replaces it with real labels over time.

### 5.3 Train + calibrate — `ml-service/training/train_return_model.py`

```
1. df = generate_synthetic()                         # or load accumulated real labels later
2. train/valid/test split (stratified on `returned`)
3. lgb.train(params={objective:'binary', metric:'auc', num_leaves:31,
              learning_rate:0.05, n_estimators:300, max_depth:-1}, ...)
4. calibrate: CalibratedClassifierCV(method='isotonic') on the valid split
5. report AUC on test (expect ~0.72–0.78 on synthetic — quote honestly)
6. dump:
     model       → trained_models/return_model.txt   (LightGBM native, tiny)
     calibrator  → trained_models/calibrator.joblib
     feature_spec→ trained_models/feature_spec.json
```

Add to `ml-service/requirements.txt` (all CPU, small): `lightgbm`, `scikit-learn`,
`pandas`, `numpy` (numpy already present). Document `python -m training.train_return_model`.

### 5.4 Serving — `ml-service/app/services/return_risk.py`

```python
# lazy-load, cache in module scope; degrade to scorecard if files missing
_MODEL = _CALIB = _SPEC = None

def _load():
    # load return_model.txt + calibrator.joblib + feature_spec.json once; tolerate absence

def scorecard(features: dict) -> dict:
    """PURE — mirrors §4 math. Returns { risk_score, band, top_reasons }. No model needed."""

def predict_return(features: dict) -> dict:
    sc = scorecard(features)                      # always available → reasons + fallback score
    try:
        _load()
        if _MODEL is None: raise RuntimeError('model cold')
        x = vectorize(features, _SPEC)
        prob = float(_CALIB.predict_proba([x])[:, 1][0])
        return { 'return_probability': round(prob, 3), 'risk_band': band_from_prob(prob),
                 'scorecard_score': sc['risk_score'], 'top_reasons': sc['top_reasons'],
                 'used_fallback': False, 'model_version': MODEL_VERSION }
    except Exception:
        # model unavailable → scorecard probability proxy
        return { 'return_probability': round(sc['risk_score']/100, 3),
                 'risk_band': sc['band'], 'scorecard_score': sc['risk_score'],
                 'top_reasons': sc['top_reasons'], 'used_fallback': True,
                 'model_version': 'scorecard-only' }
```

`band_from_prob`: `>0.55 high`, `≥0.30 medium`, else `low` (align with scorecard bands).

### 5.5 Endpoints — implement `ml-service/app/routers/prediction.py`

Replace the two `NotImplementedError` stubs:

```python
@router.post("/return")
async def predict_return_probability(req: ReturnRiskRequest):
    return return_risk.predict_return(req.features)     # req.features = the §5.1 vector inputs

@router.post("/fit-recommend")
async def fit_recommendation(req: FitRequest):
    return fit_intel.recommend(req.fit_signal, req.category, req.kept_brand_history)
```

Add `ReturnRiskRequest`, `FitRequest` to `models/schemas.py` (alongside existing schemas).
`/predict/return` and `/predict/fit-recommend` are already wired in `main.py` under the
`prediction` router.

### 5.6 Add prevention tunables to `ml-service/app/config.py`

Append to `Settings` (additive, defaults safe):

```python
return_model_path: str = "trained_models/return_model.txt"
return_calibrator_path: str = "trained_models/calibrator.joblib"
return_feature_spec_path: str = "trained_models/feature_spec.json"
risk_high_threshold: float = 0.55
risk_medium_threshold: float = 0.30
```

---

## 6. Fit Intelligence — `ml-service/app/services/fit_intel.py`

No body measurements. Input is the SKU's mined `fitSignal` (from RIKB, passed by backend) +
the buyer's *own* kept-brand history (also passed by backend). Output is an honest sentence.

```python
def recommend(fit_signal, category, kept_brand_history=None):
    verdict, conf, small, large, n = unpack(fit_signal)
    if category not in FIT_CATEGORIES or verdict in (None,'unknown'):
        return { 'verdict':'unknown', 'message':None, 'confidence':0, 'suggested_action':None }
    if verdict == 'runs_small':
        msg = f"Runs small — {pct(small,small+large)} of shoppers who returned this said it was too tight. Consider sizing up."
        action = 'SIZE_UP'
    elif verdict == 'runs_large':
        msg = f"Runs large — most returns cite it being too loose. Consider sizing down."
        action = 'SIZE_DOWN'
    else:
        msg = "Sizing looks true to size for most shoppers."; action = None
    # personalization from OUR data (no measurements):
    if kept_brand_history:   # e.g. {'brand':'Nike','size':'M'}
        msg += f" You took {kept_brand_history['size']} in {kept_brand_history['brand']} and kept it."
    return { 'verdict':verdict, 'message':msg, 'confidence':conf, 'suggested_action':action }
```

The backend supplies `kept_brand_history` by checking the buyer's past orders in the same
`brandName`+`category` that have **no** matching return (`Return.originalProductId`).

---

## 7. Backend Contract — `backend/src/contracts/prevention.contract.js`

```js
const RISK_BANDS = ['low', 'medium', 'high'];

const INTERVENTION_TYPES = [
  'NONE',               // low risk → nothing
  'FIT_NUDGE',          // PDP/checkout: size up/down
  'INFO_NUDGE',         // "commonly returned for X — check Y"
  'BRACKETING_NUDGE',   // multi-buy → drop extras
  'COOLING_OFF',        // delay refund post-grade (timing only, never a block)
  'CONFIDENCE_BOOST',   // inverse prevention for genuine users
];

const REFUND_TIMING = { INSTANT: 'instant', DELAYED: 'delayed' };
const COOLING_OFF_HOURS = 36;     // 24–48h window midpoint

// reused from returns module — keep in sync, don't redefine the enum source of truth
const RETURN_REASON_CODES = ['defective','not_as_described','changed_mind','wrong_item','other'];

const FIT_CATEGORIES = ['apparel','clothing','footwear','shoes'];

// + CATEGORY_RETURN_PRIORS, FIT_LEXICON, FIT_VERDICTS, FIT_MIN_MENTIONS, FIT_VERDICT_MARGIN (§3)

module.exports = { RISK_BANDS, INTERVENTION_TYPES, REFUND_TIMING, COOLING_OFF_HOURS,
  RETURN_REASON_CODES, FIT_CATEGORIES, CATEGORY_RETURN_PRIORS, FIT_LEXICON, FIT_VERDICTS,
  FIT_MIN_MENTIONS, FIT_VERDICT_MARGIN };
```

---

## 8. Backend Module — `backend/src/modules/prevention/`

### 8.1 `prevention.intervention.js` (PURE — the decision table, fully unit-testable)

Maps `(riskBand, trustTier, context)` → intervention object. No DB, no async. This is the
heart of "friction sized to the buyer."

```js
function decideIntervention({ riskBand, trustTier, fitSuggestedAction, bracketing, category }) {
  const genuine = trustTier === 'verified' || trustTier === 'trusted';

  // 1. bracketing always intercepts (any tier) — but framed as savings, not suspicion
  if (bracketing) return { type:'BRACKETING_NUDGE', refundTiming: genuine ? 'instant' : timing(riskBand,trustTier) };

  // 2. fit help whenever we have a concrete action (PDP + checkout) — pure help
  if (fitSuggestedAction) return { type:'FIT_NUDGE', action:fitSuggestedAction, refundTiming: timing(riskBand,trustTier) };

  // 3. otherwise band-driven
  if (riskBand === 'high')   return { type: genuine ? 'INFO_NUDGE' : 'INFO_NUDGE', refundTiming: timing(riskBand,trustTier) };
  if (riskBand === 'medium') return { type:'INFO_NUDGE', refundTiming:'instant' };
  // low + genuine → optionally a confidence boost (encourage single correct purchase)
  return { type: genuine ? 'CONFIDENCE_BOOST' : 'NONE', refundTiming:'instant' };
}

// refund TIMING only — never a block. Verified/trusted always instant.
function timing(riskBand, trustTier) {
  if (trustTier === 'verified' || trustTier === 'trusted') return 'instant';
  if (riskBand === 'high' && (trustTier === 'standard' || trustTier === 'watch' || trustTier === 'restricted'))
    return 'delayed';          // refund 24–48h AFTER grading clears
  return 'instant';
}
module.exports = { decideIntervention, timing };
```

### 8.2 `prevention.service.js` (DB I/O + orchestration)

```
getProductInsight(productId):
  doc = ReturnInsight.findOne({ productId }) || categoryBackoff(product.category)
  return { returnRate, dominantReason, fitSignal, topComplaints, returnNote, sellerSummary }

assessCheckoutRisk({ userId, items }):           // items: [{ productId, quantity, sizeAdjusted? }]
  trust = await trustService.getTrustProfile(userId)          // CONSUME P3, never recompute
  perItem = for each item:
      product  = Product.findById(item.productId).lean()
      insight  = await getProductInsight(item.productId)
      keptHist = await keptBrandHistory(userId, product)       // §6 personalization
      features = buildFeatureVector(product, insight, trust, item, context)   // §5.1 exact keys
      ml = await callMlPredictReturn(features)  // POST {ML_SERVICE_URL}/predict/return
           ↳ on failure: ml = jsScorecardFallback(features)    // thin JS mirror of §4
      fit = await callMlFitRecommend(insight.fitSignal, product.category, keptHist)
      intervention = decideIntervention({ riskBand: ml.risk_band, trustTier: trust?.tier ?? 'standard',
                        fitSuggestedAction: fit.suggested_action,
                        bracketing: detectBracketingIntent(items, item, trust),
                        category: product.category })
      return { productId, probability: ml.return_probability, riskBand: ml.risk_band,
               topReasons: ml.top_reasons, fit, intervention }
  basketRisk = max(perItem.riskBand)            // worst item drives basket-level messaging
  return { basketRisk, items: perItem, trustTier: trust?.tier ?? 'standard',
           refundTiming: worstRefundTiming(perItem) }

getSellerInsights(sellerId):
  skus = Product.find({ sellerId }).select('_id title category')
  return ReturnInsight.find({ productId: { $in: skus.ids } })  // returnRate, dominantReason, fitSignal, sellerSummary

getRefundTiming({ userId, productId, riskBand }):   // EXPOSED to returns/routing (boundary-safe)
  trust = await trustService.getTrustProfile(userId)
  return timing(riskBand, trust?.tier ?? 'standard')           // 'instant' | 'delayed' + hours
```

`detectBracketingIntent(items, item, trust)`: true if `items` contains the same `productId`
twice, OR ≥2 items share the same `category` with `quantity>1`, OR `trust.bracketingFlag`.

`jsScorecardFallback`: a compact JS port of the §4 scorecard (product + category + user
signals only — it's the safety net, it doesn't need the model). Keep it in
`prevention.scoring.js` so it's unit-tested against the same worked examples as the Python
scorecard (both must agree on the §4.3 cases within rounding).

### 8.3 `prevention.controller.js` / `routes.js` / `validation.js`

| Method | Path | Auth | Body / Query | Returns |
|---|---|---|---|---|
| GET | `/api/prevention/health` | none | — | `{ module, status }` |
| GET | `/api/prevention/product/:productId` | none | — | `{ returnNote, fit, returnRate, dominantReason }` |
| POST | `/api/prevention/checkout-risk` | buyer | `{ items:[{productId,quantity,sizeAdjusted?}] }` | `{ basketRisk, items[], trustTier, refundTiming }` |
| GET | `/api/prevention/seller/insights` | seller | — | `{ items:[{ productId,title,returnRate,dominantReason,fitVerdict,sellerSummary }] }` |
| POST | `/api/prevention/recompute` | admin/dev | — | `{ updated: N }` (runs §3.4 job) |

`validation.js`: validate `productId` is an ObjectId; `items` non-empty array; `quantity≥1`.
Controllers are thin and use the Standard_Response envelope (`{ success, data }`) like the
rest of the repo.

### 8.4 The order-flow seam (surgical, non-blocking)

Do **not** rewrite `order.service.createOrder`. Prevention is **advisory pre-purchase**, so
the integration is a *frontend* call to `/checkout-risk` **before** confirming the order (the
`CheckoutModal` confirm path, §10). The only optional backend touch:

- When returns/refunds are processed (returns module, possibly P4), they call
  `preventionService.getRefundTiming({ userId, productId, riskBand })` to decide
  instant-vs-delayed. That's a **read-only consume** of a pure function we expose — Phase 7
  never writes refund state. If returns isn't ready, this is simply unused; nothing breaks.

---

## 9. Frontend (self-contained, drops onto existing pages)

### 9.1 `frontend/src/services/prevention.service.js`

```js
import api from './api';
export const getProductInsight = (productId) => api.get(`/prevention/product/${productId}`).then(r=>r.data);
export const getCheckoutRisk  = (items)     => api.post('/prevention/checkout-risk', { items }).then(r=>r.data);
export const getSellerInsights = ()          => api.get('/prevention/seller/insights').then(r=>r.data);
```

### 9.2 PDP — `<FitReturnNote productId />` (place inside the product-details card)

On `ProductDetailPage`, after the description, fetch `getProductInsight(id)` and render the
honest one-liner when present:

```
🧵 Runs small — 7 of 10 shoppers who returned this said it was too tight. Consider sizing up.
↩︎ Returned more often than average (mostly: "doesn't match expectations").
```

Renders nothing when `verdict==='unknown'` and `returnRate` is unremarkable. Never scolds.

### 9.3 Checkout — `<ReturnRiskNudge />` in the Buy Now confirm path

Wire into `ProductDetailPage.handleBuyNowClick` / `CheckoutModal`: before finalizing, call
`getCheckoutRisk([{ productId:id, quantity:1 }])`. If `basketRisk !== 'low'` and there's a
`FIT_NUDGE`/`INFO_NUDGE`, show a non-blocking banner with the top reason and a concrete CTA
("Size up" / "Read fit notes" / "Continue anyway"). `CONFIDENCE_BOOST` shows a positive
assurance instead. The user can always continue — **no hard block**.

### 9.4 Bracketing — `<BracketingNudge />`

**Client-side cart array (confirmed approach):** Phase 7 ships a minimal client-side cart
state using React context or a simple `useState` array. No cart backend is needed — the
`/checkout-risk` API is cart-agnostic and scores whatever `items[]` you pass.

```jsx
// CartContext.js (new, self-contained — Phase 7 owns this)
const [cart, setCart] = useState([]);   // [{ productId, quantity, sizeSelected }]

const addToCart = (productId, qty = 1) => {
  setCart(prev => {
    const existing = prev.find(i => i.productId === productId);
    if (existing) return prev.map(i => i.productId === productId
      ? { ...i, quantity: i.quantity + qty } : i);
    return [...prev, { productId, quantity: qty }];
  });
};
```

If a `BRACKETING_NUDGE` is returned by `/checkout-risk`, show:
*"You've added 3 of these — most shoppers keep one. Want the recommended size only?"*
with a one-tap "Keep recommended, remove extras" that calls `setCart` to reduce quantity to 1.

**Bracketing is also detected from historical `trust.bracketingFlag`** (Phase 3) — so even
without a live cart, past bracketers are intercepted on their next purchase.

### 9.5 Seller dashboard — `<ReturnInsightsPanel />`

On `SellerDashboard`, a card listing the seller's SKUs with return rate, dominant reason, fit
verdict badge, and the nightly `sellerSummary` sentence. This is the "Fit Insights" surface
that closes the loop upstream.

---

## 10. Seed Plan — `backend/seed-prevention.js` (additive, idempotent)

Never edits `seed.js`. Creates a deterministic demo state and then runs the recompute so the
RIKB has signal Day 1 (solves cold-start for the demo).

**What it seeds (tagged `p7-prev-demo`, deletable on re-run):**
1. A **runs-small footwear SKU** with ~30% return rate: orders + several returns whose
   `reasonText` contains "too tight / size up", plus reviews echoing it → fit verdict
   `runs_small`, confidence high. Drives the **Priya** PDP + checkout demo.
2. A **healthy electronics SKU**: many orders, ~6% returns → low risk. Drives **Rahul**
   (frictionless).
3. A **high-return apparel SKU** with mixed complaints → seller `sellerSummary` generated;
   drives the **seller dashboard** demo + bracketing.
4. Buyers at different tiers reusing the Phase 3 seed personas (verified Priya, standard
   bracketer) so `assessCheckoutRisk` shows tier-sensitive interventions.

**End of seed:** call `recomputeReturnInsights()` and print a table:
`SKU | sold | returned | rate | fitVerdict | dominantReason`.

**Run:** `node backend/seed-prevention.js` then it auto-recomputes; or `npm run
prevention:recompute` anytime.

---

## 11. Cost & Storage Budget (the binding constraint — verify against this)

| Item | Cost / Storage | Note |
|---|---|---|
| `returnInsights` docs | ~0.5 KB × #SKUs (≈0.5 MB / 1k SKUs) | bounded aggregates, not raw events; fits M0 easily |
| LightGBM model + calibrator | < 5 MB **in repo**, not in DB | CPU inference, lazy-loaded once |
| Per PDP view | 1 indexed `findOne` | precomputed; no LLM, no vision |
| Per checkout-risk call | 1 trust read + N RIKB reads + 1 cached model inference | pure math; degrades to JS scorecard |
| LLM (Bedrock) usage | **nightly only**, gated by volume/return threshold, cached | a handful of calls per nightly run on demo catalog |
| New managed services | **none** | reuse FastAPI + Atlas M0 + existing Bedrock |
| GPU | **none** | LightGBM + lexicon + group-by only |

If any of these grow unbounded in your implementation, you've drifted from the design — stop
and re-read this table.

---

## 12. Test Matrix

**Pure scorecard (`return_risk.scorecard` Python + `prevention.scoring.js` JS — must agree):**

| # | Input | Expect |
|---|---|---|
| 1 | Priya footwear (§4.3) | band=medium, top reason=FIT_MISMATCH |
| 2 | Rahul electronics (§4.3) | band=low |
| 3 | Bracketer apparel (§4.3) | band=high, BRACKETING_INTENT present |
| 4 | verified user, risky SKU | userReturnBehaviour capped ≤20; never high *because of the user* |
| 5 | cold SKU (0 sales) | uses category prior, no NaN |
| 6 | missing trust profile | treated as standard, userReturnBehaviour=0 |

**Intervention table (`prevention.intervention.js`):**

| # | (band, tier, fit, bracketing) | Expect |
|---|---|---|
| 7 | (medium, verified, SIZE_UP, false) | FIT_NUDGE, refund **instant** |
| 8 | (high, standard, none, false) | INFO_NUDGE, refund **delayed** |
| 9 | (high, verified, none, false) | INFO_NUDGE, refund **instant** (genuine never delayed) |
| 10 | (any, any, none, true) | BRACKETING_NUDGE |
| 11 | (low, trusted, none, false) | CONFIDENCE_BOOST |

**Fit mining (`mineFit` + `fit_intel`):**

| # | texts | Expect |
|---|---|---|
| 12 | 5×"too tight", 1×"loose" | runs_small, confidence>0 |
| 13 | 2 fit mentions only | unknown (below FIT_MIN_MENTIONS) |
| 14 | balanced small/large | true_to_size |

**Model serving:**

| # | scenario | Expect |
|---|---|---|
| 15 | model files present | used_fallback=false, calibrated prob in [0,1] |
| 16 | model files deleted | used_fallback=true, scorecard prob, still returns reasons |

**Integration smoke (run backend + ml-service):**
- `GET /api/prevention/product/:footwearSku` → fit note "runs small".
- `POST /api/prevention/checkout-risk` Priya → medium + FIT_NUDGE + instant refund.
- Same SKU, bracketer user, 3× qty → high + BRACKETING_NUDGE + delayed refund.
- `GET /api/prevention/seller/insights` → returns the seeded SKUs with sellerSummary.
- `POST /api/prevention/recompute` → updates docs; re-running is idempotent.
- ML service down → checkout-risk still returns a nudge via JS fallback (no 500).
- Regression: `/api/orders`, `/api/products`, PDP still 200; order flow unchanged.

**Training sanity (`train_return_model.py`):** test AUC ≥ 0.70 on synthetic; calibration
curve roughly diagonal; artifacts written to `trained_models/`.

---

## 13. Build Order Checklist (do in this sequence)

```
[ ] 1.  prevention.contract.js            — priors, lexicon, bands, intervention types (§3.2/3.3/7)
[ ] 2.  returnInsight.model.js            — collection returnInsights (§3.1)
[ ] 3.  prevention.scoring.js (JS)        — pure scorecard + worked-example tests (§4) — TDD first
[ ] 4.  return_risk.py scorecard          — Python port; assert agreement with JS on §4.3 (§5.4)
[ ] 5.  fit mining (mineFit) + fit_intel  — lexicon verdict + tests (§3.3/§6)
[ ] 6.  prevention.job.recompute          — nightly aggregation incl. fit mining (§3.4)
[ ] 7.  generate_synthetic + train script — LightGBM + isotonic calibration, dump artifacts (§5.2/5.3)
[ ] 8.  return_risk.predict_return        — model load + fallback wiring (§5.4)
[ ] 9.  prediction.py endpoints           — implement /predict/return + /predict/fit-recommend (§5.5)
[ ] 10. prevention.intervention.js (PURE) — decision table + timing + tests (§8.1)
[ ] 11. prevention.service.js             — getProductInsight, assessCheckoutRisk, sellerInsights,
                                            getRefundTiming, ML call + JS fallback (§8.2)
[ ] 12. controller / routes / validation  — 5 endpoints, Standard_Response (§8.3)
[ ] 13. seed-prevention.js                — 3 demo SKUs + tiers, auto-recompute, print table (§10)
[ ] 14. frontend: prevention.service.js   — api wrappers (§9.1)
[ ] 15. <FitReturnNote> on PDP            — honest one-liner (§9.2)
[ ] 16. <ReturnRiskNudge> in checkout     — non-blocking, concrete CTA (§9.3)
[ ] 17. <BracketingNudge> + <ReturnInsightsPanel> (seller) (§9.4/9.5)
[ ] 18. cost/storage audit (§11) + full test matrix (§12) + regression check (§1)
```

**Critical path:** 1 → 2 → 3 → 6 → 11 → 12 → 15/16 (a demoable PDP+checkout nudge needs the
scorecard + RIKB + service + UI; the LightGBM model 7–9 can land in parallel and the system
runs on the scorecard fallback until it does).

**Parallelizable:** model training (7–9) is independent of the backend module (10–12) thanks
to the scorecard fallback; frontend (14–17) can start against a stubbed `/checkout-risk`.

---

## 14. Definition of Done (Phase 7)

1. ✅ `returnInsights` exists; the nightly `recomputeReturnInsights()` is idempotent and
   produces one compact doc per SKU + category rollups; storage stays within §11.
2. ✅ Fit signal is mined from our own `reasonText` + review `text` (lexicon, §3.3); the PDP
   shows an honest, sourced one-liner and renders nothing when `unknown`.
3. ✅ `/predict/return` returns a **calibrated probability + risk band + top-3 reasons**, and
   **degrades to the explainable scorecard** (`used_fallback:true`) when the model is cold or
   the service is down — never a 500 on the request path.
4. ✅ The JS scorecard and the Python scorecard **agree** on the §4.3 worked examples (within
   rounding); both pass the §12 pure tests.
5. ✅ `assessCheckoutRisk` **consumes** Phase 3's `getTrustProfile` (never recomputes user
   risk) and returns tier-sensitive interventions.
6. ✅ Intervention engine: genuine users (verified/trusted) get **help, never delay**; risky
   users get cooling-off **timing** (not a block); bracketing is intercepted for everyone but
   framed as savings.
7. ✅ Seller dashboard shows per-SKU return rate, dominant reason, fit verdict, and a nightly
   **cached** LLM summary; the LLM is touched **only** in the nightly batch, gated by
   volume/return threshold.
8. ✅ `getRefundTiming` is exposed as a pure consume-able function; Phase 7 writes **only** to
   `returnInsights` and never to refund/order/return state.
9. ✅ `node seed-prevention.js` reproducibly builds the demo (runs-small footwear, healthy
   electronics, high-return apparel) and prints the expected insight table.
10. ✅ Demo runs end-to-end: Priya gets a "size up" fit nudge (no refund delay); Rahul is
    frictionless; the bracketer is intercepted + cooling-off; the seller sees the cluster
    summary; `recompute` visibly refreshes the knowledge base.
11. ✅ No edits to `trust/`, `grading/`, `routing/`, `returns/`, `secondhand/`, `items/`, base
    `seed.js`, or `order.service.createOrder`. Existing routes regression-free.
12. ✅ Cost/storage budget (§11) holds: no GPU, no new managed services, per-request path is a
    Mongo read + local inference + pure math.
13. ✅ Nudge effectiveness tracking: every nudge fires a `nudgeEvent` log; the nightly job
    computes conversion rates; admin dashboard shows prevention metrics.
14. ✅ Buyer post-return feedback: when a nudge was shown and ignored and the return reason
    matches, a helpful learning message appears on the return confirmation page.
15. ✅ Seller before/after tracking: the dashboard shows return-rate change since the seller
    was shown the insight.
16. ✅ Phase 5 real-time photo signal integrated: listings without a verified real-time photo
    on visual categories contribute a small risk bump in the scorecard.
17. ✅ Fit notes on PDP respect a confidence floor (≥0.5); no misleading verdicts on thin data.

---

## 15. NEW — Nudge Effectiveness Tracking (§15)

> **Problem:** Phase 7 shows nudges but never knows if they work. Without measurement, the
> system runs on faith and can't self-improve its intervention quality.

### 15.1 `nudgeEvent.model.js` (NEW — collection `nudgeEvents`)

```js
const mongoose = require('mongoose');

const nudgeEventSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  productId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  nudgeType:  { type: String, enum: ['FIT_NUDGE','INFO_NUDGE','BRACKETING_NUDGE','COOLING_OFF','CONFIDENCE_BOOST'], required: true },
  riskBand:   { type: String, enum: ['low','medium','high'], required: true },
  trustTier:  { type: String, default: 'standard' },

  // outcome tracking
  shown:      { type: Boolean, default: true },       // was the nudge rendered
  acted:      { type: Boolean, default: null },       // did buyer change behaviour (size up, remove extras)
  purchased:  { type: Boolean, default: null },       // did buyer proceed to purchase
  returned:   { type: Boolean, default: null },       // did buyer ultimately return

  // timestamps
  shownAt:    { type: Date, default: Date.now },
  actedAt:    { type: Date, default: null },
  purchasedAt:{ type: Date, default: null },
  returnedAt: { type: Date, default: null },
}, { timestamps: true });

// auto-expire after 90 days to keep storage bounded
nudgeEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
// query patterns
nudgeEventSchema.index({ nudgeType: 1, shown: 1, acted: 1 });
nudgeEventSchema.index({ productId: 1, nudgeType: 1 });

module.exports = mongoose.model('NudgeEvent', nudgeEventSchema);
```

### 15.2 How It Flows

```
[Checkout risk call]
  → nudge decided (e.g. FIT_NUDGE)
  → log: { userId, productId, nudgeType, shown:true, shownAt:now }

[Frontend: buyer changes size]
  → PATCH /api/prevention/nudge-event/:id  { acted: true, actedAt: now }

[Frontend: buyer completes purchase]
  → PATCH /api/prevention/nudge-event/:id  { purchased: true, purchasedAt: now }

[Nightly or on-return: return record created for this userId+productId]
  → Job matches nudgeEvent → sets { returned: true, returnedAt: now }
```

### 15.3 Metrics (computed weekly in the nightly job)

```
nudgeConversionRate  = count(acted=true) / count(shown=true)
preventionRate       = count(acted=true AND returned=false) / count(acted=true)
ignoreReturnRate     = count(acted=false AND returned=true) / count(shown=true AND acted=false)
```

Per nudge type, per category. Surfaced on the admin prevention dashboard.

### 15.4 Auto-Flag Ineffective Nudges

If a nudge type has `nudgeConversionRate < 0.10` over ≥50 impressions in a category, flag
it for review. The nightly job writes a warning to the admin dashboard:
*"INFO_NUDGE on electronics: 4% conversion rate over 82 impressions — consider removing or
rewording."*

### 15.5 Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/prevention/nudge-event` | buyer | Log nudge shown (called by frontend) |
| PATCH | `/api/prevention/nudge-event/:id` | buyer | Update acted/purchased |
| GET | `/api/prevention/nudge-metrics` | admin | Weekly aggregates by type/category |

---

## 16. NEW — Buyer Post-Return Feedback (§16)

> **Problem:** When a buyer ignores a nudge and returns anyway, no learning happens. The buyer
> makes the same mistake next time.

### 16.1 When to Show

Condition: ALL of the following must be true:
1. A return is created for `(userId, productId)`.
2. A `nudgeEvent` exists for the same `(userId, productId)` with `shown=true` AND `acted=false`.
3. The return's `reasonCode` or `reasonText` matches the nudge signal:
   - `FIT_NUDGE` → reasonCode `not_as_described` or `changed_mind` + fit keywords in reasonText
   - `BRACKETING_NUDGE` → multiple items of same SKU were purchased
   - `INFO_NUDGE` → reasonCode matches the dominant reason from RIKB

### 16.2 Message Templates (non-accusatory, helpful)

```js
const POST_RETURN_MESSAGES = {
  FIT_NUDGE: "We noticed this item tends to run {verdict}. Next time, check the fit hint " +
             "on the product page — it can help you pick the right size first time.",
  BRACKETING_NUDGE: "Tip: the fit hint on the product page can help you find the right size " +
                    "without ordering multiples. Look for the 📐 icon next time!",
  INFO_NUDGE: "This item is commonly returned for \"{dominantReason}\". " +
              "Next time, check the return insights section on the product page before buying.",
};
```

### 16.3 Implementation

- **Backend:** `prevention.service.getPostReturnMessage(userId, productId, returnReasonCode, reasonText)`
  → returns `{ message: String } | null`.
- **Frontend:** On the return confirmation/success page, call this endpoint. If a message is
  returned, show it in a subtle info card (not a modal, not blocking). One-time display per return.
- **Cost:** Zero. A single DB lookup on `nudgeEvents`, conditional string render.

---

## 17. NEW — Seller Before/After Return Rate Tracking (§17)

> **Problem:** Seller sees "return rate 31%, runs tight" on their dashboard — they update their
> size chart — but never get confirmation that it worked. No positive reinforcement loop.

### 17.1 Implementation

Add one field to `returnInsight.model.js`:

```js
previousReturnRate30d: { type: Number, default: null },  // snapshot from 30 days ago
rateChangeDirection:   { type: String, enum: ['improved','worsened','stable',null], default: null },
```

### 17.2 Nightly Job Addition

In `prevention.job.recomputeReturnInsights()`, before overwriting `returnRate`:

```js
// snapshot the current rate as "30 days ago" for next month's comparison
if (existingDoc && existingDoc.lastComputed < thirtyDaysAgo) {
  existingDoc.previousReturnRate30d = existingDoc.returnRate;
}
// after computing new returnRate:
if (existingDoc.previousReturnRate30d !== null) {
  const delta = newReturnRate - existingDoc.previousReturnRate30d;
  existingDoc.rateChangeDirection = delta < -0.03 ? 'improved'
                                  : delta > 0.03 ? 'worsened'
                                  : 'stable';
}
```

### 17.3 Seller Dashboard Display

```
SKU: Nike Air Max 90
Return Rate: 18%  ↓ from 31% (30 days ago)
✅ "Return rate dropped 13% since your listing update."
```

If `rateChangeDirection === 'worsened'`:
```
⚠️ "Return rate increased — the issue may not be fully resolved."
```

---

## 18. NEW — Phase 5 Real-Time Photo Signal in Scorecard (§18)

> **Problem:** Phase 5 introduces mandatory real-time photo verification. Listings without it
> (legacy listings, or those where the feature is optional) are more likely to cause "looked
> different" returns. The scorecard should know about this.

### 18.1 Signal Addition to Scorecard

Add as the 8th signal in `prevention.scoring.js`:

```js
const SIGNAL_WEIGHTS = {
  PRODUCT_RETURN_RATE:     0.26,   // slightly reduced from 0.28
  FIT_MISMATCH:            0.20,
  USER_RETURN_BEHAVIOUR:   0.20,
  CATEGORY_PRIOR:          0.12,
  BRACKETING_INTENT:       0.12,
  PRICE_BAND:              0.03,
  REVIEW_SENTIMENT_GAP:    0.03,
  PHOTO_VERIFICATION:      0.04,   // NEW — Phase 5 integration
};

// scoring:
photoVerificationScore = (!product.realtimePhotoVerified && FIT_CATEGORIES.includes(category))
                          ? 100 : 0;
// if verified: contributes 0 to risk. If unverified on a visual category: 0.04 * 100 = 4 points.
```

### 18.2 Reason String

```js
PHOTO_VERIFICATION → "This listing has no verified real-time photo — product may differ from images"
```

Only shown when the signal actually fires (unverified + visual category). Never shown for
electronics, books, etc.

### 18.3 Boundary Rule

Phase 7 only **reads** `product.realtimePhotoVerified`. It never writes to listings. Phase 5
owns verification; Phase 7 consumes it.

---

## 19. NEW — Fit Confidence Floor (§19)

> **Problem:** A SKU with 3 returns, 2 mentioning "tight", gets a `runs_small` verdict. But
> 3 data points is noise — showing this on the PDP misleads buyers.

### 19.1 Frontend Enforcement

In the `<FitReturnNote>` component:

```jsx
// Only render fit note when confidence is high enough to be meaningful
if (!insight.fitSignal || insight.fitSignal.confidence < 0.5 || insight.fitSignal.verdict === 'unknown') {
  return null;  // render nothing
}
```

### 19.2 Backend Enforcement (belt-and-suspenders)

In `prevention.service.getProductInsight()`:

```js
const FIT_CONFIDENCE_FLOOR = 0.5;

// sanitize fit signal before returning to frontend
if (insight.fitSignal.confidence < FIT_CONFIDENCE_FLOOR) {
  insight.fitSignal.verdict = 'unknown';
  insight.fitSignal.message = null;
}
```

### 19.3 When It Fires

| Sample size | confidence | Verdict shown? |
|---|---|---|
| 2 mentions | 0.2 | ❌ hidden |
| 4 mentions, 3 small / 1 large | 0.4 | ❌ hidden |
| 8 mentions, 7 small / 1 large | 0.75 | ✅ shown |
| 15 mentions, 8 small / 7 large (balanced) | 0.1 | ❌ hidden (true_to_size but low margin) |

---

## 20. NEW — Prevention Analytics Dashboard (§20)

> The "proof it works" artifact — critical for the hackathon demo and for operational trust.

### 20.1 Endpoint

```
GET /api/prevention/analytics    (admin auth)
```

### 20.2 Response Shape

```json
{
  "period": "last_7_days",
  "nudgesShown": 1243,
  "nudgesActedOn": 534,
  "conversionRate": 0.43,
  "returnsPreventedEstimate": 487,
  "preventionRate": 0.91,
  "byNudgeType": {
    "FIT_NUDGE": { "shown": 620, "acted": 312, "conversion": 0.50 },
    "BRACKETING_NUDGE": { "shown": 89, "acted": 41, "conversion": 0.46 },
    "INFO_NUDGE": { "shown": 410, "acted": 148, "conversion": 0.36 },
    "CONFIDENCE_BOOST": { "shown": 124, "acted": 33, "conversion": 0.27 }
  },
  "topIgnoredSKUs": [ /* top 5 productIds where nudges are ignored most */ ],
  "sellerImprovements": [ /* top 5 sellers whose rates dropped */ ],
  "signalContributions": {
    "PRODUCT_RETURN_RATE": 0.31,
    "FIT_MISMATCH": 0.24,
    "USER_RETURN_BEHAVIOUR": 0.18,
    "BRACKETING_INTENT": 0.14,
    "CATEGORY_PRIOR": 0.08,
    "PHOTO_VERIFICATION": 0.03,
    "PRICE_BAND": 0.01,
    "REVIEW_SENTIMENT_GAP": 0.01
  }
}
```

### 20.3 Frontend — Admin Panel Card

A dedicated card on the admin dashboard showing:
- Big number: "487 returns prevented this week"
- Conversion funnel: shown → acted → purchased → kept
- Per-nudge-type breakdown bar chart
- Flagged ineffective nudges (conversion < 10%)

---

## Updated Build Order Checklist (§13 — revised)

```
[ ] 1.  prevention.contract.js            — priors, lexicon, bands, intervention types (§3.2/3.3/7)
[ ] 2.  returnInsight.model.js            — collection returnInsights + previousReturnRate30d (§3.1/§17)
[ ] 3.  nudgeEvent.model.js               — collection nudgeEvents + TTL index (§15.1)
[ ] 4.  prevention.scoring.js (JS)        — pure scorecard + 8 signals incl PHOTO_VERIFICATION (§4/§18)
[ ] 5.  return_risk.py scorecard          — Python port; assert agreement with JS on §4.3
[ ] 6.  fit mining (mineFit) + fit_intel  — lexicon verdict + confidence floor (§3.3/§6/§19)
[ ] 7.  prevention.job.recompute          — nightly aggregation + before/after tracking + nudge metrics (§3.4/§17/§15.3)
[ ] 8.  prevention.intervention.js (PURE) — decision table + timing + tests (§8.1)
[ ] 9.  prevention.service.js             — getProductInsight, assessCheckoutRisk, sellerInsights,
                                            getRefundTiming, getPostReturnMessage, nudge logging (§8.2/§16)
[ ] 10. controller / routes / validation  — all endpoints incl nudge-event + analytics (§8.3/§15.5/§20)
[ ] 11. seed-prevention.js               — 3 demo SKUs + nudge event examples + print table (§10)
[ ] 12. frontend: prevention.service.js   — api wrappers incl nudge tracking calls (§9.1)
[ ] 13. <FitReturnNote> on PDP            — with confidence floor (§9.2/§19)
[ ] 14. <ReturnRiskNudge> in checkout     — logs nudgeEvent on show + act (§9.3/§15.2)
[ ] 15. <BracketingNudge> + <ReturnInsightsPanel> (seller) + before/after display (§9.4/9.5/§17.3)
[ ] 16. <PostReturnFeedback> on return confirmation page (§16)
[ ] 17. <PreventionAnalytics> admin card (§20)
[ ] 18. cost/storage audit (§11) + full test matrix (§12) + regression check
```

---

## Updated Definition of Done (§14 — revised)

Add to the existing 12 items:

13. ✅ Nudge effectiveness tracking: every nudge fires a `nudgeEvent` log; the nightly job
    computes conversion rates; admin dashboard shows prevention metrics.
14. ✅ Buyer post-return feedback: when a nudge was shown and ignored and the return reason
    matches, a helpful learning message appears on the return confirmation page.
15. ✅ Seller before/after tracking: the dashboard shows return-rate change since the seller
    was shown the insight.
16. ✅ Phase 5 real-time photo signal integrated: listings without a verified real-time photo
    on visual categories contribute a small risk bump in the scorecard.
17. ✅ Fit notes on PDP respect a confidence floor (≥0.5); no misleading verdicts on thin data.

---

## 15. Open Questions (confirm while building)

1. **Currency:** ✅ RESOLVED — all prices in ₹ (INR). Price band cutoffs: <₹200 cheap,
   ₹200–₹800 mid (riskiest), ₹800–₹3000 upper-mid, >₹3000 premium.

2. **Client cart for bracketing:** ✅ RESOLVED — Phase 7 ships a minimal client-side
   `CartContext` (React useState array). No cart backend needed. See §9.4.

3. **Refund-timing owner:** ⏳ DEFERRED — Phase 7 exposes `getRefundTiming()` as a pure
   function. The returns module (Phase 4) will call it when ready. For the hackathon demo,
   cooling-off is shown as a *recommendation* on the UI. It will take effect automatically
   once Phase 4 wires in the call — no Phase 7 changes needed at that point.

4. **Category signal fields in RIKB:** ✅ RESOLVED — `compatSignal` and `dimensionSignal`
   added to `returnInsight.model.js` (§3.1). Lexicons added to `prevention.contract.js` (§3.3).

5. **LightGBM model training:** ✅ RESOLVED — scorecard is primary for hackathon. LightGBM
   infrastructure is scaffolded and wired (§5) but model training is deferred post-hackathon.
   Fallback path runs scorecard automatically when model files are absent.
```

