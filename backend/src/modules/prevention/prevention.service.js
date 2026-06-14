/**
 * prevention.service.js — DB I/O + orchestration for Phase 7.
 *
 * Reads (read-only): products, returns, orders, reviews, plus Phase 3 trust
 * profiles via getTrustProfile().
 *
 * Writes: ONLY returnInsights and nudgeEvents (Phase 7's own collections).
 *
 * The pure scoring math lives in prevention.scoring.js. The pure decision
 * table lives in prevention.intervention.js. This file gathers facts, calls
 * the ML service (with a JS scorecard fallback), and persists nudge events.
 *
 * Frozen interface for Phase 4: getRefundTiming({ userId, productId, riskBand }).
 */

const axios = require('axios');

const ReturnInsight = require('./returnInsight.model');
const NudgeEvent = require('./nudgeEvent.model');
const Product = require('../products/product.model');
const Order = require('../orders/order.model');
const Return = require('../returns/return.model');

const trustService = require('../trust/trust.service');

const { computeScorecard } = require('./prevention.scoring');
const { decideIntervention, timing, worstRefundTiming, worstBand } = require('./prevention.intervention');
const { recomputeReturnInsights } = require('./prevention.job');

const {
  CATEGORY_RETURN_PRIORS,
  FIT_CONFIDENCE_FLOOR,
  FIT_CATEGORIES,
  REFUND_TIMING,
  COOLING_OFF_HOURS,
} = require('../../contracts/prevention.contract');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
const ML_TIMEOUT_MS = Number(process.env.ML_PREDICT_TIMEOUT_MS) || 4000;

// ── Helpers ────────────────────────────────────────────────────────────────

/** Normalise a category for comparisons against contract lists. */
const normCat = (c) => String(c || '').toLowerCase().trim();

/**
 * categoryBackoff(category) → ReturnInsight-like object built from the
 * `(scope:'category', category)` rollup, or a seeded prior if even that's
 * missing. Always returns a usable shape — never null.
 */
async function categoryBackoff(category) {
  const cat = normCat(category);
  const rollup = await ReturnInsight.findOne({ scope: 'category', category: cat }).lean();
  if (rollup) return rollup;
  const prior = CATEGORY_RETURN_PRIORS[cat] ?? CATEGORY_RETURN_PRIORS.default;
  return {
    productId: null,
    scope: 'category',
    category: cat,
    unitsSold: 0,
    unitsReturned: 0,
    returnRate: prior,
    reasonHistogram: {},
    dominantReason: null,
    fitSignal: { verdict: 'unknown', confidence: 0 },
    compatSignal: { verdict: 'unknown', confidence: 0 },
    dimensionSignal: { verdict: 'unknown', confidence: 0 },
    topComplaints: [],
    sellerSummary: null,
    isPrior: true,
  };
}

/** Drop low-confidence fit verdicts before they hit the frontend (§19). */
function applyFitConfidenceFloor(insight) {
  if (!insight || !insight.fitSignal) return insight;
  const c = insight.fitSignal.confidence || 0;
  if (c < FIT_CONFIDENCE_FLOOR) {
    insight.fitSignal = { ...insight.fitSignal, verdict: 'unknown' };
  }
  return insight;
}

/**
 * keptBrandHistory(userId, product) — does this user have a same-brand
 * same-category past order with NO matching return? Drives the personalised
 * fit hint ("You took M in Nike and kept it.").
 */
async function keptBrandHistory(userId, product) {
  if (!userId || !product || !product.brandName) return null;
  const sameBrandProducts = await Product.find({
    brandName: product.brandName,
    category: product.category,
    _id: { $ne: product._id },
  })
    .select('_id')
    .lean();
  const ids = sameBrandProducts.map((p) => p._id);
  if (ids.length === 0) return null;

  const orders = await Order.find({
    buyerId: userId,
    productId: { $in: ids },
    status: 'completed',
  })
    .select('_id productId')
    .lean();
  if (orders.length === 0) return null;

  // Any of those orders returned?
  const returnedOrderIds = await Return.distinct('orderId', {
    userId,
    orderId: { $in: orders.map((o) => o._id) },
  });
  const kept = orders.find((o) => !returnedOrderIds.some((rid) => String(rid) === String(o._id)));
  if (!kept) return null;
  return { brand: product.brandName, productId: kept.productId };
}

