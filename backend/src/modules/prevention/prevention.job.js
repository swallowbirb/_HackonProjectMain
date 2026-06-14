/**
 * prevention.job.js — the nightly closed-loop aggregation.
 *
 * For each product that has any order or return:
 *   - aggregate units sold/returned, return rate, reason histogram
 *   - mine fit / compat / dimension signals from reasonText + review text
 *   - extract top-5 complaint phrases
 *   - compute before/after rate-change vs the snapshot from 30+ days ago
 *   - upsert one returnInsights doc per SKU
 * Also builds (brand, category) rollup docs for cold-start backoff.
 *
 * Idempotent and re-runnable. The Bedrock seller-summary call is gated by
 * volume + return-rate thresholds and only fires when the complaint cluster
 * changed since the last run (cost rule §3.4).
 *
 * Mirrors §3.4 + §17 of Phase7-Prevention.md.
 */

const ReturnInsight = require('./returnInsight.model');
const NudgeEvent = require('./nudgeEvent.model');
const Order = require('../orders/order.model');
const Return = require('../returns/return.model');
const Review = require('../reviews/review.model');
const Product = require('../products/product.model');

const {
  RETURN_REASON_CODES,
  SELLER_SUMMARY_THRESHOLDS,
  RATE_CHANGE_DELTA,
} = require('../../contracts/prevention.contract');

const { mineFit, mineCompat, mineDimension, topComplaints } = require('./prevention.mining');

const DAY_MS = 86400000;

// ── Helpers ────────────────────────────────────────────────────────────────

function emptyHistogram() {
  return RETURN_REASON_CODES.reduce((acc, c) => {
    acc[c] = 0;
    return acc;
  }, {});
}

function tallyReasons(returns) {
  const hist = emptyHistogram();
  for (const r of returns) {
    const code = r.reasonCode;
    if (RETURN_REASON_CODES.includes(code)) {
      hist[code]++;
    } else {
      hist.other++;
    }
  }
  return hist;
}

function dominantReasonOf(hist) {
  let best = null;
  let bestCount = 0;
  for (const [code, count] of Object.entries(hist)) {
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return bestCount > 0 ? best : null;
}

function clusterFingerprint(complaints, dominantReason) {
  // simple stable identifier of "what the complaint cluster looks like"
  return `${dominantReason || 'none'}|${[...complaints].sort().join(',')}`;
}

function rateChangeDirection(newRate, oldRate) {
  if (oldRate === null || oldRate === undefined) return null;
  const delta = newRate - oldRate;
  if (delta < -RATE_CHANGE_DELTA) return 'improved';
  if (delta > RATE_CHANGE_DELTA) return 'worsened';
  return 'stable';
}

// ── Per-SKU recompute ──────────────────────────────────────────────────────

async function recomputeForProduct(productId, { llm = null } = {}) {
  const product = await Product.findById(productId).select('category brandName').lean();
  if (!product) return null;

  const [unitsSold, returnsForSku, reviews, existing] = await Promise.all([
    Order.countDocuments({ productId, status: 'completed' }),
    Return.find({ originalProductId: productId })
      .select('reasonCode reasonText createdAt')
      .lean(),
    Review.find({ productId, isRemoved: { $ne: true } }).select('text').lean(),
    ReturnInsight.findOne({ productId, scope: 'product' }),
  ]);

  const unitsReturned = returnsForSku.length;
  const returnRate = unitsSold > 0 ? unitsReturned / unitsSold : 0;
  const reasonHistogram = tallyReasons(returnsForSku);
  const dominantReason = dominantReasonOf(reasonHistogram);

  const allTexts = [
    ...returnsForSku.map((r) => r.reasonText || ''),
    ...reviews.map((rv) => rv.text || ''),
  ].filter(Boolean);

  const fitSignal = mineFit(allTexts);
  const compatSignal = mineCompat(allTexts);
  const dimensionSignal = mineDimension(allTexts);
  const complaints = topComplaints(allTexts, 5);

  // Before/After rate tracking (§17): if the existing snapshot is ≥30 days
  // old, freeze the current returnRate as previousReturnRate30d before
  // overwriting. We compare new vs (previous-or-old) to derive direction.
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
  let previousReturnRate30d = existing?.previousReturnRate30d ?? null;
  if (existing && existing.lastComputed && new Date(existing.lastComputed) < thirtyDaysAgo) {
    previousReturnRate30d = existing.returnRate ?? null;
  }
  const direction = rateChangeDirection(returnRate, previousReturnRate30d);

  // Seller summary — Bedrock LLM, gated and cached. Only fires when the cluster
  // changed AND we cross the volume/rate thresholds.
  let sellerSummary = existing?.sellerSummary ?? null;
  const eligibleForSummary =
    returnRate >= SELLER_SUMMARY_THRESHOLDS.MIN_RETURN_RATE &&
    unitsReturned >= SELLER_SUMMARY_THRESHOLDS.MIN_UNITS_RETURNED;
  const fp = clusterFingerprint(complaints, dominantReason);
  const previousFp = clusterFingerprint(existing?.topComplaints || [], existing?.dominantReason);
  const clusterChanged = fp !== previousFp;
  if (eligibleForSummary && clusterChanged && typeof llm === 'function') {
    try {
      sellerSummary = await llm({
        category: product.category,
        complaints,
        dominantReason,
        returnRate,
      });
    } catch (e) {
      // never let LLM failures break the recompute
      // eslint-disable-next-line no-console
      console.warn('[prevention.job] seller summary LLM failed:', e.message);
    }
  }

  const update = {
    productId,
    brandName: product.brandName || null,
    category: (product.category || '').toLowerCase(),
    unitsSold,
    unitsReturned,
    returnRate,
    reasonHistogram,
    dominantReason,
    fitSignal,
    compatSignal,
    dimensionSignal,
    topComplaints: complaints,
    sellerSummary,
    previousReturnRate30d,
    rateChangeDirection: direction,
    scope: 'product',
    lastComputed: now,
  };

  await ReturnInsight.findOneAndUpdate({ productId, scope: 'product' }, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  });

  return update;
}

