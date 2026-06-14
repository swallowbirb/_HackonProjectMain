/**
 * Phase 7 — Prevention Intelligence Layer
 * Canonical contracts: priors, lexicons, bands, intervention types.
 *
 * Authoritative source for everything that gets shared between the scorecard
 * (prevention.scoring.js), the intervention engine (prevention.intervention.js),
 * the nightly job (prevention.job.js), and the service (prevention.service.js).
 *
 * Currency: INR (₹) throughout. All price-band cutoffs are in rupees.
 */

// ── Risk bands ──────────────────────────────────────────────────────────────
const RISK_BANDS = ['low', 'medium', 'high'];

const BAND_THRESHOLDS = {
  HIGH: 65,    // > 65 → high
  MEDIUM: 35,  // 35–65 → medium, < 35 → low
};

// ── Intervention types (the decision-table outputs) ────────────────────────
const INTERVENTION_TYPES = {
  NONE: 'NONE',                               // low risk → nothing shown
  FIT_NUDGE: 'FIT_NUDGE',                     // PDP/checkout: size up/down
  INFO_NUDGE: 'INFO_NUDGE',                   // "commonly returned for X"
  BRACKETING_NUDGE: 'BRACKETING_NUDGE',       // multi-buy → drop extras
  COOLING_OFF: 'COOLING_OFF',                 // refund timing only, never a block
  CONFIDENCE_BOOST: 'CONFIDENCE_BOOST',       // inverse prevention for genuine users
};

const NUDGE_TYPES = [
  'FIT_NUDGE',
  'INFO_NUDGE',
  'BRACKETING_NUDGE',
  'COOLING_OFF',
  'CONFIDENCE_BOOST',
];

// ── Refund timing (consumed by Phase 4 returns flow) ───────────────────────
const REFUND_TIMING = {
  INSTANT: 'instant',
  DELAYED: 'delayed',
};
const COOLING_OFF_HOURS = 36;     // 24–48h window midpoint

// ── Reused from returns module (do not redefine the source of truth) ───────
const RETURN_REASON_CODES = ['defective', 'not_as_described', 'changed_mind', 'wrong_item', 'other'];

// ── Category-specific signal mapping ───────────────────────────────────────
const FIT_CATEGORIES = ['apparel', 'clothing', 'footwear', 'shoes'];
const ELECTRONICS_CATEGORIES = ['electronics', 'gadgets', 'tech', 'mobile', 'computers'];
const FURNITURE_CATEGORIES = ['furniture', 'home', 'kitchen', 'decor', 'home decor'];

const VISUAL_CATEGORIES = [...FIT_CATEGORIES, ...FURNITURE_CATEGORIES, 'bags'];

// ── Cold-start category return-rate priors (estimated; sources cited below) ──
// All values are unitless return-rate fractions (0..1).
// Sources: WRAP, McKinsey ecommerce returns reports, NRF.
const CATEGORY_RETURN_PRIORS = {
  apparel:     0.28,   // online apparel returns widely reported ~25–30%
  clothing:    0.28,
  footwear:    0.20,   // shoes ~18–22% (fit-driven)
  shoes:       0.20,
  electronics: 0.08,   // most electronics ~5–10%
  gadgets:     0.08,
  tech:        0.08,
  mobile:      0.10,
  computers:   0.08,
  home:        0.10,
  kitchen:     0.10,
  furniture:   0.12,   // furniture 5–20%, midpoint
  decor:       0.12,
  beauty:      0.06,
  cosmetics:   0.06,
  toys:        0.10,
  baby:        0.10,
  books:       0.04,
  media:       0.04,
  default:     0.12,
};

const MIN_SALES_FOR_OWN_RATE = 5;   // below this, back off to category prior

// ── Fit-mining lexicon (apparel & footwear) ─────────────────────────────────
const FIT_LEXICON = {
  small: [
    'too tight', 'runs small', 'size up', 'snug', 'tight', 'narrow', 'cramped', 'smaller than',
    'pinches', 'toe box', 'too narrow',
  ],
  large: [
    'too big', 'runs large', 'size down', 'loose', 'baggy', 'roomy', 'oversized', 'larger than',
    'sloppy', 'too wide',
  ],
};
const FIT_VERDICTS = ['runs_small', 'true_to_size', 'runs_large', 'unknown'];
const FIT_MIN_MENTIONS = 3;          // need ≥3 fit mentions before we claim a verdict
const FIT_VERDICT_MARGIN = 1.5;      // dominant side must be ≥1.5× the other to call it
const FIT_CONFIDENCE_FLOOR = 0.5;    // PDP hides fit notes below this

