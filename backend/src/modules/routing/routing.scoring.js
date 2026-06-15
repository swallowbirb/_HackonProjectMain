/**
 * routing.scoring.js — the pure, deterministic disposition brain.
 *
 * A plain DECISION TREE (no weighted scorecard, no magic point values). Same
 * inputs always produce the same output (unit-testable). The service layer
 * gathers the inputs (grade, trust, peer demand, best warehouse) and calls
 * `decide()`.
 *
 *   1. Hard gates first  (counterfeit/hazardous → liquidate; hygiene → donate/
 *      liquidate; abuser → return-to-seller; Grade D → donate).
 *   2. A nearby peer buyer exists?            → peer-redistribute (skip warehouse)
 *   3. A profitable "best" warehouse exists?  → resell (ship there, list it)
 *   4. Otherwise (would lose money everywhere) → liquidate (if worth it) / donate
 *
 * The money math lives in `routing.warehouse.chooseWarehouse` (which returns a
 * `viable` flag) and the simple `reverseLogisticsCost` below.
 */

const {
  CARRIER,
  WEIGHT_BRACKETS,
  DEFAULT_WEIGHT_KG,
  CATEGORY_WEIGHT_KG,
  HOLDING_COST_PER_DAY,
  HYGIENE_CATEGORIES,
  TRUST,
  LIQUIDATE_FLOOR,
} = require('./routing.config');

const RESALE_CLASS = new Set(['resell', 'refurbish', 'peer-redistribute']);

// A short local hop for a peer handoff (no warehouse leg).
const PEER_HOP_KM = 8;

/**
 * Great-circle distance between two [lng, lat] points, in km.
 */
const haversine = (a, b) => {
  if (!a || !b) return 0;
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const R = 6371; // km
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
};

const weightMultiplier = (weightKg) => {
  const w = Number(weightKg) || DEFAULT_WEIGHT_KG;
  return (WEIGHT_BRACKETS.find((b) => w <= b.maxKg) || WEIGHT_BRACKETS[WEIGHT_BRACKETS.length - 1]).multiplier;
};

const categoryWeight = (category) => CATEGORY_WEIGHT_KG[category] || DEFAULT_WEIGHT_KG;

/**
 * Reverse-logistics cost for one leg (origin → destination), in ₹.
 *   cost = baseFee + perKm × distanceKm × weightMultiplier
 * Heavier items and longer hauls cost more — this is what makes "the shoes cost
 * less than shipping the box" fall out naturally.
 */
const reverseLogisticsCost = ({ origin, destination, weightKg, category }) => {
  const distanceKm = haversine(origin?.coordinates, destination?.coordinates);
  const w = weightKg != null ? weightKg : categoryWeight(category);
  const cost = CARRIER.baseFee + CARRIER.perKm * distanceKm * weightMultiplier(w);
  return Math.round(cost);
};

/**
 * Hard gates that OVERRIDE the tree. Returns { forcedPath|null, gatesApplied[] }.
 */
const applyHardGates = ({ grade, category, trust, counterfeit, hazardous } = {}) => {
  const gatesApplied = [];
  let forcedPath = null;

  if (counterfeit) {
    gatesApplied.push('COUNTERFEIT_DETECTED');
    forcedPath = 'liquidate';
  } else if (hazardous) {
    gatesApplied.push('HAZARDOUS_MATERIAL');
    forcedPath = 'liquidate';
  } else if (HYGIENE_CATEGORIES.includes(category)) {
    gatesApplied.push('HYGIENE_SAFETY');
    forcedPath = grade?.grade === 'A' || grade?.grade === 'B' ? 'donate' : 'liquidate';
  } else if (grade?.grade === 'D') {
    // Grade D is not resellable — donate it.
    gatesApplied.push('GRADE_D_NOT_RESELLABLE');
    forcedPath = 'donate';
  }

  // Restricted/abusive returner → ship back, no resale (refund handled separately).
  if (trust && TRUST.RESTRICTED_TIERS.includes(trust.tier)) {
    gatesApplied.push('RESTRICTED_USER_REPEAT_OFFENDER');
    forcedPath = 'return-to-seller';
  }

  return { forcedPath, gatesApplied };
};

/**
 * Estimated ₹ net recovery per path — used only to render the comparison bars in
 * the UI. Honest, simple money figures (no abstract points).
 */
const estimateRecoveries = ({ resaleValue = 0, inboundCost = 0, category, peerCount = 0, warehouse = null }) => {
  const holding = (HOLDING_COST_PER_DAY[category] || HOLDING_COST_PER_DAY.general) * 14;
  const peerHop = Math.round(CARRIER.baseFee + CARRIER.perKm * PEER_HOP_KM);
  const warehouseRecovery = warehouse ? warehouse.score : Math.round(resaleValue - inboundCost - holding);

  return {
    'peer-redistribute': peerCount >= 1 ? Math.round(resaleValue - peerHop) : Math.round(resaleValue - peerHop) - 100,
    resell: warehouseRecovery,
    refurbish: Math.round(resaleValue * 0.85 - inboundCost - holding),
    liquidate: Math.round(resaleValue * 0.2),
    donate: 0,
    'return-to-seller': -Math.round(inboundCost),
  };
};