// ── ML service calls (with JS scorecard fallback) ──────────────────────────

function buildFeaturePayload({
  product,
  insight,
  trust,
  bracketingIntent,
  buyerActedOnFit,
}) {
  return {
    category: product?.category,
    priceInr: product?.price,
    reviewCount: product?.reviewCount,
    averageRating: product?.averageRating,
    realtimePhotoVerified: product?.realtimePhotoVerified ?? null, // Phase 5 field (may be absent)
    insight: {
      unitsSold: insight?.unitsSold || 0,
      returnRate: insight?.returnRate || 0,
      fitSignal: insight?.fitSignal || {},
      compatSignal: insight?.compatSignal || {},
      dimensionSignal: insight?.dimensionSignal || {},
      dominantReason: insight?.dominantReason || null,
    },
    trust: trust
      ? {
          tier: trust.tier,
          returnRate: trust.returnRate,
          recentReturnRate90d: trust.recentReturnRate90d,
          bracketingFlag: !!trust.bracketingFlag,
        }
      : null,
    bracketingIntent: !!bracketingIntent,
    buyerActedOnFit: !!buyerActedOnFit,
  };
}

/** jsScorecardFallback — produces a result shaped like the ML response. */
function jsScorecardFallback(features) {
  const sc = computeScorecard(features);
  return {
    return_probability: round3(sc.riskScore / 100),
    risk_band: sc.band,
    scorecard_score: sc.riskScore,
    top_reasons: sc.topReasons,
    used_fallback: true,
    model_version: 'js-scorecard',
    contributions: sc.contributions,
  };
}

async function callMlPredictReturn(features) {
  try {
    const { data } = await axios.post(
      `${ML_SERVICE_URL}/predict/return`,
      { features },
      { timeout: ML_TIMEOUT_MS }
    );
    if (!data || data.risk_band == null) {
      throw new Error('ml service returned malformed payload');
    }
    return data;
  } catch (e) {
    return jsScorecardFallback(features);
  }
}

async function callMlFitRecommend(insight, category, keptHistory) {
  try {
    const { data } = await axios.post(
      `${ML_SERVICE_URL}/predict/fit-recommend`,
      {
        fit_signal: insight?.fitSignal || {},
        category,
        kept_brand_history: keptHistory || null,
      },
      { timeout: ML_TIMEOUT_MS }
    );
    return data || { verdict: 'unknown', message: null, suggested_action: null, confidence: 0 };
  } catch (e) {
    // Local fallback — mirrors fit_intel.recommend()
    const sig = (insight && insight.fitSignal) || {};
    if (!FIT_CATEGORIES.includes(normCat(category)) || !sig.verdict || sig.verdict === 'unknown') {
      return { verdict: 'unknown', message: null, suggested_action: null, confidence: 0 };
    }
    if (sig.verdict === 'runs_small') {
      return {
        verdict: 'runs_small',
        message: 'Runs small — most returns cite tightness. Consider sizing up.',
        suggested_action: 'SIZE_UP',
        confidence: sig.confidence || 0,
      };
    }
    if (sig.verdict === 'runs_large') {
      return {
        verdict: 'runs_large',
        message: 'Runs large — most returns cite looseness. Consider sizing down.',
        suggested_action: 'SIZE_DOWN',
        confidence: sig.confidence || 0,
      };
    }
    return { verdict: 'true_to_size', message: null, suggested_action: null, confidence: sig.confidence || 0 };
  }
}

// ── Bracketing detection ───────────────────────────────────────────────────

