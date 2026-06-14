/**
 * Phase 7.5 — Festive Defense Layer
 * Canonical contracts for the calendar-driven, tier-aware festive policies.
 *
 * Authoritative source for everything shared between the festive calendar model,
 * festive.service.js (decision logic), and the order/return surgical hooks.
 *
 * Design rule: NO friction on the buy button. Every lever fires after the buy
 * decision (return window, payment-method gate, mid-transit cancel) and never
 * penalises verified/trusted customers.
 *
 * Currency: INR (₹). All caps are in rupees. All windows are in days.
 */

// Trust tiers (mirrors Phase 3 — do not redefine the source of truth, just reference)
const TRUST_TIERS = ['verified', 'trusted', 'standard', 'watch', 'restricted'];

// Tiers considered "genuine" — exempt from every festive penalty.
const GENUINE_TIERS = ['verified', 'trusted'];

// ── Event codes ─────────────────────────────────────────────────────────────
// cancelLock-eligible events are the two highest-volume sale windows only.
const EVENT_CODES = {
  BBD: 'BBD',                 // Flipkart Big Billion Days
  GIF: 'GIF',                 // Amazon Great Indian Festival
  DIWALI: 'DIWALI',           // Diwali week (pan-platform)
  EOSS: 'EOSS',               // End of Season Sale (Jan + Jul)
  REPUBLIC_DAY: 'REPUBLIC_DAY',
  RAKHI: 'RAKHI',             // Raksha Bandhan (gifting heavy)
  WEDDING: 'WEDDING',         // Wedding-season blanket (Oct–Feb), low multiplier
};

// Events during which Lever 3 (mid-transit cancel lock) is active.
const CANCEL_LOCK_EVENTS = [EVENT_CODES.BBD, EVENT_CODES.GIF];

// ── Lever 1 — Return window shrink ──────────────────────────────────────────
// Base window is owned by the returns module (currently 30 days). During a
// festive window, risky tiers get a shorter window. `null` ⇒ unchanged (use base).
const BASE_RETURN_WINDOW_DAYS = 30;

const FESTIVE_RETURN_WINDOW_DAYS = {
  verified: null,   // unchanged
  trusted: null,    // unchanged
  standard: 15,
  watch: 10,
  restricted: 7,
};

// Reasons that ALWAYS get the full base window, regardless of festive state.
// Consumer-protection aligned: we only shrink change-of-mind, never genuine faults.
const FULL_WINDOW_REASONS = ['defective', 'wrong_item'];

// ── Lever 2 — COD gate ──────────────────────────────────────────────────────
// Inside a festive window, COD availability is gated by trust tier.
// codAllowed=false ⇒ prepaid only. cap=null ⇒ no ceiling. cap=N ⇒ COD only when
// cart total ≤ N, otherwise prepaid (or partial-prepaid token).
const PAYMENT_METHODS = ['prepaid', 'cod'];

const FESTIVE_COD_POLICY = {
  verified: { codAllowed: true, cap: null },
  trusted: { codAllowed: true, cap: null },
  standard: { codAllowed: true, cap: 2000 },
  watch: { codAllowed: true, cap: 500 },
  restricted: { codAllowed: false, cap: 0 },
};

// When COD is blocked, offer a partial-prepaid token to preserve the COD audience.
const PARTIAL_PREPAID_TOKEN_INR = 100;

// ── Lever 3 — Mid-transit cancellation lock ─────────────────────────────────
// Fulfillment lifecycle (additive on the order; default 'placed').
const FULFILLMENT_STATUSES = ['placed', 'dispatched', 'in_transit', 'out_for_delivery', 'delivered'];

// Once the order reaches one of these states, the targeted cohort cannot cancel
// (doorstep refusal still possible — that is a fulfillment event, not a UI button).
const CANCEL_LOCKED_STATES = ['dispatched', 'in_transit', 'out_for_delivery'];

// The cancel lock targets only non-genuine tiers (proxy for medium/high risk).
// Verified/trusted are never locked, even during BBD/GIF.
const CANCEL_LOCK_TARGET_TIERS = ['standard', 'watch', 'restricted'];

// ── Defaults ────────────────────────────────────────────────────────────────
const DEFAULT_RISK_MULTIPLIER = 1.5;

module.exports = {
  TRUST_TIERS,
  GENUINE_TIERS,
  EVENT_CODES,
  CANCEL_LOCK_EVENTS,
  BASE_RETURN_WINDOW_DAYS,
  FESTIVE_RETURN_WINDOW_DAYS,
  FULL_WINDOW_REASONS,
  PAYMENT_METHODS,
  FESTIVE_COD_POLICY,
  PARTIAL_PREPAID_TOKEN_INR,
  FULFILLMENT_STATUSES,
  CANCEL_LOCKED_STATES,
  CANCEL_LOCK_TARGET_TIERS,
  DEFAULT_RISK_MULTIPLIER,
};
