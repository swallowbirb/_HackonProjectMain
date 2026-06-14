const mongoose = require('mongoose');

const RoutingDecision = require('./routing.model');
const Item = require('../items/item.model');
const itemService = require('../items/item.service');
const ItemLogger = require('../../utils/itemLogger');

const { decide, reverseLogisticsCost } = require('./routing.scoring');
const { chooseWarehouse } = require('./routing.warehouse');
const {
  DEFAULT_ORIGIN,
  MATCH_WINDOW_HOURS,
  MATCH_WINDOW_BY_CATEGORY,
  CATEGORY_WEIGHT_KG,
  DEFAULT_WEIGHT_KG,
} = require('./routing.config');

const gradingService = require('../grading/grading.service');
const trustService = require('../trust/trust.service');
const demandService = require('../demand/demand.service');

// ── Defensive seams ──────────────────────────────────────────────────────────

/** Wrap demand matching so routing never breaks if the demand layer hiccups. */
const safeMatchDemand = async (category, tags, location, radiusKm) => {
  try {
    if (typeof demandService.matchDemandForItem !== 'function') {
      return { count: 0, radiusKm: radiusKm || 25, posts: [] };
    }
    return await demandService.matchDemandForItem(category, tags, location, radiusKm);
  } catch (err) {
    console.warn(`[routing] safeMatchDemand failed: ${err.message}`);
    return { count: 0, radiusKm: radiusKm || 25, posts: [] };
  }
};

/** Per-warehouse demand map for warehouse selection. Degrades to {}. */
const safeDemandByWarehouse = async (term) => {
  try {
    if (typeof demandService.demandByWarehouse !== 'function') return {};
    const rows = await demandService.demandByWarehouse(term);
    return rows.reduce((acc, r) => {
      acc[r.warehouseCode] = r.demand;
      return acc;
    }, {});
  } catch (err) {
    console.warn(`[routing] safeDemandByWarehouse failed: ${err.message}`);
    return {};
  }
};

