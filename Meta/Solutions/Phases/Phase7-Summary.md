# Phase 7 — Prevention Intelligence Layer — Summary

> Status: ✅ Complete (revised post-implementation)
> "The most sustainable return is the one that never happens."

---

## What Phase 7 Solves

Returns in e-commerce cluster around predictable expectation mismatches:

| Category | Return Rate | #1 Driver |
|---|---|---|
| Apparel / Clothing | ~25–30% | Fit mismatch (too tight / too loose) |
| Footwear | ~18–22% | Fit + width inconsistency |
| Electronics | ~8–15% | Compatibility, setup difficulty |
| Furniture / Home | ~5–20% | Dimensions vs photos, colour mismatch |

Phase 7 surfaces the right pre-purchase truth for each category and stops the mismatch before checkout — without ever telling the buyer they're being assessed.

---

## Core Design Principles (as actually implemented)

**1. Closed-loop on own data.**
The platform's own `returns`, `reviews`, and `orders` become a growing knowledge base. Every return makes the next purchase smarter. No foreign-trained model, no wrong-population features.

**2. Silent penalty, not transparent friction.**
Risk scoring, refund timing delays, and trust tier penalties all happen invisibly. The buyer never learns their basket was flagged, their refund is delayed, or their return history is being tracked. The only buyer-visible output is a product-level fit/compat/dimension hint on the PDP.

**3. Show almost nothing to the buyer — compute everything.**
The checkout-risk API runs full scoring on every purchase but the response is sanitised before it reaches the client. Only FIT_NUDGE (size up/down hint) ever crosses the wire. Everything else — risk bands, trust tiers, refund timing, user behaviour signals — stays server-side.

**4. No body measurements. No GPU. No new managed services.**
Runs on Atlas M0 + FastAPI + Node.js. Per-request cost = one indexed DB read + pure math.

---

## Architecture

```
PRE-PURCHASE (per request — instant)

  PDP load ──► GET /api/prevention/product/:productId
                     │  reads RIKB → fit/compat/dimension verdict
                     ▼
               <FitReturnNote> renders one-liner or nothing

  Checkout ──► POST /api/prevention/checkout-risk  { items[], userId }
                     │  1. RIKB per item + Phase 3 trust profile
                     │  2. JS scorecard (ML service optional upgrade)
                     │  3. intervention decision (pure function)
                     │  4. sanitizeForClient() strips risk/tier/timing
                     ▼
               { items: [{ intervention: FIT_NUDGE | NONE, fit? }] }
               (riskBand, trustTier, refundTiming NEVER sent to client)

  Seller   ──► GET /api/prevention/seller/insights
               → full RIKB per SKU (rate, signals, AI summary, delta)

NIGHTLY (batch — the closed loop)
  POST /api/prevention/recompute
       aggregate returns + reviews + orders
       mine fit / compat / dimension signal (lexicon)
       upsert returnInsights (one doc per SKU)
       ONE Bedrock call per high-return SKU → cached seller summary
```

---

## What Was Built

### 1. Return Insights Knowledge Base (RIKB) — `returnInsight.model.js`

One compact aggregate document per SKU (≈ 0.5 KB). Never stores raw events.

**Fields per document:**
- `unitsSold`, `unitsReturned`, `returnRate`
- `reasonHistogram` — tally of `defective | not_as_described | changed_mind | wrong_item | other`
- `dominantReason` — the single biggest return driver for the SKU
- `fitSignal` — `{ verdict, smallMentions, largeMentions, sampleSize, confidence }` (apparel/footwear)
- `compatSignal` — `{ verdict, compatMentions, setupMentions, confidence }` (electronics)
- `dimensionSignal` — `{ verdict, largeMentions, smallMentions, colorMentions, confidence }` (furniture/home)
- `topComplaints` — top 5 short phrases extracted from return text
- `sellerSummary` — ONE nightly LLM sentence (cached; Bedrock only)
- `previousReturnRate30d` + `rateChangeDirection` — for seller before/after tracking

**Cold-start backoff:** SKUs with fewer than 5 sales fall back to a category-level rollup, then to published category priors.

---

### 2. Text Mining — `prevention.mining.js`

Pure lexicon-based mining. No NLP model. Runs over `return.reasonText` + `review.text`.

| Signal | Categories | Verdict outputs |
|---|---|---|
| `mineFit` | Apparel, Footwear | `runs_small` / `true_to_size` / `runs_large` / `unknown` |
| `mineCompat` | Electronics | `issues_reported` / `no_issues` / `unknown` |
| `mineDimension` | Furniture, Home | `too_large` / `too_small` / `color_mismatch` / `no_issues` / `unknown` |