// ── Compatibility lexicon (electronics) ─────────────────────────────────────
const COMPAT_LEXICON = [
  'incompatible', "doesn't work with", 'not compatible', 'wrong port', 'not supported',
  'confusing', "can't connect", 'dead on arrival', 'doa', "doesn't fit my", 'not recognized',
  'setup', 'difficult to setup', 'no instructions',
];
const COMPAT_VERDICTS = ['issues_reported', 'no_issues', 'unknown'];
const COMPAT_MIN_MENTIONS = 3;

// ── Dimension/appearance lexicon (furniture & home) ─────────────────────────
const DIMENSION_LEXICON = {
  too_large: [
    'too big', 'too large', "doesn't fit", 'doorway', "won't fit", "couldn't get through",
    'too wide', 'too tall', 'overwhelming', 'massive', 'much bigger',
  ],
  too_small: [
    'too small', 'smaller than expected', 'tiny', 'looked bigger', 'much smaller',
    'disappointing size', 'compact', 'not as big',
  ],
  color_off: [
    'color different', 'darker', 'lighter', 'looks nothing like', "doesn't match photo",
    'completely different color', 'more orange', 'more yellow', 'misleading photo',
  ],
};
const DIMENSION_VERDICTS = ['too_large', 'too_small', 'color_mismatch', 'no_issues', 'unknown'];
const DIMENSION_MIN_MENTIONS = 3;
const DIMENSION_VERDICT_MARGIN = 1.5;

// ── Price bands (INR — all values in ₹) ────────────────────────────────────
// The mid-band is the "I'll just try it" zone — riskiest. Cheap and premium
// purchases are more deliberate / less return-prone.
const PRICE_BANDS_INR = {
  CHEAP_MAX: 200,         // < ₹200    → cheap impulse, low stakes (score 20)
  MID_MAX: 800,           // ₹200–₹800 → mid, riskiest (score 100)
  UPPER_MID_MAX: 3000,    // ₹800–₹3000 → upper-mid (score 60)
  // > ₹3000 → premium (score 30)
};

// ── Seller-summary thresholds (LLM gate, nightly batch only) ────────────────
const SELLER_SUMMARY_THRESHOLDS = {
  MIN_RETURN_RATE: 0.15,
  MIN_UNITS_RETURNED: 3,
};

// ── Before/after rate-change bands (§17) ───────────────────────────────────
const RATE_CHANGE_DELTA = 0.03;   // ±3 percentage points to flag improved/worsened

// ── Auto-flag thresholds for ineffective nudges (§15.4) ────────────────────
const NUDGE_INEFFECTIVE = {
  MIN_IMPRESSIONS: 50,
  MAX_CONVERSION_RATE: 0.10,
};

// ── Reason-string templates (rendered by service / frontend) ───────────────
const REASON_STRINGS = {
  PRODUCT_RETURN_RATE: 'About {pct}% of these are returned',
  FIT_MISMATCH: 'Tends to run {verdict} — most returns cite {issue}',
  USER_RETURN_BEHAVIOUR: 'Your recent returns are higher than usual',
  CATEGORY_PRIOR: '{category} items are returned more often than average',
  BRACKETING_INTENT: "You've added multiple of the same item",
  REVIEW_SENTIMENT_GAP: 'Recent reviews mention quality concerns',
  PHOTO_VERIFICATION: 'This listing has no verified real-time photo — product may differ from images',
};

module.exports = {
  RISK_BANDS,
  BAND_THRESHOLDS,
  INTERVENTION_TYPES,
  NUDGE_TYPES,
  REFUND_TIMING,
  COOLING_OFF_HOURS,
  RETURN_REASON_CODES,
  FIT_CATEGORIES,
  ELECTRONICS_CATEGORIES,
  FURNITURE_CATEGORIES,
  VISUAL_CATEGORIES,
  CATEGORY_RETURN_PRIORS,
  MIN_SALES_FOR_OWN_RATE,
  FIT_LEXICON,
  FIT_VERDICTS,
  FIT_MIN_MENTIONS,
  FIT_VERDICT_MARGIN,
  FIT_CONFIDENCE_FLOOR,
  COMPAT_LEXICON,
  COMPAT_VERDICTS,
  COMPAT_MIN_MENTIONS,
  DIMENSION_LEXICON,
  DIMENSION_VERDICTS,
  DIMENSION_MIN_MENTIONS,
  DIMENSION_VERDICT_MARGIN,
  PRICE_BANDS_INR,
  SELLER_SUMMARY_THRESHOLDS,
  RATE_CHANGE_DELTA,
  NUDGE_INEFFECTIVE,
  REASON_STRINGS,
};
