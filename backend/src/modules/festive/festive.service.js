/**
 * festive.service.js — Phase 7.5 Festive Defense Layer
 *
 * Owns all festive DECISION logic. Reads the FestiveCalendar collection (its own)
 * and the Phase 3 trust profile (read-only, defensive). Writes nothing except via
 * the admin seed/override endpoints.
 *
 * The three levers are exposed as small, testable functions that the order/return
 * modules call through thin, defensive hooks:
 *   - getReturnWindowDays()  → Lever 1 (return-window shrink)
 *   - getCodPolicy()         → Lever 2 (COD gate)
 *   - canCancelOrder()       → Lever 3 (mid-transit cancel lock)
 *
 * Every function degrades gracefully: if the calendar is empty or the trust
 * service is absent, festive defenses simply don't engage (fail-open, sales-safe).
 */

const FestiveCalendar = require('./festiveCalendar.model');
const {
  GENUINE_TIERS,
  CANCEL_LOCK_EVENTS,
  BASE_RETURN_WINDOW_DAYS,
  FESTIVE_RETURN_WINDOW_DAYS,
  FULL_WINDOW_REASONS,
  FESTIVE_COD_POLICY,
  PARTIAL_PREPAID_TOKEN_INR,
  CANCEL_LOCKED_STATES,
  CANCEL_LOCK_TARGET_TIERS,
} = require('../../contracts/festive.contract');

const DEFAULT_TIER = 'standard';

// ── Calendar lookups ─────────────────────────────────────────────────────────

/**
 * getActiveEvent(atDate) — the single source of truth for "are we in a sale window".
 * Priority:
 *   1. Any row with forceActive=true (demo override) wins.
 *   2. Otherwise, the first active row whose [startDate, endDate] contains atDate.
 * Returns the lean calendar doc or null.
 */
async function getActiveEvent(atDate = new Date()) {
  const when = atDate instanceof Date ? atDate : new Date(atDate);

  // 1. Demo override
  const forced = await FestiveCalendar.findOne({ forceActive: true, active: true }).lean();
  if (forced) return forced;

  // 2. Date-range match
  return FestiveCalendar.findOne({
    active: true,
    startDate: { $lte: when },
    endDate: { $gte: when },
  })
    .sort({ startDate: -1 })
    .lean();
}

/**
 * isInFestiveWindow(atDate) — boolean convenience wrapper.
 */
async function isInFestiveWindow(atDate = new Date()) {
  return !!(await getActiveEvent(atDate));
}

// ── Trust helper (defensive) ──────────────────────────────────────────────────

async function resolveTier(userId) {
  if (!userId) return DEFAULT_TIER;
  try {
    const trustService = require('../trust/trust.service');
    const profile = await trustService.getTrustProfile(userId);
    return (profile && profile.tier) || DEFAULT_TIER;
  } catch (_) {
    return DEFAULT_TIER; // Phase 3 absent → treat as standard (innocent until proven)
  }
}

// ── Lever 1 — Return-window shrink ────────────────────────────────────────────

/**
 * getReturnWindowDays({ orderCreatedAt, tier, reasonCode })
 * Returns the effective return window (days) for an order.
 *
 * Rules:
 *   - Order NOT placed inside a festive window → base window.
 *   - Defective / wrong_item → always base window (genuine faults never penalised).
 *   - Genuine tiers (verified/trusted) → base window even during festive.
 *   - Risky tiers during festive → shrunken per FESTIVE_RETURN_WINDOW_DAYS.
 *
 * `tier` may be passed directly (preferred — caller already has it) or omitted.
 */
