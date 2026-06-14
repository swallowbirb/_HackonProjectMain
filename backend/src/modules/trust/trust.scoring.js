/**
 * trust.scoring.js — PURE scoring functions (no DB, no async).
 *
 * Input: a plain `facts` object built by trust.service.js from DB reads.
 * Output: a plain profile object ({ tier, score, signals[], appliedTripwires[], flags }).
 *
 * This file holds ALL the scoring math so it can be unit-tested in isolation and
 * retuned without touching the DB plumbing. The frozen contract
 * (contracts/trustProfile.contract.js) owns tiers/thresholds/weights; the local
 * SCORING block below only adds the saturation/penalty knobs the contract doesn't cover.
 */

const {
  TIER_THRESHOLDS,
  TRUST_SIGNALS,
} = require('../../contracts/trustProfile.contract');

// ── Local tunables (contract stays frozen) ──────────────────────────────────
const SCORING = {
  ACCOUNT_AGE_SATURATION_DAYS: 365, // age that maps to full marks
  PURCHASES_SATURATION_COUNT: 25,   // purchase count that maps to full marks
  RETURN_RATE_ZERO_AT: 0.40,        // lifetime return rate where inverse signal hits 0
  RECENT_RATE_ZERO_AT: 0.50,        // 90d return rate where inverse signal hits 0

  SUDDEN_SHIFT_MULTIPLIER: 2.0,     // 90d rate >= 2x lifetime rate ...
  SUDDEN_SHIFT_FLOOR: 0.30,         // ... AND 90d rate >= 0.30  => watch

  SOFT_FRAUD_PENALTY: 15,           // points removed when >=1 soft-fraud cluster
  HARD_FRAUD_CAP_WATCH: 1,          // >=1 hard hit => cap at watch
  HARD_FRAUD_FORCE_RESTRICTED: 2,   // >=2 hard hits => restricted

  HIGH_RETURN_RATE: 0.40,           // mirrors contract RETURN_RATE_THRESHOLDS.HIGH
  CRITICAL_RETURN_RATE: 0.65,       // mirrors contract RETURN_RATE_THRESHOLDS.CRITICAL

  STALE_TTL_HOURS: Number(process.env.TRUST_RECOMPUTE_TTL_HOURS || 24),
};

// Tier rank for clamping (higher = better)
const TIER_RANK = {
  restricted: 0,
  watch: 1,
  standard: 2,
  trusted: 3,
  verified: 4,
};
const RANK_TIER = ['restricted', 'watch', 'standard', 'trusted', 'verified'];

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

/**
 * normalizeSignals(facts) -> per-signal 0..100 scores + weighted contributions[].
 * Every signal is normalised so 100 = good. Negative signals are inverted.
 */
function normalizeSignals(facts) {
  const f = facts || {};
  const accountAgeDays = Number(f.accountAgeDays) || 0;
  const lifetimePurchases = Number(f.lifetimePurchases) || 0;
  const returnRate = Number(f.returnRate) || 0;
  const recentReturnRate90d = Number(f.recentReturnRate90d) || 0;
  const bracketingFlag = !!f.bracketingFlag;
  const wardrobingFlag = !!f.wardrobingFlag;

  const ageScore = clamp(accountAgeDays / SCORING.ACCOUNT_AGE_SATURATION_DAYS, 0, 1) * 100;
  const purchasesScore = clamp(lifetimePurchases / SCORING.PURCHASES_SATURATION_COUNT, 0, 1) * 100;
  const verifiedScore = lifetimePurchases >= 1 ? 100 : 0;
  const returnRateScore = Math.max(1 - returnRate / SCORING.RETURN_RATE_ZERO_AT, 0) * 100;
  const recent90dScore = Math.max(1 - recentReturnRate90d / SCORING.RECENT_RATE_ZERO_AT, 0) * 100;
  const bracketingScore = bracketingFlag ? 0 : 100;
  const wardrobeScore = wardrobingFlag ? 0 : 100;

  const W = TRUST_SIGNALS;
  const contributions = [
    mk('ACCOUNT_AGE_DAYS', accountAgeDays, ageScore, W.ACCOUNT_AGE_DAYS.weight, 'positive'),
    mk('LIFETIME_PURCHASES', lifetimePurchases, purchasesScore, W.LIFETIME_PURCHASES.weight, 'positive'),
    mk('VERIFIED_PURCHASE', lifetimePurchases >= 1, verifiedScore, W.VERIFIED_PURCHASE.weight, 'positive'),
    mk('RETURN_RATE', returnRate, returnRateScore, W.RETURN_RATE.weight, 'negative'),
    mk('RECENT_RETURN_RATE_90D', recentReturnRate90d, recent90dScore, W.RECENT_RETURN_RATE_90D.weight, 'negative'),
    mk('BRACKETING_FLAG', bracketingFlag, bracketingScore, W.BRACKETING_FLAG.weight, 'negative'),
    mk('WARDROBE_FLAG', wardrobingFlag, wardrobeScore, W.WARDROBE_FLAG.weight, 'negative'),
  ];

  return {
    ageScore,
    purchasesScore,
    verifiedScore,
    returnRateScore,
    recent90dScore,
    bracketingScore,
    wardrobeScore,
    contributions,
  };
}

