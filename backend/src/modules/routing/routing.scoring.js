/**
 * routing.scoring.js — the pure, deterministic disposition brain.
 *
 * No DB, no network, no Date.now() in the scoring path → same inputs always
 * produce the same output (unit-testable). The service layer gathers the inputs
 * (grade, trust, demand, location) and calls `decide()`.
 */

const {
  CARRIER,
  WEIGHT_BRACKETS,
  DEFAULT_WEIGHT_KG,
  CATEGORY_WEIGHT_KG,
  PATH_BASE,
  GRADE_RESALE_FACTOR,
  DEMAND_CONVERSION,
  DEMAND_SCORE_CAP,
  HOLDING_COST_PER_DAY,
  HYGIENE_CATEGORIES,
  TRUST,
} = require('./routing.config');

const RESALE_CLASS = new Set(['resell', 'refurbish', 'peer-redistribute']);

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
 */
const reverseLogisticsCost = ({ origin, destination, weightKg, category }) => {
  const distanceKm = haversine(origin?.coordinates, destination?.coordinates);
  const w = weightKg != null ? weightKg : categoryWeight(category);
  const cost = CARRIER.baseFee + CARRIER.perKm * distanceKm * weightMultiplier(w);
  return Math.round(cost);
};

/**
 * Demand → bounded score contribution. Demand is a signal, not a promise.
 */
const demandScore = (demandCount) => {
  const expected = (Number(demandCount) || 0) * DEMAND_CONVERSION;
  return Math.min(expected * 20, DEMAND_SCORE_CAP);
};

/**
 * Score every path for an item. Returns an array of { path, score, netRecovery, rationale }.
 *
 * @param {object} inputs
 *   grade: { grade, qualityScore, estimatedResalePct }
 *   resaleValue: Number (₹ expected sale price)
 *   demandCount: Number
 *   inboundCost: Number (₹ cost to move item to warehouse)
 *   category: String
 */
const scorePaths = (inputs) => {
  const { grade, resaleValue = 0, demandCount = 0, inboundCost = 0, category } = inputs;
  const gradeLetter = grade?.grade || 'C';
  const resaleFactor = GRADE_RESALE_FACTOR[gradeLetter] ?? 0.5;
  const dScore = demandScore(demandCount);
  const holdingPerDay = HOLDING_COST_PER_DAY[category] || HOLDING_COST_PER_DAY.general;

  const out = [];

  for (const path of Object.keys(PATH_BASE)) {
    let score = PATH_BASE[path];
    let netRecovery = 0;
    const reasons = [];

    if (RESALE_CLASS.has(path)) {
      // Quality drives resale-class appeal.
      score += resaleFactor * 40;
      reasons.push(`grade ${gradeLetter} resale factor ${resaleFactor.toFixed(2)}`);

      // Demand boosts resell and peer-redistribute the most.
      if (path === 'resell' || path === 'peer-redistribute') {
        score += dScore;
        if (dScore > 0) reasons.push(`+${dScore.toFixed(1)} from ${demandCount} nearby buyer(s)`);
      }

      // Peer-redistribute skips the warehouse → lowest logistics cost.
      if (path === 'peer-redistribute') {
        netRecovery = resaleValue - CARRIER.baseFee; // one short hop
        score += demandCount > 0 ? 15 : -30; // only viable if someone nearby wants it
        reasons.push(demandCount > 0 ? 'nearby buyer enables direct handoff' : 'no nearby buyer for handoff');
      } else if (path === 'refurbish') {
        netRecovery = resaleValue * 0.85 - inboundCost - holdingPerDay * 14;
        reasons.push('repair cost + warehouse holding deducted');
      } else {
        // resell via warehouse
        netRecovery = resaleValue - inboundCost - holdingPerDay * 14;
        reasons.push(`recovery ₹${resaleValue} − inbound ₹${inboundCost} − holding`);
      }
    } else if (path === 'donate') {
      netRecovery = 0; // no recovery, but no shipping if local
      score += gradeLetter === 'D' ? 20 : 0;
      reasons.push('no shipping cost, tax/ESG benefit');
    } else if (path === 'liquidate') {
      netRecovery = resaleValue * 0.2; // bulk B2B pennies on the rupee
      reasons.push('bulk lot recovery (~20%)');
    } else if (path === 'return-to-seller') {
      netRecovery = -inboundCost;
      reasons.push('ship back, no resale');
    }

    // Economic reality: a negative net recovery suppresses the path.
    if (netRecovery < 0) score += Math.max(netRecovery / 10, -25);

    out.push({
      path,
      score: Math.round(score * 100) / 100,
      netRecovery: Math.round(netRecovery),
      rationale: reasons.join('; '),
    });
  }

  return out;
};

/**
 * Apply hard gates that OVERRIDE the scoring math. Returns
 * { forcedPath|null, gatesApplied[] }.
 */
const applyHardGates = (inputs) => {
  const { grade, category, demandCount = 0, trust, counterfeit, hazardous } = inputs;
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
  } else if (grade?.grade === 'D' && demandCount === 0) {
    gatesApplied.push('GRADE_D_NO_DEMAND');
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
 * Rank scored paths (desc) and choose the winner, honouring any forced gate.
 */
const rankAndChoose = (scored, forcedPath) => {
  const ranked = [...scored].sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  let chosenPath;
  if (forcedPath) {
    chosenPath = forcedPath;
    // Bubble the forced path to the front of the ranked list for display.
    const idx = ranked.findIndex((r) => r.path === forcedPath);
    if (idx > 0) {
      const [forced] = ranked.splice(idx, 1);
      ranked.unshift(forced);
    }
  } else {
    chosenPath = ranked[0]?.path;
  }
  return { chosenPath, rankedAlternatives: ranked };
};

/**
 * Decide refund timing from trust + inbound cost.
 *   restricted        → reject (handled by gate), refundHold true
 *   low-trust         → refundHold true (physical re-grade before refund)
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
 * Top-level decision. Pure — service passes everything in.
 *
 * @returns {{ chosenPath, rankedAlternatives, hardGatesApplied,
 *             reverseLogisticsCost, refundTiming, refundHold, refundHoldReason }}
 */
const decide = (inputs) => {
  const inboundCost = inputs.inboundCost != null ? inputs.inboundCost : 0;
  const scored = scorePaths({ ...inputs, inboundCost });
  const { forcedPath, gatesApplied } = applyHardGates(inputs);
  const { chosenPath, rankedAlternatives } = rankAndChoose(scored, forcedPath);
  const refund = decideRefundTiming(inputs.trust, inboundCost);

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
  demandScore,
  scorePaths,
  applyHardGates,
  rankAndChoose,
  decideRefundTiming,
  decide,
  RESALE_CLASS,
};