**Verdict rule:** dominant side must be ≥ 1.5× the other AND ≥ 3 total mentions. Below threshold → `unknown`.

**Fit confidence floor:** fit notes hidden on PDP if `confidence < 0.5`. Enforced on both backend and frontend.

---

### 3. Return-Risk Scorecard — `prevention.scoring.js`

A pure function. 0–100 score where 100 = maximum return risk. Eight signals, weights sum to 1.

| Signal | Weight | Max risk when… |
|---|---|---|
| Product Return Rate | 0.26 | SKU return rate ≥ 40% |
| Fit Mismatch | 0.20 | Apparel/footwear, non-true-to-size verdict, buyer didn't size-adjust |
| User Return Behaviour | 0.20 | High personal return rate / risky tier |
| Category Prior | 0.12 | High-return category |
| Bracketing Intent | 0.12 | Duplicate SKU in cart (scored internally only — never shown to buyer) |
| Price Band | 0.03 | Mid-price "try it" band |
| Review Sentiment Gap | 0.03 | Rating < 3.5 with ≥ 5 reviews |
| Photo Verification | 0.04 | Visual category + no real-time photo verified |

**Score bands:** < 35 = `low` · 35–65 = `medium` · > 65 = `high`

**Tier floors/caps:**
- `restricted` → user signal floored at 90
- `watch` → floored at 60
- `verified` → capped at 20 (genuine users never penalised)

> Note: `BRACKETING_INTENT` still contributes to the internal risk score for refund timing decisions, but no `BRACKETING_NUDGE` is ever shown to the buyer. Buyers can add as many multiples as they want without being told.

---

### 4. Intervention Engine — `prevention.intervention.js`

Pure decision table. Maps `(riskBand × trustTier × context)` → intervention.

**Current priority order (post-revision):**

1. **Fit action available** → `FIT_NUDGE` — only intervention that reaches the client
2. **High risk** → `INFO_NUDGE` — computed internally, stripped from client response
3. **Medium risk** → `INFO_NUDGE` — computed internally, stripped from client response
4. **Low + verified/trusted** → `CONFIDENCE_BOOST` — computed internally, never shown
5. **Low + everyone else** → `NONE`

**What was removed:**
- `BRACKETING_NUDGE` — disabled. Multi-item purchases are never flagged to the buyer.
- `INFO_NUDGE` client rendering — removed. "This item is commonly returned" was discouraging purchases without actionable guidance.
- `CONFIDENCE_BOOST` client rendering — removed. Verified buyers don't need to be told they're trusted.
- `COOLING_OFF` client rendering — removed. Refund delays are applied silently.

**Refund timing rule (still active, just invisible):**
- `verified` or `trusted` → always `instant`
- `standard/watch/restricted` + `high` band → `delayed` (36h cooling-off after grading)
- Everything else → `instant`

The buyer always sees "Your return is being processed." regardless of actual timing.

---

### 5. Prevention Service — `prevention.service.js`

Orchestrates everything. Key functions:

| Function | What it does |
|---|---|
| `getProductInsight(productId)` | RIKB lookup with cold-start backoff; applies fit confidence floor |
| `assessCheckoutRisk({ userId, items })` | Full scoring pipeline → `sanitizeForClient()` strips sensitive fields before response |
| `sanitizeForClient(raw)` | Strips `trustTier`, `basketRisk`, `refundTiming`, `coolingOffHours`, `riskBand`, `probability` from client response. Filters `topReasons` to product-level only. Only FIT_NUDGE interventions reach the client. |
| `getSellerInsights(sellerId)` | Returns full RIKB docs for seller's products |
| `getRefundTiming(...)` | Phase 4 frozen interface — returns `instant` or `delayed`. Phase 7 never writes refund state. |
| `runRecompute()` | Triggers the nightly aggregation job |

**Removed:** `getPostReturnMessage()` — the "we told you so" learning card after an ignored nudge was removed because it surfaced risk-system internals to the buyer.

**JS scorecard fallback:** if ML service is down, `jsScorecardFallback()` runs the same math locally. Checkout never returns a 500.

---

### 6. Nightly Job — `prevention.job.js`

Idempotent, re-runnable. Triggered via `POST /api/prevention/recompute` (admin/dev) or nightly cron in prod.