async function getReturnWindowDays({ orderCreatedAt, tier, reasonCode }) {
  const base = BASE_RETURN_WINDOW_DAYS;

  // Genuine-fault reasons always get the full window.
  if (reasonCode && FULL_WINDOW_REASONS.includes(reasonCode)) {
    return { windowDays: base, shrunk: false, reason: 'full_window_reason' };
  }

  const placedAt = orderCreatedAt ? new Date(orderCreatedAt) : new Date();
  const event = await getActiveEvent(placedAt);

  // Not placed during a festive window, or shrink disabled for the event.
  if (!event || !event.policies || !event.policies.returnWindowShrink) {
    return { windowDays: base, shrunk: false, reason: 'no_festive_window' };
  }

  const effectiveTier = tier || DEFAULT_TIER;
  if (GENUINE_TIERS.includes(effectiveTier)) {
    return { windowDays: base, shrunk: false, reason: 'genuine_tier_exempt', eventCode: event.eventCode };
  }

  const shrunkDays = FESTIVE_RETURN_WINDOW_DAYS[effectiveTier];
  if (shrunkDays == null) {
    return { windowDays: base, shrunk: false, reason: 'tier_unchanged', eventCode: event.eventCode };
  }

  return { windowDays: shrunkDays, shrunk: true, reason: 'festive_shrink', eventCode: event.eventCode };
}

// ── Lever 2 — COD gate ────────────────────────────────────────────────────────

/**
 * getCodPolicy({ tier, cartTotal, atDate })
 * Decides whether COD is offered for a given cart during a festive window.
 *
 * Outside a festive window → COD always allowed (no festive friction).
 * Inside → gated by tier + cart value per FESTIVE_COD_POLICY.
 */
async function getCodPolicy({ tier, cartTotal = 0, atDate = new Date() } = {}) {
  const event = await getActiveEvent(atDate);

  // No festive window, or COD gate disabled for this event → COD unrestricted.
  if (!event || !event.policies || !event.policies.codGate) {
    return {
      codAllowed: true,
      cap: null,
      capExceeded: false,
      partialPrepaidToken: null,
      festive: false,
      reason: 'no_festive_window',
    };
  }

  const effectiveTier = tier || DEFAULT_TIER;
  const policy = FESTIVE_COD_POLICY[effectiveTier] || FESTIVE_COD_POLICY[DEFAULT_TIER];

  // Tier blocked outright.
  if (!policy.codAllowed) {
    return {
      codAllowed: false,
      cap: 0,
      capExceeded: true,
      partialPrepaidToken: PARTIAL_PREPAID_TOKEN_INR,
      festive: true,
      eventCode: event.eventCode,
      reason: 'tier_blocked',
    };
  }

  // Tier allowed with no cap.
  if (policy.cap == null) {
    return {
      codAllowed: true,
      cap: null,
      capExceeded: false,
      partialPrepaidToken: null,
      festive: true,
      eventCode: event.eventCode,
      reason: 'tier_uncapped',
    };
  }

  // Tier allowed up to a cap.
  const capExceeded = Number(cartTotal) > policy.cap;
  return {
    codAllowed: !capExceeded,
    cap: policy.cap,
    capExceeded,
    partialPrepaidToken: capExceeded ? PARTIAL_PREPAID_TOKEN_INR : null,
    festive: true,
    eventCode: event.eventCode,
    reason: capExceeded ? 'cap_exceeded' : 'within_cap',
  };
}

// ── Lever 3 — Mid-transit cancel lock ─────────────────────────────────────────

/**
 * canCancelOrder({ fulfillmentStatus, tier, orderCreatedAt, atDate })
 * Decides whether an order may be cancelled right now.
 *
 * Lock engages only when ALL of:
 *   - we are in a cancel-lock event (BBD/GIF) — checked at `atDate` (now), and
 *   - the order's fulfillment has left 'placed' (dispatched/in_transit/out_for_delivery), and
 *   - the buyer's tier is a cancel-lock target (non-genuine).
 *
 * 'placed' is always cancellable (the remorse window stays open for everyone).
 * 'delivered' is handled by the returns flow, not cancel.
 */
