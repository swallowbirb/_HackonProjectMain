/**
 * routing.service.js — the smart disposition engine, wired.
 *
 * Gathers inputs (item → grade → trust → price → category → demand), runs the
 * pure deterministic brain (routing.scoring.decide + routing.warehouse.chooseWarehouse),
 * persists a RoutingDecision, transitions the item to ROUTED, and hands resell-class
 * items to the resale module via a defensive seam. Emits a plain-English log chain.
 */

const mongoose = require('mongoose');

const RoutingDecision = require('./routing.model');
const { decide, RESALE_CLASS, reverseLogisticsCost, categoryWeight } = require('./routing.scoring');
const { chooseWarehouse } = require('./routing.warehouse');
const {
  DEFAULT_ORIGIN,
  MATCH_WINDOW_HOURS,
  MATCH_WINDOW_BY_CATEGORY,
  GRADE_RESALE_FACTOR,
} = require('./routing.config');

const Item = require('../items/item.model');
const itemService = require('../items/item.service');
const gradingService = require('../grading/grading.service');
const trustService = require('../trust/trust.service');
const demandService = require('../demand/demand.service');
const ItemLogger = require('../../utils/itemLogger');

const Product = require('../products/product.model');

// ── Defensive seams (degrade gracefully if a sibling module is absent) ────────

const safeMatchDemand = async (category, tags, location, radiusKm) => {
  try {
    const r = await demandService.matchDemandForItem(category, tags, location, radiusKm);
    return r || { count: 0, radiusKm, posts: [] };
  } catch (err) {
    return { count: 0, radiusKm, posts: [] };
  }
};

const safeDemandByWarehouse = async (category, tags) => {
  try {
    return (await demandService.demandByWarehouseForItem(category, tags)) || {};
  } catch (err) {
    return {};
  }
};

const safeGenerateTags = (item, grade) => {
  try {
    return demandService.generateTags(item, grade) || [];
  } catch (_) {
    return [];
  }
};

const safeCreateResaleDraft = async (itemId, routingDecision, grade) => {
  try {
    const resaleService = require('../resale/resale.service');
    if (typeof resaleService.createDraftFromRouting === 'function') {
      return await resaleService.createDraftFromRouting({ itemId, routingDecision, grade });
    }
  } catch (err) {
    console.warn(`[routing] resale draft skipped: ${err.message}`);
  }
  return null;
};

// ── Errors with HTTP status hints for the controller ──────────────────────────

const httpError = (message, status) => {
  const err = new Error(message);
  err.status = status;
  return err;
};

/**
 * Resolve the reference price + category for an item (used for resaleValue).
 */
const resolveEconomics = async (item, grade) => {
  let originalPrice = 0;
  let category = item.category || 'general';

  if (item.originalProductId) {
    const product = await Product.findById(item.originalProductId).select('price category').lean();
    if (product) {
      originalPrice = product.price || 0;
      category = category || product.category;
    }
  }

  const resalePct = grade?.estimatedResalePct ?? GRADE_RESALE_FACTOR[grade?.grade] ?? 0.5;
  const resaleValue = Math.round(originalPrice * resalePct);
  return { originalPrice, category, resaleValue };
};

/**
 * computeRoutingDecision — run the disposition engine for a graded item.
 *
 * @param {ObjectId|string} itemId
 * @param {object} options { sellerLocation?, counterfeit?, hazardous? }
 * @returns the persisted RoutingDecision (plain object)
 */