function mk(signal, value, normalised, weight, direction) {
  return {
    signal,
    value,
    weight,
    direction,
    contribution: round1(normalised * weight),
  };
}

/**
 * computeRawScore(normalised) -> Number 0..100 (weighted average of 0..100 scores).
 */
function computeRawScore(norm) {
  const total = norm.contributions.reduce((sum, c) => sum + c.contribution, 0);
  return clamp(total, 0, 100);
}

/**
 * scoreToTier(score) -> tier string using the frozen TIER_THRESHOLDS.
 */
function scoreToTier(score) {
  if (score >= TIER_THRESHOLDS.verified) return 'verified';
  if (score >= TIER_THRESHOLDS.trusted) return 'trusted';
  if (score >= TIER_THRESHOLDS.standard) return 'standard';
  if (score >= TIER_THRESHOLDS.watch) return 'watch';
  return 'restricted';
}

/**
 * clampTier(tier, maxTier) -> downward clamp: result is no better than maxTier.
 */
function clampTier(tier, maxTier) {
  const rank = Math.min(TIER_RANK[tier], TIER_RANK[maxTier]);
  return RANK_TIER[rank];
}

function oneTierDown(tier) {
  const rank = Math.max(TIER_RANK[tier] - 1, 0);
  return RANK_TIER[rank];
}

/**
 * applyTripwires(tier, facts) -> { tier, appliedTripwires[] }.
 * Hard tripwires override the score-derived tier downward. Strongest wins, but we
 * record every tripwire that fired for explainability.
 */
function applyTripwires(tier0, facts) {
  const f = facts || {};
  const returnRate = Number(f.returnRate) || 0;
  const recentReturnRate90d = Number(f.recentReturnRate90d) || 0;
  const hardFraudHits = Number(f.hardFraudHits) || 0;
  const softFraudHits = Number(f.softFraudHits) || 0;
  const bracketingFlag = !!f.bracketingFlag;
  const wardrobingFlag = !!f.wardrobingFlag;
  const banned = !!f.banned;

  const suddenShift =
    recentReturnRate90d >= SCORING.SUDDEN_SHIFT_MULTIPLIER * returnRate &&
    recentReturnRate90d >= SCORING.SUDDEN_SHIFT_FLOOR;
  const anyPatternFlag =
    bracketingFlag || wardrobingFlag || returnRate >= SCORING.HIGH_RETURN_RATE;

  let tier = tier0;
  const appliedTripwires = [];

  // Kill switches -> restricted
  if (banned) {
    tier = clampTier(tier, 'restricted');
    appliedTripwires.push('BANNED');
  }
  if (returnRate >= SCORING.CRITICAL_RETURN_RATE) {
    tier = clampTier(tier, 'restricted');
    appliedTripwires.push('RETURN_RATE_CRITICAL');
  }
  if (hardFraudHits >= SCORING.HARD_FRAUD_FORCE_RESTRICTED) {
    tier = clampTier(tier, 'restricted');
    appliedTripwires.push('HARD_FRAUD_RESTRICTED');
  }

  // Caps -> at most watch
  if (returnRate >= SCORING.HIGH_RETURN_RATE) {
    tier = clampTier(tier, 'watch');
    appliedTripwires.push('RETURN_RATE_HIGH');
  }
  if (suddenShift) {
    tier = clampTier(tier, 'watch');
    appliedTripwires.push('SUDDEN_SHIFT');
  }
  if (hardFraudHits >= SCORING.HARD_FRAUD_CAP_WATCH) {
    tier = clampTier(tier, 'watch');
    appliedTripwires.push('HARD_FRAUD_WATCH');
  }
  if (bracketingFlag && wardrobingFlag) {
    tier = clampTier(tier, 'watch');
    appliedTripwires.push('BRACKETING_AND_WARDROBE');
  }

  // Soft escalation -> one tier down
  if (softFraudHits >= 1 && anyPatternFlag) {
    tier = clampTier(tier, oneTierDown(tier));
    appliedTripwires.push('SOFT_FRAUD_WITH_PATTERN');
  }

  return { tier, appliedTripwires };
}

/**
 * assembleProfile(facts) -> full profile object. Orchestrates the pure pipeline.
 */
function assembleProfile(facts) {
  const f = facts || {};
  const norm = normalizeSignals(f);
  const raw = computeRawScore(norm);
  const softPenalty = (Number(f.softFraudHits) || 0) > 0 ? SCORING.SOFT_FRAUD_PENALTY : 0;
  const score = clamp(raw - softPenalty, 0, 100);
  const tier0 = scoreToTier(score);
  const { tier, appliedTripwires } = applyTripwires(tier0, f);

  return {
    tier,
    score: Math.round(score),
    signals: norm.contributions,
    appliedTripwires,
    flags: {
      bracketingFlag: !!f.bracketingFlag,
      wardrobingFlag: !!f.wardrobingFlag,
    },
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

module.exports = {
  SCORING,
  normalizeSignals,
  computeRawScore,
  scoreToTier,
  clampTier,
  applyTripwires,
  assembleProfile,
};
