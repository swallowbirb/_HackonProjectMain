/**
 * prevention.scoring.js — PURE scoring functions (no DB, no async).
 *
 * Mirrors §4 of Phase7-Prevention.md exactly. Risk is 0–100 where 100 = MAX
 * return risk (opposite polarity to trust score where 100 = good).
 *
 * Inputs: a `features` object built by prevention.service.js from DB reads.
 * Output: { riskScore, band, signalScores[], topReasons[] }.
 *
 * This is also the JS scorecard fallback used when the ML service is down.
 * Tested against the Python scorecard in return_risk.py — both must agree on
 * the §4.3 worked examples.
 */

const {
  BAND_THRESHOLDS,
  CATEGORY_RETURN_PRIORS,
  MIN_SALES_FOR_OWN_RATE,
  FIT_CATEGORIES,
  ELECTRONICS_CATEGORIES,
  FURNITURE_CATEGORIES,
  VISUAL_CATEGORIES,
  PRICE_BANDS_INR,
  REASON_STRINGS,
} = require('../../contracts/prevention.contract');

// ── Signal weights (sum to 1.00) ────────────────────────────────────────────
// Re-balanced to make room for PHOTO_VERIFICATION (Phase 5 integration, §18).
const SIGNAL_WEIGHTS = Object.freeze({
  PRODUCT_RETURN_RATE: 0.26,
  FIT_MISMATCH: 0.20,
  USER_RETURN_BEHAVIOUR: 0.20,
  CATEGORY_PRIOR: 0.12,
  BRACKETING_INTENT: 0.12,
  PRICE_BAND: 0.03,
  REVIEW_SENTIMENT_GAP: 0.03,
  PHOTO_VERIFICATION: 0.04,
});

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
const norm = (cat) => String(cat || '').toLowerCase().trim();

// ── Category resolution ────────────────────────────────────────────────────
function categoryGroup(category) {
  const c = norm(category);
  if (FIT_CATEGORIES.includes(c)) return 'apparel';
  if (ELECTRONICS_CATEGORIES.includes(c)) return 'electronics';
  if (FURNITURE_CATEGORIES.includes(c)) return 'furniture';
  return 'other';
}

function categoryPriorFor(category) {
  return CATEGORY_RETURN_PRIORS[norm(category)] ?? CATEGORY_RETURN_PRIORS.default;
}

// ── Per-signal scoring (each returns 0..100, 100 = max risk) ───────────────

/** PRODUCT_RETURN_RATE — saturate at 0.40 (40% return rate). */
function scoreProductReturnRate(insight, category) {
  const unitsSold = (insight && insight.unitsSold) || 0;
  const skuRate =
    unitsSold >= MIN_SALES_FOR_OWN_RATE
      ? (insight && insight.returnRate) || 0
      : categoryPriorFor(category);
  return clamp(skuRate / 0.40, 0, 1) * 100;
}

/** CATEGORY_PRIOR — saturate at 0.30 (apparel ~28%, footwear ~20%, electronics ~8%). */
function scoreCategoryPrior(category) {
  return clamp(categoryPriorFor(category) / 0.30, 0, 1) * 100;
}

/**
 * FIT_MISMATCH — category-aware:
 *   apparel/footwear → fitSignal (runs_small/runs_large)
 *   electronics      → compatSignal (issues_reported)
 *   furniture/home   → dimensionSignal (too_large/too_small/color_mismatch)
 *   other            → 0
 *
 * `buyerActedOnFit` (true if client passed sizeAdjusted=true) zeros the apparel
 * score — the buyer already took the advice.
 */
function scoreFitMismatch(insight, category, buyerActedOnFit) {
  const group = categoryGroup(category);

  if (group === 'apparel') {
    const sig = (insight && insight.fitSignal) || {};
    if (buyerActedOnFit) return 0;
    if (sig.verdict === 'runs_small' || sig.verdict === 'runs_large') {
      return (Number(sig.confidence) || 0) * 100;
    }
    return 0;
  }

  if (group === 'electronics') {
    const sig = (insight && insight.compatSignal) || {};
    if (sig.verdict === 'issues_reported') {
      return (Number(sig.confidence) || 0) * 100;
    }
    return 0;
  }

  if (group === 'furniture') {
    const sig = (insight && insight.dimensionSignal) || {};
    const RISKY = ['too_large', 'too_small', 'color_mismatch'];
    if (RISKY.includes(sig.verdict)) {
      return (Number(sig.confidence) || 0) * 100;
    }
    return 0;
  }

  return 0;
}

