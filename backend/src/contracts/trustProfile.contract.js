/**
 * Task 0.6 — Canonical Data Contracts
 * Trust Profile JSON — user fraud/trust scoring
 *
 * {
 *   userId: ObjectId,
 *   tier: String,             // verified | trusted | standard | watch | restricted
 *   score: Number,            // 0-100
 *   signals: [{
 *     signal: String,
 *     value: Any,
 *     weight: Number,
 *     direction: String       // positive | negative
 *   }],
 *   accountAge: Number,       // days
 *   lifetimePurchases: Number,
 *   lifetimeReturns: Number,
 *   returnRate: Number,
 *   recentReturnRate90d: Number,
 *   bracketingFlag: Boolean,
 *   wardrobingFlag: Boolean,
 *   lastComputed: Date
 * }
 */

const TRUST_TIERS = ['verified', 'trusted', 'standard', 'watch', 'restricted'];

/**
 * Score → Tier thresholds
 */
const TIER_THRESHOLDS = {
  verified: 90,
  trusted: 75,
  standard: 50,
  watch: 30,
  restricted: 0,
};

/**
 * Signal definitions with default weights
 */
const TRUST_SIGNALS = {
  ACCOUNT_AGE_DAYS: { weight: 0.10, direction: 'positive' },
  LIFETIME_PURCHASES: { weight: 0.15, direction: 'positive' },
  RETURN_RATE: { weight: 0.25, direction: 'negative' },
  RECENT_RETURN_RATE_90D: { weight: 0.20, direction: 'negative' },
  BRACKETING_FLAG: { weight: 0.15, direction: 'negative' },
  WARDROBE_FLAG: { weight: 0.10, direction: 'negative' },
  VERIFIED_PURCHASE: { weight: 0.05, direction: 'positive' },
};

/**
 * Return rate thresholds that trigger flags/tier changes
 */
const RETURN_RATE_THRESHOLDS = {
  BRACKETING_MIN_ORDERS: 3,       // minimum orders to check bracketing
  BRACKETING_SAME_PRODUCT_COUNT: 2,
  WARDROBE_DAYS_WINDOW: 30,
  HIGH_RETURN_RATE: 0.40,         // 40%+ return rate → watch tier
  CRITICAL_RETURN_RATE: 0.65,     // 65%+ → restricted tier
};

module.exports = {
  TRUST_TIERS,
  TIER_THRESHOLDS,
  TRUST_SIGNALS,
  RETURN_RATE_THRESHOLDS,
};