const rationaleFor = (path, { peerCount, warehouse, resaleValue, inboundCost }) => {
  switch (path) {
    case 'peer-redistribute':
      return peerCount >= 1
        ? `${peerCount} nearby buyer(s) — direct handoff, no warehouse leg`
        : 'no nearby buyer for a direct handoff';
    case 'resell':
      return warehouse
        ? `best warehouse ${warehouse.warehouse?.city || warehouse.warehouseCode}: recovery ₹${warehouse.score} (demand ${warehouse.breakdown?.demand ?? 0})`
        : `recovery ₹${resaleValue} − inbound ₹${inboundCost} − holding`;
    case 'refurbish':
      return 'repair + warehouse holding deducted';
    case 'liquidate':
      return 'bulk B2B recovery (~20%)';
    case 'donate':
      return 'no recovery, ESG/tax benefit, no shipping';
    case 'return-to-seller':
      return 'ship back, no resale';
    default:
      return '';
  }
};

/**
 * Decide refund timing from trust + inbound cost.
 *   restricted        → reject
 *   low-trust (watch) → hold for physical inspection
 *   trusted + cheap   → immediate
 *   otherwise         → on-resolution
 */
const decideRefundTiming = (trust, inboundCost) => {
  const tier = trust?.tier;
  if (tier && TRUST.RESTRICTED_TIERS.includes(tier)) {
    return { refundTiming: 'rejected', refundHold: true, refundHoldReason: 'Restricted account — return rejected, no refund.' };
  }
  if (tier && TRUST.LOW_TRUST_TIERS.includes(tier)) {
    return { refundTiming: 'on-inspection', refundHold: true, refundHoldReason: 'Low trust — refund withheld until warehouse physical re-grade.' };
  }
  if (tier && TRUST.TRUSTED_TIERS.includes(tier) && inboundCost <= TRUST.CHEAP_INBOUND_THRESHOLD) {
    return { refundTiming: 'immediate', refundHold: false, refundHoldReason: null };
  }
  return { refundTiming: 'on-resolution', refundHold: false, refundHoldReason: null };
};

/**
 * Top-level decision (pure decision tree).
 *
 * @param {object} inputs
 *   grade: { grade, ... }
 *   category: String
 *   resaleValue: Number
 *   trust: { tier } | null
 *   counterfeit, hazardous: Boolean
 *   peerCount: Number          // confirmed nearby buyers for a direct handoff
 *   warehouse: { viable, score, breakdown, warehouseCode, warehouse } | null
 *   inboundCost: Number        // ₹ to reach the chosen/best warehouse
 * @returns {{ chosenPath, rankedAlternatives, hardGatesApplied,
 *             reverseLogisticsCost, refundTiming, refundHold, refundHoldReason }}
 */
const decide = (inputs = {}) => {
  const {
    grade, category, resaleValue = 0, trust,
    peerCount = 0, warehouse = null, inboundCost = 0,
  } = inputs;

  const { forcedPath, gatesApplied } = applyHardGates(inputs);

  // ── The tree ──────────────────────────────────────────────────────────────
  let chosenPath;
  if (forcedPath) {
    chosenPath = forcedPath;                       // 1. hard gate
  } else if (peerCount >= 1) {
    chosenPath = 'peer-redistribute';              // 2. a nearby buyer wants it
  } else if (warehouse && warehouse.viable) {
    chosenPath = 'resell';                         // 3. a profitable warehouse exists
  } else {
    chosenPath = resaleValue >= LIQUIDATE_FLOOR ? 'liquidate' : 'donate'; // 4. nowhere profitable
  }

  // Comparison bars (₹ recovery), chosen path bubbled to the front.
  const recoveries = estimateRecoveries({ resaleValue, inboundCost, category, peerCount, warehouse });
  const rankedAlternatives = Object.keys(recoveries)
    .map((path) => ({
      path,
      score: recoveries[path],
      netRecovery: recoveries[path],
      rationale: rationaleFor(path, { peerCount, warehouse, resaleValue, inboundCost }),
    }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const idx = rankedAlternatives.findIndex((r) => r.path === chosenPath);
  if (idx > 0) {
    const [chosen] = rankedAlternatives.splice(idx, 1);
    rankedAlternatives.unshift(chosen);
  }

  const refund = decideRefundTiming(trust, inboundCost);

  return {
    chosenPath,
    rankedAlternatives,
    hardGatesApplied: gatesApplied,
    reverseLogisticsCost: inboundCost,
    ...refund,
  };
};

module.exports = {
  haversine,
  weightMultiplier,
  categoryWeight,
  reverseLogisticsCost,
  applyHardGates,
  estimateRecoveries,
  decideRefundTiming,
  decide,
  RESALE_CLASS,
};