function detectBracketingIntent(items, currentItem, trust) {
  if (!Array.isArray(items) || items.length === 0) return false;
  const sameProduct = items.filter(
    (i) => String(i.productId) === String(currentItem.productId)
  );
  if (sameProduct.length > 1) return true;
  const totalQtyForSku = sameProduct.reduce((n, i) => n + (i.quantity || 1), 0);
  if (totalQtyForSku > 1) return true;
  if (trust && trust.bracketingFlag) return true;
  return false;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * getProductInsight(productId) — drives the PDP `<FitReturnNote />`.
 * Returns a sanitized snapshot with low-confidence fit verdicts dropped.
 */
async function getProductInsight(productId) {
  const product = await Product.findById(productId).select('category brandName price').lean();
  if (!product) return null;

  let doc = await ReturnInsight.findOne({ productId, scope: 'product' }).lean();
  if (!doc) {
    doc = await categoryBackoff(product.category);
  }
  applyFitConfidenceFloor(doc);

  return {
    productId: String(productId),
    category: doc.category,
    returnRate: doc.returnRate || 0,
    dominantReason: doc.dominantReason || null,
    fitSignal: doc.fitSignal || { verdict: 'unknown', confidence: 0 },
    compatSignal: doc.compatSignal || { verdict: 'unknown', confidence: 0 },
    dimensionSignal: doc.dimensionSignal || { verdict: 'unknown', confidence: 0 },
    topComplaints: doc.topComplaints || [],
    sellerSummary: doc.sellerSummary || null,
    isPrior: !!doc.isPrior,
  };
}

/**
 * assessCheckoutRisk({ userId, items }) — drives `<ReturnRiskNudge />`.
 *
 * For each cart item: build the feature payload, call the ML service (or
 * fall back to JS scorecard), get a fit recommendation, and decide the
 * intervention. Logs a NudgeEvent for every non-NONE intervention so we can
 * track effectiveness (§15).
 *
 * Basket-level: worst-band + worst-refund-timing wins.
 */
/**
 * sanitizeForClient(rawResult) — strip any signal that lets the buyer infer
 * they personally have been flagged.
 *
 * Phase 7 still computes everything internally (risk band, trust tier, refund
 * timing, all reasons). But what reaches the client is reduced to:
 *   - product-level fit help (FIT_NUDGE only)
 *   - product-level reasons (everything except user-behaviour and bracketing)
 *
 * Refund timing, cooling-off hours, basket risk band, and trust tier never
 * cross the wire to the buyer. Phase 4 reads refund timing through the
 * internal `getRefundTiming` interface, not through this response.
 */
const PRODUCT_LEVEL_REASON_CODES = new Set([
  'PRODUCT_RETURN_RATE',
  'FIT_MISMATCH',
  'CATEGORY_PRIOR',
  'PRICE_BAND',
  'REVIEW_SENTIMENT_GAP',
  'PHOTO_VERIFICATION',
]);

function sanitizeForClient(raw) {
  const items = (raw.items || []).map((it) => {
    const interventionType = it.intervention && it.intervention.type;
    // Only FIT_NUDGE survives to the client. INFO_NUDGE, COOLING_OFF,
    // CONFIDENCE_BOOST, and BRACKETING_NUDGE all become NONE so the UI
    // never says anything about user behaviour or risk.
    const safeIntervention =
      interventionType === 'FIT_NUDGE'
        ? { type: 'FIT_NUDGE', action: it.intervention.action || null }
        : { type: 'NONE' };

    const safeReasons = (it.topReasons || []).filter(
      (r) => r && PRODUCT_LEVEL_REASON_CODES.has(r.code)
    );

    return {
      productId: it.productId,
      title: it.title,
      category: it.category,
      // intentionally omitted: probability, riskBand, scorecardScore, modelVersion, usedFallback
      topReasons: safeReasons,
      fit: it.fit && it.fit.verdict !== 'unknown' ? it.fit : null,
      intervention: safeIntervention,
      nudgeEventId: safeIntervention.type === 'FIT_NUDGE' ? it.nudgeEventId : null,
    };
  });

  return { items };
}

async function assessCheckoutRisk({ userId, items }) {
  if (!Array.isArray(items) || items.length === 0) {
    return { items: [] };
  }

  const trust = userId ? await trustService.getTrustProfile(userId).catch(() => null) : null;
  const trustTier = (trust && trust.tier) || 'standard';

  const perItem = [];
  for (const item of items) {
    const product = await Product.findById(item.productId).lean();
    if (!product) {
      perItem.push({
        productId: String(item.productId),
        notFound: true,
        riskBand: 'low',
        intervention: { type: 'NONE', refundTiming: 'instant' },
      });
      continue;
    }

    const insightDoc =
      (await ReturnInsight.findOne({ productId: item.productId, scope: 'product' }).lean()) ||
      (await categoryBackoff(product.category));

    const features = buildFeaturePayload({
      product,
      insight: insightDoc,
      trust,
      bracketingIntent: detectBracketingIntent(items, item, trust),
      buyerActedOnFit: !!item.sizeAdjusted,
    });

    const ml = await callMlPredictReturn(features);

    const keptHistory = userId ? await keptBrandHistory(userId, product) : null;
    const fit = await callMlFitRecommend(insightDoc, product.category, keptHistory);

    const intervention = decideIntervention({
      riskBand: ml.risk_band,
      trustTier,
      fitSuggestedAction:
        fit && fit.suggested_action && (insightDoc.fitSignal?.confidence || 0) >= FIT_CONFIDENCE_FLOOR
          ? fit.suggested_action
          : null,
      bracketing: features.bracketingIntent,
      category: product.category,
    });

    // Log the nudge event (§15) — fire-and-forget, never fail the request.
    // Only log nudges that are actually rendered to the buyer (FIT_NUDGE).
    // Other intervention types affect refund timing internally but never
    // surface to the UI, so they don't generate impression events.
    let nudgeEventId = null;
    if (intervention.type === 'FIT_NUDGE' && userId) {
      try {
        const ev = await NudgeEvent.create({
          userId,
          productId: item.productId,
          nudgeType: intervention.type,
          riskBand: ml.risk_band,
          trustTier,
          category: (product.category || '').toLowerCase(),
          shown: true,
          shownAt: new Date(),
        });
        nudgeEventId = String(ev._id);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[prevention.service] nudgeEvent log failed:', e.message);
      }
    }

    perItem.push({
      productId: String(item.productId),
      title: product.title,
      category: product.category,
      probability: ml.return_probability,
      riskBand: ml.risk_band,
      scorecardScore: ml.scorecard_score,
      topReasons: ml.top_reasons || [],
      usedFallback: !!ml.used_fallback,
      modelVersion: ml.model_version || null,
      fit: fit && fit.verdict !== 'unknown' ? fit : null,
      intervention,
      nudgeEventId,
    });
  }

  return sanitizeForClient({
    basketRisk: worstBand(perItem),
    items: perItem,
    trustTier,
    refundTiming: worstRefundTiming(perItem),
    coolingOffHours: COOLING_OFF_HOURS,
  });
}

/**
 * getSellerInsights(sellerId) — drives the seller's `<ReturnInsightsPanel />`.
 * Includes before/after rate-change for positive reinforcement (§17).
 */
async function getSellerInsights(sellerId) {
  const products = await Product.find({ sellerId }).select('_id title category').lean();
  const ids = products.map((p) => p._id);
  if (ids.length === 0) return { items: [] };

  const insights = await ReturnInsight.find({ productId: { $in: ids }, scope: 'product' }).lean();
  const byProduct = new Map(insights.map((i) => [String(i.productId), i]));

  const items = products.map((p) => {
    const i = byProduct.get(String(p._id));
    if (!i) {
      return {
        productId: String(p._id),
        title: p.title,
        category: p.category,
        returnRate: null,
        unitsSold: 0,
        unitsReturned: 0,
        dominantReason: null,
        fitVerdict: null,
        sellerSummary: null,
        previousReturnRate30d: null,
        rateChangeDirection: null,
      };
    }
    return {
      productId: String(p._id),
      title: p.title,
      category: p.category,
      returnRate: i.returnRate,
      unitsSold: i.unitsSold,
      unitsReturned: i.unitsReturned,
      dominantReason: i.dominantReason,
      fitVerdict: i.fitSignal?.verdict ?? null,
      compatVerdict: i.compatSignal?.verdict ?? null,
      dimensionVerdict: i.dimensionSignal?.verdict ?? null,
      topComplaints: i.topComplaints || [],
      sellerSummary: i.sellerSummary,
      previousReturnRate30d: i.previousReturnRate30d,
      rateChangeDirection: i.rateChangeDirection,
    };
  });

  return { items };
}

/**
 * getRefundTiming({ userId, productId, riskBand }) — Phase 4 frozen interface.
 * Returns 'instant' | 'delayed' + cooling-off hours when delayed.
 *
 * Phase 7 EXPOSES this; Phase 7 NEVER writes refund state. Phase 4 / returns
 * module calls this when actually issuing refunds.
 */
async function getRefundTiming({ userId, productId, riskBand }) {
  let trust = null;
  if (userId) {
    trust = await trustService.getTrustProfile(userId).catch(() => null);
  }
  const tier = (trust && trust.tier) || 'standard';
  const t = timing(riskBand, tier);
  return {
    timing: t,
    coolingOffHours: t === REFUND_TIMING.DELAYED ? COOLING_OFF_HOURS : 0,
    trustTier: tier,
  };
}

// ── Nudge tracking endpoints (§15) ─────────────────────────────────────────

async function patchNudgeEvent(id, patch) {
  const allowed = ['acted', 'purchased', 'returned'];
  const update = {};
  for (const k of allowed) {
    if (patch[k] === true || patch[k] === false) {
      update[k] = patch[k];
      update[`${k}At`] = new Date();
    }
  }
  if (Object.keys(update).length === 0) return null;
  return NudgeEvent.findByIdAndUpdate(id, update, { new: true }).lean();
}

// ── Post-return feedback removed (§16) ─────────────────────────────────────
// The "we warned you last time" learning card has been retired. It told the
// buyer their previous purchase was nudged, which leaks risk-system internals.
// Trust-side scoring and refund timing still react to ignored nudges silently.

// ── Analytics (§20) ────────────────────────────────────────────────────────

async function getNudgeAnalytics({ days = 7 } = {}) {
  const since = new Date(Date.now() - days * 86400000);
  const events = await NudgeEvent.find({ shownAt: { $gte: since } })
    .select('nudgeType acted purchased returned category productId')
    .lean();

  const totals = { shown: events.length, acted: 0, purchased: 0, kept: 0 };
  const byType = {};
  const ignoredByProduct = new Map();
  const productHits = new Map();

  for (const ev of events) {
    if (ev.acted === true) totals.acted++;
    if (ev.purchased === true) totals.purchased++;
    if (ev.purchased === true && ev.returned !== true) totals.kept++;

    if (!byType[ev.nudgeType]) {
      byType[ev.nudgeType] = { shown: 0, acted: 0, conversion: 0 };
    }
    byType[ev.nudgeType].shown++;
    if (ev.acted === true) byType[ev.nudgeType].acted++;

    const pid = String(ev.productId);
    productHits.set(pid, (productHits.get(pid) || 0) + 1);
    if (ev.acted !== true) {
      ignoredByProduct.set(pid, (ignoredByProduct.get(pid) || 0) + 1);
    }
  }

  for (const t of Object.values(byType)) {
    t.conversion = t.shown > 0 ? round3(t.acted / t.shown) : 0;
  }

  const topIgnoredSKUs = [...ignoredByProduct.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([productId, ignoredCount]) => ({ productId, ignoredCount }));

  return {
    period: `last_${days}_days`,
    nudgesShown: totals.shown,
    nudgesActedOn: totals.acted,
    conversionRate: totals.shown > 0 ? round3(totals.acted / totals.shown) : 0,
    purchases: totals.purchased,
    kept: totals.kept,
    preventionRate: totals.acted > 0 ? round3(totals.kept / totals.acted) : 0,
    byNudgeType: byType,
    topIgnoredSKUs,
  };
}

// ── Recompute trigger (admin/dev) ──────────────────────────────────────────

async function runRecompute({ llm = null } = {}) {
  return recomputeReturnInsights({ llm });
}

const round3 = (n) => Math.round(n * 1000) / 1000;

module.exports = {
  // PDP / checkout
  getProductInsight,
  assessCheckoutRisk,
  // seller / dashboards
  getSellerInsights,
  getNudgeAnalytics,
  // Phase 4 frozen interface
  getRefundTiming,
  // nudge tracking
  patchNudgeEvent,
  // admin / dev
  runRecompute,
  // exported for tests / seed
  detectBracketingIntent,
  buildFeaturePayload,
  jsScorecardFallback,
  keptBrandHistory,
  categoryBackoff,
};