async function canCancelOrder({ fulfillmentStatus = 'placed', tier, atDate = new Date() } = {}) {
  // Still in the pre-dispatch remorse window → anyone can cancel.
  if (!CANCEL_LOCKED_STATES.includes(fulfillmentStatus)) {
    return { canCancel: true, reason: 'not_in_locked_state' };
  }

  const event = await getActiveEvent(atDate);
  const isCancelLockEvent =
    event && event.policies && event.policies.cancelLock && CANCEL_LOCK_EVENTS.includes(event.eventCode);

  if (!isCancelLockEvent) {
    return { canCancel: true, reason: 'no_cancel_lock_event' };
  }

  const effectiveTier = tier || DEFAULT_TIER;
  if (!CANCEL_LOCK_TARGET_TIERS.includes(effectiveTier)) {
    return { canCancel: true, reason: 'genuine_tier_exempt', eventCode: event.eventCode };
  }

  return {
    canCancel: false,
    reason: 'mid_transit_lock',
    eventCode: event.eventCode,
    message:
      'This order is in transit during our festive sale and cannot be cancelled. ' +
      'You can refuse delivery at the door, or start a return after it arrives.',
  };
}

// ── Order-time policy snapshot ────────────────────────────────────────────────

/**
 * buildOrderFestivePolicy({ userId, tier, cartTotal, paymentMethod, atDate })
 * Computes the full festive policy bundle to STAMP on an order at placement time.
 * Snapshotting protects the buyer from later calendar edits.
 *
 * Returns { festive, eventCode, returnWindowDays, codPolicy, cancelLockApplies, snapshotAt }.
 */
async function buildOrderFestivePolicy({ userId, tier, cartTotal = 0, atDate = new Date() } = {}) {
  const effectiveTier = tier || (await resolveTier(userId));
  const event = await getActiveEvent(atDate);

  const window = await getReturnWindowDays({ orderCreatedAt: atDate, tier: effectiveTier });
  const codPolicy = await getCodPolicy({ tier: effectiveTier, cartTotal, atDate });

  const cancelLockApplies =
    !!event &&
    !!event.policies &&
    !!event.policies.cancelLock &&
    CANCEL_LOCK_EVENTS.includes(event.eventCode) &&
    CANCEL_LOCK_TARGET_TIERS.includes(effectiveTier);

  return {
    festive: !!event,
    eventCode: event ? event.eventCode : null,
    instanceKey: event ? event.instanceKey : null,
    tierAtPurchase: effectiveTier,
    returnWindowDays: window.windowDays,
    returnWindowShrunk: window.shrunk,
    codPolicy: {
      codAllowed: codPolicy.codAllowed,
      cap: codPolicy.cap,
      partialPrepaidToken: codPolicy.partialPrepaidToken,
    },
    cancelLockApplies,
    snapshotAt: new Date(),
  };
}

// ── Calendar admin helpers ────────────────────────────────────────────────────

async function listEvents() {
  return FestiveCalendar.find({}).sort({ startDate: 1 }).lean();
}

/**
 * setForceActive(instanceKey, on) — the demo override toggle.
 * Clears forceActive on all other rows so only one event is forced at a time.
 */
async function setForceActive(instanceKey, on) {
  if (on) {
    await FestiveCalendar.updateMany({}, { $set: { forceActive: false } });
    return FestiveCalendar.findOneAndUpdate(
      { instanceKey },
      { $set: { forceActive: true, active: true } },
      { new: true }
    ).lean();
  }
  return FestiveCalendar.findOneAndUpdate(
    { instanceKey },
    { $set: { forceActive: false } },
    { new: true }
  ).lean();
}

module.exports = {
  getActiveEvent,
  isInFestiveWindow,
  resolveTier,
  getReturnWindowDays,
  getCodPolicy,
  canCancelOrder,
  buildOrderFestivePolicy,
  listEvents,
  setForceActive,
};