/** Hand off to Phase B. No-ops gracefully if resale module isn't available. */
const safeCreateResaleDraft = async (itemId, routingDecision, grade) => {
  try {
    const resaleService = require('../resale/resale.service');
    if (typeof resaleService.createDraftFromRouting !== 'function') return null;
    return await resaleService.createDraftFromRouting({ itemId, routingDecision, grade });
  } catch (err) {
    console.warn(`[routing] safeCreateResaleDraft failed: ${err.message}`);
    return null;
  }
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const RESALE_CLASS = new Set(['resell', 'refurbish', 'peer-redistribute']);

const categoryWeight = (category) => CATEGORY_WEIGHT_KG[category] || DEFAULT_WEIGHT_KG;

/**
 * Resolve a reference/original price for the item from its product or secondhand
 * source. Used to derive resaleValue = originalPrice × estimatedResalePct.
 */
const resolveOriginalPrice = async (item) => {
  let originalPrice = 0;
  let productTitle;
  if (item.originalProductId) {
    try {
      const Product = require('../products/product.model');
      const product = await Product.findById(item.originalProductId).select('price title category').lean();
      originalPrice = product?.price || 0;
      productTitle = product?.title;
    } catch (_) { /* optional */ }
  }
  if (!originalPrice && item.secondhandId) {
    try {
      const Secondhand = require('../secondhand/secondhand.model');
      const sh = await Secondhand.findById(item.secondhandId).select('askingPrice orderTotal productTitle').lean();
      originalPrice = sh?.askingPrice || sh?.orderTotal || 0;
      productTitle = productTitle || sh?.productTitle;
    } catch (_) { /* optional */ }
  }
  return { originalPrice, productTitle };
};

const matchWindowHours = (category) =>
  MATCH_WINDOW_BY_CATEGORY[category] != null ? MATCH_WINDOW_BY_CATEGORY[category] : MATCH_WINDOW_HOURS;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Compute (or recompute) the routing decision for a graded item.
 *
 * @param {string} itemId
 * @param {object} [opts] { sellerLocation: {coordinates:[lng,lat]}, counterfeit, hazardous }
 * @returns {Promise<RoutingDecision>}
 * @throws  e.statusCode 404 | 409 | 422
 */
const computeRoutingDecision = async (itemId, opts = {}) => {
  if (!mongoose.isValidObjectId(itemId)) {
    const e = new Error('Invalid itemId'); e.statusCode = 400; throw e;
  }

  const item = await Item.findById(itemId).lean();
  if (!item) { const e = new Error('Item not found'); e.statusCode = 404; throw e; }

  await ItemLogger.log(itemId, 'ROUTING_START', '🧭 Routing engine started — gathering grade, trust, demand…', { phase: 'routing' });

  // Grade is mandatory and must be GRADED (not flagged).
  const grade = await gradingService.getGradeByItemId(itemId);
  if (!grade) { const e = new Error('Item has no grade yet'); e.statusCode = 422; throw e; }
  if (grade.flaggedForReview) {
    const e = new Error('Grade is flagged for human review — routing blocked'); e.statusCode = 409; throw e;
  }
  if (item.status !== 'GRADED') {
    // Allow re-running on an already-routed item (idempotent recompute) but block
    // anything that never reached GRADED.
    const past = ['ROUTED', 'IN_TRANSIT', 'LISTED'];
    if (!past.includes(item.status)) {
      const e = new Error(`Item is not GRADED (status: ${item.status})`); e.statusCode = 422; throw e;
    }
  }

  // Trust (read-only).
  let trust = null;
  try {
    trust = await trustService.getTrustProfile(item.initiatorUserId);
  } catch (_) { trust = null; }
  await ItemLogger.log(itemId, 'ROUTING_TRUST', `👤 Trust tier: ${trust?.tier || 'unknown'} (score ${trust?.score ?? '—'})`, { tier: trust?.tier, score: trust?.score });

  // Price + economics.
  const { originalPrice, productTitle } = await resolveOriginalPrice(item);
  const category = item.category || 'general';
  const resaleValue = Math.round(originalPrice * (grade.estimatedResalePct || 0));
  const sellerLoc = opts.sellerLocation?.coordinates ? opts.sellerLocation : DEFAULT_ORIGIN;
  const weightKg = categoryWeight(category);

  // Tags + demand.
  const itemForTags = { ...item, __productTitle: productTitle };
  const tags = demandService.generateTags(itemForTags, grade);
  const demand = await safeMatchDemand(category, tags, sellerLoc, undefined);
  await ItemLogger.log(itemId, 'ROUTING_DEMAND', `📍 ${demand.count} nearby buyer(s) within ${demand.radiusKm} km — tags: ${tags.join(', ') || 'none'}`, { count: demand.count, radiusKm: demand.radiusKm, tags });

  // Inbound cost to the nearest reasonable warehouse (for refund-timing threshold).
  // We use the best-warehouse inbound once chosen; for the decision we estimate with default origin.
  const demandMap = await safeDemandByWarehouse(category);
  const warehousePick = chooseWarehouse({ sellerLoc, category, weightKg, resaleValue, demandByWarehouse: demandMap });
  const inboundCost = warehousePick?.breakdown?.inbound ?? reverseLogisticsCost({ origin: sellerLoc, destination: DEFAULT_ORIGIN, category });

  // Decide.
  const decision = decide({
    grade,
    resaleValue,
    demandCount: demand.count,
    inboundCost,
    category,
    trust,
    counterfeit: !!opts.counterfeit || grade?.evidenceBundle?.fraud?.classification === 'hard_fraud',
    hazardous: !!opts.hazardous,
  });

  if (decision.hardGatesApplied.length) {
    await ItemLogger.log(itemId, 'ROUTING_GATE', `🚧 Hard gate(s): ${decision.hardGatesApplied.join(', ')} → forced ${decision.chosenPath}`, { gates: decision.hardGatesApplied });
  }

  // Warehouse vs peer-handoff (hold-at-home) for resale-class paths.
  let chosenWarehouse = null;
  let matchWindow = { active: false, hours: null, expiresAt: null };

  if (RESALE_CLASS.has(decision.chosenPath)) {
    if (decision.chosenPath === 'peer-redistribute' && demand.count > 0) {
      const hours = matchWindowHours(category);
      matchWindow = { active: true, hours, expiresAt: new Date(Date.now() + hours * 3600 * 1000) };
      await ItemLogger.log(itemId, 'ROUTING_WAREHOUSE', `🤝 Peer handoff — holding at home ${hours}h for ${demand.count} nearby buyer(s); no warehouse leg.`, { hours, demandCount: demand.count });
    } else if (warehousePick) {
      const wh = warehousePick.warehouse;
      chosenWarehouse = {
        code: wh.code, name: wh.name, city: wh.city,
        score: warehousePick.score, breakdown: warehousePick.breakdown,
      };
      await ItemLogger.log(itemId, 'ROUTING_WAREHOUSE', `🏭 Best warehouse: ${wh.name} (${wh.city}) — score ${warehousePick.score}, inbound ₹${warehousePick.breakdown.inbound}, demand ${warehousePick.breakdown.demand}.`, { chosenWarehouse });
    }
  }

  if (decision.refundHold) {
    await ItemLogger.log(itemId, 'ROUTING_REFUND', `💰 Refund withheld — ${decision.refundHoldReason}`, { refundTiming: decision.refundTiming });
  } else {
    await ItemLogger.log(itemId, 'ROUTING_REFUND', `💰 Refund timing: ${decision.refundTiming}`, { refundTiming: decision.refundTiming });
  }

  // Persist (upsert by itemId — idempotent recompute).
  const doc = await RoutingDecision.findOneAndUpdate(
    { itemId },
    {
      itemId,
      gradeId: grade._id,
      trustProfileId: trust?._id || null,
      chosenPath: decision.chosenPath,
      rankedAlternatives: decision.rankedAlternatives,
      hardGatesApplied: decision.hardGatesApplied,
      reverseLogisticsCost: decision.reverseLogisticsCost,
      demandSignal: { count: demand.count, radiusKm: demand.radiusKm },
      refundTiming: decision.refundTiming,
      refundHold: decision.refundHold,
      refundHoldReason: decision.refundHoldReason,
      chosenWarehouse,
      matchWindow,
      tags,
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  await ItemLogger.log(itemId, 'ROUTING_DECISION', `✅ Decision: ${decision.chosenPath.toUpperCase()} (net recovery ₹${decision.rankedAlternatives[0]?.netRecovery ?? '—'})`, { chosenPath: decision.chosenPath });

  // Walk the item state machine GRADED → ROUTED (best-effort).
  try {
    if (item.status === 'GRADED') {
      await itemService.transitionStatus(itemId, 'ROUTED', { userId: item.initiatorUserId, role: 'system' }, { chosenPath: decision.chosenPath });
      await Item.findByIdAndUpdate(itemId, { routingDecisionId: doc._id });
      await ItemLogger.log(itemId, 'STATUS_UPDATE', '📦 Item status → ROUTED', { status: 'ROUTED' });
    }
  } catch (err) {
    await ItemLogger.log(itemId, 'STATUS_UPDATE', `⚠️ Could not transition to ROUTED — ${err.message}`, { level: 'warn' });
  }

  // Hand off to Phase B for resale-class paths (degrades gracefully).
  if (RESALE_CLASS.has(decision.chosenPath)) {
    const listing = await safeCreateResaleDraft(itemId, doc, grade);
    if (listing) {
      await ItemLogger.log(itemId, 'FLOW_COMPLETE', `🏷️ Resale draft created (₹${listing.suggestedPrice ?? listing.price ?? '—'}). Routing flow complete.`, { listingId: String(listing._id) });
    } else {
      await ItemLogger.log(itemId, 'FLOW_COMPLETE', '🏷️ Resale path chosen — draft creation deferred (resale module unavailable or already exists).', { level: 'info' });
    }
  } else {
    await ItemLogger.log(itemId, 'FLOW_COMPLETE', `🏁 Routing flow complete — disposition: ${decision.chosenPath}.`, {});
  }

  return doc.toObject();
};

/**
 * Fetch the latest routing decision for an item.
 */
const getDecisionByItemId = async (itemId) => {
  if (!mongoose.isValidObjectId(itemId)) return null;
  return RoutingDecision.findOne({ itemId }).lean();
};

module.exports = {
  computeRoutingDecision,
  getDecisionByItemId,
  safeMatchDemand,
  safeCreateResaleDraft,
};