```
For each SKU with any order or return:
  → count sold, returned → returnRate
  → tally reasonCode histogram → dominantReason
  → mine fit/compat/dimension signal from reasonText + reviews
  → extract top 5 complaint phrases
  → snapshot previousReturnRate30d if doc is > 30 days old
  → compute rateChangeDirection (improved / worsened / stable)
  → upsert returnInsights doc

For each category:
  → aggregate → upsert category-scope rollup doc (cold-start backoff)

For SKUs with returnRate ≥ 15% AND unitsReturned ≥ 3 AND cluster changed:
  → ONE Bedrock call → cached sellerSummary
```

**LLM cost rule:** Bedrock is touched only in this batch, only for high-return SKUs, only when the complaint cluster changed.

---

### 7. Nudge Effectiveness Tracking — `nudgeEvent.model.js`

Only FIT_NUDGE events are logged (the only intervention type visible to buyers). Other intervention types are computed silently and do not generate impression events.

**Tracked outcomes:** `shown` → `acted` → `purchased` → `returned`

**Analytics available at:** `GET /api/prevention/analytics?days=N` (admin only in production)

---

### 8. API Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/prevention/health` | none | Health check |
| GET | `/api/prevention/product/:productId` | none | PDP fit note + return insight |
| POST | `/api/prevention/checkout-risk` | optional | Full risk scoring — sanitised response to client |
| GET | `/api/prevention/seller/insights` | seller | Per-SKU return rates + fit verdicts + AI summary |
| POST | `/api/prevention/recompute` | admin/dev | Trigger nightly RIKB recomputation |
| PATCH | `/api/prevention/nudge-event/:id` | buyer | Update nudge outcome (acted/purchased) |
| GET | `/api/prevention/refund-timing` | internal | Phase 4 frozen interface |
| GET | `/api/prevention/analytics` | admin | Weekly prevention metrics |

**Removed endpoint:** `GET /api/prevention/post-return-message` — retired with the PostReturnFeedback component.

---

### 9. Frontend Components

| Component | Where | What it shows | Status |
|---|---|---|---|
| `<FitReturnNote>` | Product Detail Page | Honest one-liner: "Runs small — consider sizing up." Hidden when `confidence < 0.5` or `verdict = unknown`. No generic return-rate percentage shown (would discourage purchase). | ✅ Active |
| `<ReturnRiskNudge>` | ~~Checkout / Buy Now~~ | ~~Non-blocking banner~~ | ❌ Removed from Buy Now flow. Fit hint is already visible on PDP — showing it again at checkout was redundant. |
| `<ReturnInsightsPanel>` | Seller Dashboard → Return Insights tab | Per-SKU: return rate bar, dominant reason, fit/compat/dim badges, before/after delta, AI insight box. Light theme matching main site. | ✅ Active |
| `<BracketingNudge>` | ~~Checkout~~ | ~~"You've added 3 of these"~~ | ❌ Removed. Telling buyers they've added multiples suppresses cart size and basket profit. |
| `<PostReturnFeedback>` | ~~Return Confirmation~~ | ~~"We warned you last time"~~ | ❌ Removed. Surfaced risk-system internals to the buyer ("we tracked that you ignored a nudge"). |
| `<TrustTierBadge>` | Item Status Page, Item Evidence Page | Every buyer sees: "🛡 Return in Progress — Your return is being processed." Regardless of actual tier (verified/watch/restricted). Admin mode (`adminMode=true`) shows real tier for dashboards. | ✅ Revised |

---

## What the Buyer Sees vs What Happens Internally

| Situation | Buyer sees | What actually happens |
|---|---|---|
| Views footwear PDP with `runs_small` signal | "🧵 Runs small — consider sizing up." | RIKB lookup, confidence check |
| Views electronics PDP with compat issues | "🔌 Buyers commonly report compatibility issues." | Same |
| Views any other product | Nothing | Same |
| Clicks Buy Now | Checkout modal opens immediately | Full 8-signal scorecard runs, risk band computed, refund timing decided |
| `watch` tier buyer + high-risk basket | Normal checkout, normal confirmation | `refundTiming: delayed` sent to Phase 4. 36h hold applied silently. |
| `verified` tier buyer | Normal checkout | `refundTiming: instant` always |
| Initiates return | "Your return is being processed." | Phase 4 calls `getRefundTiming()` to decide actual delay |
| Adds 5 of same item | Nothing | `bracketingIntent` contributes to risk score internally |

---

## Seller Dashboard — Return Intelligence Tab