// ── Category rollups (cold-start backoff) ───────────────────────────────────

async function recomputeCategoryRollups() {
  const products = await ReturnInsight.aggregate([
    { $match: { scope: 'product' } },
    {
      $group: {
        _id: '$category',
        unitsSold: { $sum: '$unitsSold' },
        unitsReturned: { $sum: '$unitsReturned' },
        skuCount: { $sum: 1 },
        // average the reason histogram across SKUs (sum is fine — it's a count)
        defective: { $sum: '$reasonHistogram.defective' },
        not_as_described: { $sum: '$reasonHistogram.not_as_described' },
        changed_mind: { $sum: '$reasonHistogram.changed_mind' },
        wrong_item: { $sum: '$reasonHistogram.wrong_item' },
        other: { $sum: '$reasonHistogram.other' },
      },
    },
  ]);

  for (const row of products) {
    const category = row._id || 'default';
    const unitsSold = row.unitsSold || 0;
    const unitsReturned = row.unitsReturned || 0;
    const returnRate = unitsSold > 0 ? unitsReturned / unitsSold : 0;
    const hist = {
      defective: row.defective || 0,
      not_as_described: row.not_as_described || 0,
      changed_mind: row.changed_mind || 0,
      wrong_item: row.wrong_item || 0,
      other: row.other || 0,
    };

    await ReturnInsight.findOneAndUpdate(
      { productId: null, scope: 'category', category },
      {
        productId: null,
        category,
        unitsSold,
        unitsReturned,
        returnRate,
        reasonHistogram: hist,
        dominantReason: dominantReasonOf(hist),
        scope: 'category',
        lastComputed: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
}

// ── Match nudgeEvents to returns (closes the §15 outcome loop) ─────────────

async function backfillNudgeReturnedFlag() {
  // For each return in the last 90 days, find the matching nudgeEvent
  // (same userId+productId, shown=true, returned=null) and mark it returned.
  const since = new Date(Date.now() - 90 * DAY_MS);
  const recentReturns = await Return.find({ createdAt: { $gte: since } })
    .select('userId originalProductId createdAt')
    .lean();

  let updated = 0;
  for (const r of recentReturns) {
    if (!r.originalProductId || !r.userId) continue;
    const ev = await NudgeEvent.findOne({
      userId: r.userId,
      productId: r.originalProductId,
      shown: true,
      returned: null,
      shownAt: { $lte: r.createdAt },
    });
    if (ev) {
      ev.returned = true;
      ev.returnedAt = r.createdAt;
      await ev.save();
      updated++;
    }
  }
  return updated;
}

// ── Public entry point ─────────────────────────────────────────────────────

/**
 * recomputeReturnInsights({ llm? }) — runs the full nightly job.
 *
 * `llm` is an optional async ({category,complaints,dominantReason,returnRate})
 * → string function. Pass it in only when Bedrock is wired and we want seller
 * summaries. Without it, summaries simply don't update (cost rule).
 */
async function recomputeReturnInsights({ llm = null } = {}) {
  // 1. Find every productId with at least one order OR return.
  const [orderedIds, returnedIds] = await Promise.all([
    Order.distinct('productId', { productId: { $ne: null } }),
    Return.distinct('originalProductId', { originalProductId: { $ne: null } }),
  ]);
  const allIds = [...new Set([...orderedIds, ...returnedIds].map(String))]
    .filter(Boolean)
    .map((s) => s);

  let perProductUpdated = 0;
  for (const id of allIds) {
    try {
      const r = await recomputeForProduct(id, { llm });
      if (r) perProductUpdated++;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[prevention.job] recompute failed for ${id}:`, e.message);
    }
  }

  // 2. Category rollups for cold-start backoff.
  await recomputeCategoryRollups();

  // 3. Backfill nudge outcome (returned flag) for analytics.
  const nudgesUpdated = await backfillNudgeReturnedFlag();

  return {
    productsUpdated: perProductUpdated,
    productsConsidered: allIds.length,
    nudgeEventsUpdated: nudgesUpdated,
  };
}

module.exports = {
  recomputeReturnInsights,
  recomputeForProduct,
  recomputeCategoryRollups,
  backfillNudgeReturnedFlag,
  // exported for tests
  rateChangeDirection,
  clusterFingerprint,
  tallyReasons,
};