const computeRoutingDecision = async (itemId, options = {}) => {
  if (!mongoose.isValidObjectId(itemId)) throw httpError('Invalid item id', 400);

  const item = await Item.findById(itemId).lean();
  if (!item) throw httpError('Item not found', 404);

  const grade = await gradingService.getGradeByItemId(itemId);
  if (!grade) throw httpError('Item has not been graded yet', 422);
  if (grade.flaggedForReview) throw httpError('Grade is flagged for manual review — routing blocked', 409);

  await ItemLogger.log(itemId, 'ROUTING_START', '🧭 Routing engine started', { phase: 'routing' });

  const trust = await trustService.getTrustProfile(item.initiatorUserId);

  // Use the trust tier snapshotted at submission time if it differs from the
  // live profile — this matters for demo personas that share a single user account.
  const effectiveTrust = (item.trustTierAtSubmission && trust?.tier !== item.trustTierAtSubmission)
    ? { ...trust, tier: item.trustTierAtSubmission, score: trust?.score ?? 50 }
    : trust;
  const { originalPrice, category, resaleValue } = await resolveEconomics(item, grade);

  // Tags + nearby demand signal.
  const tags = safeGenerateTags(item, grade);
  const sellerLoc = options.sellerLocation || DEFAULT_ORIGIN;
  const demand = await safeMatchDemand(category, tags, sellerLoc, 25);
  await ItemLogger.log(
    itemId,
    'ROUTING_DEMAND',
    `📍 ${demand.count} nearby buyer(s) within ${demand.radiusKm} km`,
    { count: demand.count, radiusKm: demand.radiusKm, tags }
  );

  // Best warehouse (needed for the inbound cost that feeds the scorecard).
  const demandByWh = await safeDemandByWarehouse(category, tags);
  const weightKg = categoryWeight(category);
  const warehousePick = chooseWarehouse({
    sellerLoc,
    category,
    weightKg,
    resaleValue,
    demandByWarehouse: demandByWh,
  });
  const inboundCost = warehousePick?.breakdown?.inbound
    ?? reverseLogisticsCost({ origin: sellerLoc, destination: DEFAULT_ORIGIN, weightKg, category });

  // Run the pure decision brain.
  const decision = decide({
    grade,
    resaleValue,
    demandCount: demand.count,
    inboundCost,
    category,
    trust: effectiveTrust,
    counterfeit: options.counterfeit,
    hazardous: options.hazardous,
  });

  if (decision.hardGatesApplied.length > 0) {
    await ItemLogger.log(
      itemId,
      'ROUTING_GATE',
      `🚧 Hard gate(s): ${decision.hardGatesApplied.join(', ')}`,
      { gates: decision.hardGatesApplied }
    );
  }

  // Decide whether the item holds at home (peer) or ships to a warehouse.
  let chosenWarehouse = null;
  let matchWindow = null;

  if (decision.chosenPath === 'peer-redistribute') {
    const hours = MATCH_WINDOW_BY_CATEGORY[category] || MATCH_WINDOW_HOURS;
    matchWindow = { active: true, hours };
    await ItemLogger.log(itemId, 'ROUTING_WAREHOUSE', `🤝 Hold-at-home ${hours}h for peer handoff`, { hours });
  } else if (RESALE_CLASS.has(decision.chosenPath) && warehousePick) {
    chosenWarehouse = {
      code: warehousePick.warehouseCode,
      name: warehousePick.warehouse?.name,
      city: warehousePick.warehouse?.city,
      breakdown: warehousePick.breakdown,
    };
    await ItemLogger.log(
      itemId,
      'ROUTING_WAREHOUSE',
      `🏭 Best warehouse: ${chosenWarehouse.name} (${chosenWarehouse.city})`,
      chosenWarehouse.breakdown
    );
  }

  // Upsert the decision (one per item — recompute overwrites).
  const doc = await RoutingDecision.findOneAndUpdate(
    { itemId },
    {
      itemId,
      gradeId: grade._id,
      trustProfileId: effectiveTrust?._id || null,
      chosenPath: decision.chosenPath,
      rankedAlternatives: decision.rankedAlternatives,
      hardGatesApplied: decision.hardGatesApplied,
      reverseLogisticsCost: decision.reverseLogisticsCost,
      demandSignal: { count: demand.count, radiusKm: demand.radiusKm },
      tags,
      refundTiming: decision.refundTiming,
      refundHold: decision.refundHold,
      refundHoldReason: decision.refundHoldReason,
      chosenWarehouse,
      matchWindow,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  await ItemLogger.log(
    itemId,
    'ROUTING_DECISION',
    `✅ Disposition: ${decision.chosenPath} · refund ${decision.refundTiming}`,
    { chosenPath: decision.chosenPath, refundTiming: decision.refundTiming, refundHold: decision.refundHold }
  );

  // Transition GRADED → ROUTED (best-effort; idempotent on re-compute).
  try {
    const fresh = await Item.findById(itemId).select('status').lean();
    if (fresh?.status === 'GRADED') {
      await itemService.transitionStatus(itemId, 'ROUTED', { userId: null, role: 'system' }, {
        chosenPath: decision.chosenPath,
      });
      await ItemLogger.log(itemId, 'STATUS_UPDATE', '📊 Item status changed: GRADED → ROUTED', {
        phase: 'routing',
        level: 'success',
      });
    }
    await Item.findByIdAndUpdate(itemId, { routingDecisionId: doc._id });
  } catch (err) {
    console.warn(`[routing] item transition skipped: ${err.message}`);
  }

  // Hand resell-class items to the resale module (defensive seam).
  if (RESALE_CLASS.has(decision.chosenPath)) {
    await safeCreateResaleDraft(itemId, doc, grade);
  }

  await ItemLogger.log(itemId, 'FLOW_COMPLETE', '🏁 Routing flow complete', { phase: 'complete', level: 'success' });

  return doc;
};

/**
 * Fetch the stored decision for an item.
 */
const getDecisionByItemId = async (itemId) => {
  if (!mongoose.isValidObjectId(itemId)) return null;
  return RoutingDecision.findOne({ itemId }).lean();
};

module.exports = { computeRoutingDecision, getDecisionByItemId };