Light-themed panel (`<ReturnInsightsPanel>`) showing:
- Summary bar: avg return rate across SKUs, count of high-risk SKUs (≥20%), count improving
- Per-SKU cards with:
  - Color-coded return rate bar (green → red)
  - Units sold / returned
  - Dominant reason
  - Fit/compat/dimension signal badges
  - `↓ Improving` / `↑ Worsening` / `— Stable` trend badge with before/after rates
  - `High Risk` / `Healthy` SKU-level badge
  - AI insight box (Bedrock seller summary when available)

---

## Demo Seed — `seed-prevention.js`

Creates 6 SKUs assigned to `mock_seller` with realistic return patterns:

| SKU | Category | Return Rate | Signal |
|---|---|---|---|
| CloudRun Marathon Shoes | footwear | ~30% | `runs_small` |
| Premium Slim Fit Tee | apparel | ~28% | `runs_large` |
| ProSound Wireless Earbuds X5 | electronics | ~18% | `issues_reported` |
| ModernWave Floating Wall Shelf | home | ~22% | `too_large` |
| BabyView Smart Baby Monitor | electronics | ~5% | clean |
| Urban Fleece Pullover Hoodie | apparel | ~14% (was ~40%) | `↓ improved` |

Also creates 3 buyer trust personas: Priya (verified), Rahul (trusted), Risky Buyer (watch).

**To seed:** `node seed-prevention.js` then `POST /api/prevention/recompute`

---

## Module Boundaries

**Owns (writes to):**
- `returnInsights` collection
- `nudgeEvents` collection (FIT_NUDGE only)

**Consumes (read-only):**
- `trust.service.getTrustProfile(userId)` — Phase 3, never recomputed here
- `Return`, `Order`, `Review`, `Product` collections
- `product.realtimePhotoVerified` — Phase 5 field

**Never touches:**
- `trust/`, `grading/`, `routing/`, `returns/`, `secondhand/`, `items/`, `seed.js`, `order.service.createOrder`

---

## Cost & Storage Budget

| Item | Budget |
|---|---|
| `returnInsights` docs | ~0.5 KB × SKU count |
| `nudgeEvents` | Auto-expires after 90 days (TTL index). Only FIT_NUDGE events logged. |
| Per PDP request | 1 indexed `findOne` — no LLM, no vision call |
| Per checkout-risk call | 1 trust read + N RIKB reads + pure math |
| LLM (Bedrock) | Nightly only, gated by threshold, cached |
| GPU | None |
| New managed services | None |

---

## LightGBM Model — Deferred Post-Hackathon

JS scorecard is the primary risk engine. LightGBM is scaffolded in `ml-service/app/services/return_risk.py` — drop trained artifacts into `trained_models/` post-hackathon and it picks up automatically. Not trained now because on synthetic data it would just re-learn the scorecard's own formula with added opacity.

---

## Summary of Post-Implementation Changes

These decisions were made after the initial build based on product direction:

| Change | Reason |
|---|---|
| Removed `BRACKETING_NUDGE` from buyer UI | Telling buyers "you've added multiples" suppresses basket size and harms revenue |
| Removed `INFO_NUDGE` from client response | "This item is commonly returned" discourages purchase without giving the buyer anything actionable |
| Removed generic return-rate % from PDP | Same reason — a raw percentage discourages without helping |
| Removed `CONFIDENCE_BOOST` from client | Verified buyers don't need to be told they're verified |
| Removed `COOLING_OFF` message from client | Refund delay is a silent penalty — buyer should not know they're being held |
| Removed `PostReturnFeedback` component | "We warned you last time" leaks that we tracked their ignored nudge |
| Removed `ReturnRiskNudge` from Buy Now flow | Fit hint already visible on PDP — showing it again at checkout was redundant |
| Neutralised `<TrustTierBadge>` for buyers | All tiers show same "Return in Progress" copy — buyer never sees Watch/Restricted label |
| `sanitizeForClient()` added to checkout-risk | API never exposes `trustTier`, `basketRisk`, `refundTiming`, `riskBand`, or user-behaviour reasons to the client |
| `nudgeEvent` logging restricted to FIT_NUDGE | Only visible nudges should generate impression events |
| Seller dashboard rethemed | Matched main site palette (`#EAEDED` bg, white cards, `#FF9900` accent) |
| `ReturnInsightsPanel` rethemed | Same — was dark zinc, now light gray/white matching main site |
| `seed-prevention.js` rewritten | Now uses `mock_seller` so Return Insights tab shows data immediately on login |
| Cart page added | `localStorage`-persisted cart with quantity controls, `<CheckoutModal>` reused for multi-item payment |
| `CheckoutModal` extended | Now supports both single-product (Buy Now) and cart (multi-item) with line-item summary |