/**
 * USER_RETURN_BEHAVIOUR — composite of lifetime + recent-90d return rates,
 * floor/ceiling-clamped by trust tier (the tier already encodes risk).
 * Missing trust profile → treated as `standard`, score = 0.
 */
function scoreUserReturnBehaviour(trust) {
  if (!trust) return 0;
  const rr = Number(trust.returnRate) || 0;
  const r90 = Number(trust.recentReturnRate90d) || 0;
  let score = 0.6 * clamp(rr / 0.40, 0, 1) * 100 + 0.4 * clamp(r90 / 0.50, 0, 1) * 100;

  switch (trust.tier) {
    case 'restricted':
      score = Math.max(score, 90);
      break;
    case 'watch':
      score = Math.max(score, 60);
      break;
    case 'verified':
      score = Math.min(score, 20); // genuine users capped LOW
      break;
    case 'trusted':
      score = Math.min(score, 35); // trusted also capped, but slightly higher
      break;
    default:
      // standard — no clamp
      break;
  }
  return clamp(score, 0, 100);
}

/**
 * BRACKETING_INTENT — basket signal + historical flag.
 * `bracketingIntent` is true when the cart contains the same productId twice
 * OR ≥2 items share the same category with quantity>1.
 */
function scoreBracketingIntent(bracketingIntent, trust) {
  if (bracketingIntent) return 100;
  if (trust && trust.bracketingFlag) return 60;
  return 0;
}

/**
 * PRICE_BAND — INR bands. Mid ₹200–₹800 is the "I'll just try it" zone (riskiest).
 */
function scorePriceBand(priceInr) {
  const p = Number(priceInr) || 0;
  if (p < PRICE_BANDS_INR.CHEAP_MAX) return 20;
  if (p < PRICE_BANDS_INR.MID_MAX) return 100;
  if (p < PRICE_BANDS_INR.UPPER_MID_MAX) return 60;
  return 30;
}

/** REVIEW_SENTIMENT_GAP — low rating with enough reviews bumps risk. */
function scoreReviewSentimentGap(reviewCount, rating) {
  const rc = Number(reviewCount) || 0;
  const rt = Number(rating) || 0;
  if (rc < 5) return 0;
  if (rt >= 3.5) return 0;
  return clamp((3.5 - rt) / 2.5, 0, 1) * 100;
}

/**
 * PHOTO_VERIFICATION — Phase 5 integration (§18).
 * Listings without a verified real-time photo on a visual category get a small
 * risk bump. Verified listings contribute 0.
 */
function scorePhotoVerification(realtimePhotoVerified, category) {
  if (realtimePhotoVerified === true) return 0;
  if (!VISUAL_CATEGORIES.includes(norm(category))) return 0;
  return 100; // multiplied by the small weight (0.04) → +4 risk points
}

// ── Aggregate scorecard ────────────────────────────────────────────────────

/**
 * computeScorecard(features) → { riskScore, band, signalScores, topReasons }.
 *
 * `features` shape (built by prevention.service from DB reads):
 *   {
 *     category, priceInr, reviewCount, averageRating, realtimePhotoVerified,
 *     insight: { unitsSold, returnRate, fitSignal, compatSignal, dimensionSignal,
 *                dominantReason },
 *     trust: { tier, returnRate, recentReturnRate90d, bracketingFlag } | null,
 *     bracketingIntent: Boolean,
 *     buyerActedOnFit: Boolean,
 *   }
 */
