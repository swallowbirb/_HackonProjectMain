/**
 * prevention.intervention.js — PURE decision table.
 *
 * Maps (riskBand × trustTier × context) → an intervention object.
 * No DB, no async, fully unit-testable. This is the heart of "friction sized
 * to the buyer" — the place where Phase 7 decides what the user sees.
 *
 * Mirrors §8.1 of Phase7-Prevention.md.
 */

const {
  INTERVENTION_TYPES,
  REFUND_TIMING,
  COOLING_OFF_HOURS,
} = require('../../contracts/prevention.contract');

const GENUINE_TIERS = new Set(['verified', 'trusted']);

/**
 * timing(riskBand, trustTier) → 'instant' | 'delayed'
 *
 * Verified/trusted users are NEVER delayed regardless of risk.
 * Standard/watch/restricted + high-risk basket → cooling-off (24–48h after grading).
 *
 * NOTE: this is timing only — never a block. Phase 4 consumes this when
 * actually issuing refunds; Phase 7 just exposes the recommendation.
 */
function timing(riskBand, trustTier) {
  if (GENUINE_TIERS.has(trustTier)) return REFUND_TIMING.INSTANT;
  if (riskBand === 'high') return REFUND_TIMING.DELAYED;
  return REFUND_TIMING.INSTANT;
}

/**
 * decideIntervention(ctx) → { type, action?, refundTiming, coolingOffHours? }
 *
 * Decision priority:
 *   1. fit hint actionable → FIT_NUDGE (helpful, any tier)
 *   2. high risk → INFO_NUDGE
 *   3. medium risk → INFO_NUDGE (instant refund — soft signal)
 *   4. low + genuine → CONFIDENCE_BOOST
 *   5. low + everyone else → NONE
 *
 * Note: bracketing detection is intentionally NOT surfaced to customers.
 * Telling buyers "you've added multiples — keep one" suppresses cart size
 * and basket profit. The signal still lives in the trust profile for
 * internal risk scoring, but no customer-facing nudge fires from it.
 *
 * Genuine users (verified/trusted) NEVER get refund delays no matter what.
 * The intervention is always advisory — never a hard block.
 */
function decideIntervention({
  riskBand,
  trustTier = 'standard',
  fitSuggestedAction = null,
  bracketing = false, // accepted for API stability but no longer triggers a nudge
  category = null,
} = {}) {
  const tier = trustTier || 'standard';
  const genuine = GENUINE_TIERS.has(tier);

  // Bracketing is intentionally NOT surfaced to the customer.
  // We keep `bracketing` in the signature so existing callers don't break,
  // but it no longer maps to BRACKETING_NUDGE — basket size > prevention.

  // 1. Fit help when we have a concrete action — pure help, any tier
  if (fitSuggestedAction) {
    return {
      type: INTERVENTION_TYPES.FIT_NUDGE,
      action: fitSuggestedAction,
      refundTiming: timing(riskBand, tier),
      coolingOffHours: timing(riskBand, tier) === 'delayed' ? COOLING_OFF_HOURS : null,
      category,
    };
  }

  // 3 / 4. Band-driven info nudges
  if (riskBand === 'high') {
    return {
      type: INTERVENTION_TYPES.INFO_NUDGE,
      refundTiming: timing(riskBand, tier),
      coolingOffHours: timing(riskBand, tier) === 'delayed' ? COOLING_OFF_HOURS : null,
      category,
    };
  }
  if (riskBand === 'medium') {
    return {
      type: INTERVENTION_TYPES.INFO_NUDGE,
      refundTiming: REFUND_TIMING.INSTANT,
      coolingOffHours: null,
      category,
    };
  }

  // 5 / 6. Low risk
  return {
    type: genuine ? INTERVENTION_TYPES.CONFIDENCE_BOOST : INTERVENTION_TYPES.NONE,
    refundTiming: REFUND_TIMING.INSTANT,
    coolingOffHours: null,
    category,
  };
}

/**
 * worstRefundTiming(perItemArray) — basket-level: if ANY item is delayed,
 * the whole basket gets delayed. Phase 4 reads this for actual refund issuance.
 */
function worstRefundTiming(perItem) {
  if (!Array.isArray(perItem) || perItem.length === 0) return REFUND_TIMING.INSTANT;
  return perItem.some(
    (i) => i && i.intervention && i.intervention.refundTiming === REFUND_TIMING.DELAYED
  )
    ? REFUND_TIMING.DELAYED
    : REFUND_TIMING.INSTANT;
}

/** worstBand(perItemArray) — high > medium > low; basket-level messaging signal. */
function worstBand(perItem) {
  if (!Array.isArray(perItem) || perItem.length === 0) return 'low';
  if (perItem.some((i) => i.riskBand === 'high')) return 'high';
  if (perItem.some((i) => i.riskBand === 'medium')) return 'medium';
  return 'low';
}

module.exports = {
  decideIntervention,
  timing,
  worstRefundTiming,
  worstBand,
};