function computeScorecard(features) {
  const f = features || {};
  const insight = f.insight || {};
  const trust = f.trust || null;

  const signalScores = {
    PRODUCT_RETURN_RATE: scoreProductReturnRate(insight, f.category),
    FIT_MISMATCH: scoreFitMismatch(insight, f.category, !!f.buyerActedOnFit),
    USER_RETURN_BEHAVIOUR: scoreUserReturnBehaviour(trust),
    CATEGORY_PRIOR: scoreCategoryPrior(f.category),
    BRACKETING_INTENT: scoreBracketingIntent(!!f.bracketingIntent, trust),
    PRICE_BAND: scorePriceBand(f.priceInr),
    REVIEW_SENTIMENT_GAP: scoreReviewSentimentGap(f.reviewCount, f.averageRating),
    PHOTO_VERIFICATION: scorePhotoVerification(f.realtimePhotoVerified, f.category),
  };

  const contributions = Object.entries(signalScores).map(([signal, score]) => ({
    signal,
    score: round1(score),
    weight: SIGNAL_WEIGHTS[signal],
    contribution: round2(score * SIGNAL_WEIGHTS[signal]),
  }));

  const riskScore = clamp(
    contributions.reduce((sum, c) => sum + c.contribution, 0),
    0,
    100
  );

  const band =
    riskScore > BAND_THRESHOLDS.HIGH
      ? 'high'
      : riskScore >= BAND_THRESHOLDS.MEDIUM
      ? 'medium'
      : 'low';

  // Top reasons — top-3 by raw contribution, but suppress USER_RETURN_BEHAVIOUR
  // for verified/trusted users (we never accuse genuine buyers).
  const genuine = trust && (trust.tier === 'verified' || trust.tier === 'trusted');
  const eligible = contributions.filter((c) => {
    if (c.contribution <= 0) return false;
    if (c.signal === 'USER_RETURN_BEHAVIOUR' && genuine) return false;
    return true;
  });
  const top = [...eligible].sort((a, b) => b.contribution - a.contribution).slice(0, 3);
  const topReasons = top.map((c) => buildReason(c, features, signalScores));

  return {
    riskScore: Math.round(riskScore),
    band,
    signalScores,
    contributions,
    topReasons,
  };
}

/** buildReason — turn a contribution into a human-readable string. */
function buildReason(contribution, features, signalScores) {
  const f = features || {};
  const insight = f.insight || {};
  const tmpl = REASON_STRINGS[contribution.signal] || contribution.signal;

  switch (contribution.signal) {
    case 'PRODUCT_RETURN_RATE': {
      const pct = Math.round(((insight.returnRate || 0) * 100));
      return {
        signal: 'PRODUCT_RETURN_RATE',
        weight: contribution.weight,
        contribution: contribution.contribution,
        message: tmpl.replace('{pct}', pct),
      };
    }
    case 'FIT_MISMATCH': {
      const group = categoryGroup(f.category);
      let verdict = 'differently';
      let issue = 'expectation mismatch';
      if (group === 'apparel') {
        verdict = (insight.fitSignal && insight.fitSignal.verdict) === 'runs_large' ? 'large' : 'small';
        issue = verdict === 'small' ? 'tightness' : 'looseness';
      } else if (group === 'electronics') {
        verdict = 'with compatibility issues';
        issue = 'setup or compatibility';
      } else if (group === 'furniture') {
        const v = (insight.dimensionSignal && insight.dimensionSignal.verdict) || 'unknown';
        verdict = v === 'too_small' ? 'small' : v === 'too_large' ? 'large' : 'differently';
        issue = v === 'color_mismatch' ? 'color difference' : 'size mismatch';
      }
      return {
        signal: 'FIT_MISMATCH',
        weight: contribution.weight,
        contribution: contribution.contribution,
        message: tmpl.replace('{verdict}', verdict).replace('{issue}', issue),
      };
    }
    case 'CATEGORY_PRIOR': {
      const cat = String(f.category || 'these').replace(/^\w/, (m) => m.toUpperCase());
      return {
        signal: 'CATEGORY_PRIOR',
        weight: contribution.weight,
        contribution: contribution.contribution,
        message: tmpl.replace('{category}', cat),
      };
    }
    default:
      return {
        signal: contribution.signal,
        weight: contribution.weight,
        contribution: contribution.contribution,
        message: tmpl,
      };
  }
}

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

module.exports = {
  // public
  computeScorecard,
  // exported for tests + service
  SIGNAL_WEIGHTS,
  scoreProductReturnRate,
  scoreCategoryPrior,
  scoreFitMismatch,
  scoreUserReturnBehaviour,
  scoreBracketingIntent,
  scorePriceBand,
  scoreReviewSentimentGap,
  scorePhotoVerification,
  categoryGroup,
  categoryPriorFor,
};
