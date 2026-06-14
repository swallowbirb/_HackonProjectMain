/**
 * routing.shipment.js — Phase 8, Part C: the emulated shipment journey.
 *
 * Principle: DERIVE, DON'T TRACK. We persist exactly one timestamp
 * (`shipment.startedAt`) + a small static plan, then compute the current stage
 * and accrued cost from elapsed wall-clock on every read. No map, no GPS, no
 * background worker.
 *
 * This module is PURE (no DB, no network). The service builds the plan, stamps
 * the timestamp, and calls `derive()` on read.
 */

const { CARRIER, SHIPMENT, PEER, WAREHOUSE } = require('./routing.config');

const RESALE_CLASS = new Set(['resell', 'refurbish', 'peer-redistribute']);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Map a routing decision → a shipment destination type.
 */
const destinationTypeForDecision = (decision) => {
  const path = decision?.chosenPath;
  if (path === 'peer-redistribute' && decision?.matchWindow?.active) return 'peer';
  if (path === 'resell' || path === 'refurbish') return 'warehouse';
  if (path === 'peer-redistribute') return 'warehouse'; // peer with no live window → warehouse leg
  if (path === 'donate') return 'ngo';
  if (path === 'liquidate') return 'liquidator';
  if (path === 'return-to-seller') return 'seller';
  return 'warehouse';
};

/**
 * Build the static shipment plan from a routing decision. Stored once at pickup.
 *
 * @param {object} decision  the RoutingDecision (lean/object)
 * @param {string} originCity  city of origin (no street address in the prototype)
 * @returns {object} shipment-plan fields to persist
 */
const buildShipmentPlan = (decision, originCity = 'Raipur') => {
  const destinationType = destinationTypeForDecision(decision);
  const wh = decision?.chosenWarehouse || {};
  const radiusKm = decision?.demandSignal?.radiusKm || 25;

  let distanceKm = 0;
  let totalLogisticsCost = 0;
  let destinationLabel = null;

  if (destinationType === 'warehouse') {
    distanceKm = Number(wh?.breakdown?.distanceKm) || 0;
    totalLogisticsCost = Number(wh?.breakdown?.inbound) || Number(decision?.reverseLogisticsCost) || CARRIER.baseFee;
    destinationLabel = wh?.name ? `${wh.name}${wh.city ? ` (${wh.city})` : ''}` : 'Regional warehouse';
  } else if (destinationType === 'peer') {
    distanceKm = PEER.hopKm;
    totalLogisticsCost = Math.round(CARRIER.baseFee + CARRIER.perKm * PEER.hopKm);
    destinationLabel = `Nearby buyer (≤ ${radiusKm} km)`;
  } else if (destinationType === 'seller') {
    distanceKm = Number(wh?.breakdown?.distanceKm) || Math.round(WAREHOUSE.expectedOutboundKm);
    totalLogisticsCost = Number(decision?.reverseLogisticsCost) || CARRIER.baseFee;
    destinationLabel = 'Original seller';
  } else {
    // donate / liquidate → local handling, single static line, near-flat cost.
    distanceKm = 0;
    totalLogisticsCost = CARRIER.baseFee;
    destinationLabel = destinationType === 'ngo' ? 'Local NGO (donation)' : 'B2B liquidator';
  }

  const totalDurationMs = clamp(
    SHIPMENT.demoSeconds * 1000 + distanceKm * SHIPMENT.distanceNudgeMsPerKm,
    SHIPMENT.demoSeconds * 1000,
    SHIPMENT.maxDurationMs
  );

  return {
    status: 'awaiting_pickup',
    destinationType,
    destinationLabel,
    originLabel: `Customer's address (${originCity})`,
    startedAt: null,
    totalDurationMs,
    distanceKm,
    totalLogisticsCost,
    legs: buildLegs(destinationType),
  };
};

/**
 * Static leg plan (fraction thresholds) per destination type.
 */
const buildLegs = (destinationType) => {
  if (destinationType === 'peer') {
    return [
      { label: 'Held at customer\'s home for nearby buyer', atFraction: 0 },
      { label: 'Handing off to a nearby buyer', atFraction: 0.01 },
      { label: 'Delivered to nearby buyer', atFraction: 1 },
    ];
  }
  if (destinationType === 'ngo') {
    return [{ label: 'Routed for donation to a local NGO', atFraction: 0 }];
  }
  if (destinationType === 'liquidator') {
    return [{ label: 'Routed to a B2B liquidator', atFraction: 0 }];
  }
  if (destinationType === 'seller') {
    return [
      { label: 'Picked up from customer — preparing return', atFraction: 0 },
      { label: 'In transit back to the original seller', atFraction: 0.15 },
      { label: 'Delivered back to the seller', atFraction: 1 },
    ];
  }
  // warehouse
  return [
    { label: 'Picked up from customer — awaiting dispatch', atFraction: 0 },
    { label: 'Dispatched — leaving origin', atFraction: 0.01 },
    { label: 'In transit', atFraction: 0.15 },
    { label: 'Arrived — listing for resale', atFraction: 1 },
  ];
};

/**
 * Human-readable status line for a destination at a given progress.
 */
const statusLine = (shipment, progress) => {
  const { destinationType, destinationLabel, distanceKm } = shipment;
  const km = Math.round(distanceKm || 0);

  if (destinationType === 'peer') {
    if (progress <= 0) return 'Held at customer\'s home for a nearby buyer';
    if (progress >= 1) return 'Delivered to nearby buyer — peer handoff complete';
    return `Handing off to a nearby buyer (${destinationLabel || '≤ 25 km'})`;
  }
  if (destinationType === 'ngo') return 'Routed for donation to a local NGO';
  if (destinationType === 'liquidator') return 'Routed to a B2B liquidator';
  if (destinationType === 'seller') {
    if (progress <= 0) return 'Picked up from customer — preparing return';
    if (progress >= 1) return 'Delivered back to the original seller';
    return 'In transit back to the original seller';
  }
  // warehouse
  if (progress <= 0) return 'Picked up from customer — awaiting dispatch';
  if (progress < 0.15) return 'Dispatched — leaving origin';
  if (progress < 1) return `Transporting to ${destinationLabel || 'warehouse'}${km ? ` — ${km} km` : ''}`;
  return `Arrived at ${destinationLabel || 'warehouse'} — listing for resale`;
};

/**
 * Derive the live shipment state from the stored plan + a clock.
 *
 * @param {object} shipment  the persisted shipment sub-doc
 * @param {Date|number} now
 * @returns {{ status, statusLine, progress, costSoFar, destinationType,
 *             destinationLabel, originLabel, distanceKm, totalLogisticsCost,
 *             totalDurationMs, startedAt, arrived }}
 */
const derive = (shipment = {}, now = Date.now()) => {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const startedAtMs = shipment.startedAt ? new Date(shipment.startedAt).getTime() : null;
  const totalDurationMs = Number(shipment.totalDurationMs) || 0;
  const totalLogisticsCost = Number(shipment.totalLogisticsCost) || 0;

  let progress = 0;
  if (startedAtMs && totalDurationMs > 0) {
    progress = clamp((nowMs - startedAtMs) / totalDurationMs, 0, 1);
  } else if (shipment.status === 'awaiting_pickup') {
    progress = 0;
  }

  // Cost: pickup base fee charged immediately, distance cost accrues linearly.
  const baseFee = Math.min(CARRIER.baseFee, totalLogisticsCost);
  const costSoFar = startedAtMs
    ? Math.round(baseFee + (totalLogisticsCost - baseFee) * progress)
    : 0;

  const arrived = progress >= 1 && shipment.status === 'in_transit';

  return {
    status: shipment.status,
    statusLine: statusLine(shipment, progress),
    progress: Math.round(progress * 100) / 100,
    costSoFar,
    destinationType: shipment.destinationType,
    destinationLabel: shipment.destinationLabel,
    originLabel: shipment.originLabel,
    distanceKm: shipment.distanceKm,
    totalLogisticsCost,
    totalDurationMs,
    startedAt: shipment.startedAt || null,
    arrived, // true → caller should perform the lazy on-arrival side-effect once
  };
};

/**
 * Compute the seller-facing financials (simplified prototype accounting).
 *
 * @param {object} args
 *   originalPrice, refundTiming, refundHold, costSoFar, totalLogisticsCost,
 *   chosenPath, resaleValue, listingPrice, soldPrice
 * @returns {object} financial fields (all ₹, all clearly "estimated")
 */
const computeFinancials = ({
  originalPrice = 0,
  refundTiming = 'on-resolution',
  refundHold = false,
  costSoFar = 0,
  totalLogisticsCost = 0,
  chosenPath = 'resell',
  resaleValue = 0,
  listingPrice = 0,
  soldPrice = null,
} = {}) => {
  // Refund: reflects routing refund timing. Held → not-yet-paid in "net so far".
  const refundPending = !!refundHold || refundTiming === 'on-inspection';
  const refundToCustomer = refundTiming === 'rejected' ? 0 : Math.round(originalPrice);
  const refundPaid = refundPending || refundTiming === 'rejected' ? 0 : refundToCustomer;

  // Projected recovery by path.
  let projectedRecovery = 0;
  if (RESALE_CLASS.has(chosenPath)) {
    projectedRecovery = Math.round(listingPrice || resaleValue || 0);
  } else if (chosenPath === 'liquidate') {
    projectedRecovery = Math.round((resaleValue || 0) * 0.2);
  } else {
    projectedRecovery = 0; // donate / return-to-seller
  }

  const realisedRecovery = soldPrice != null ? Math.round(soldPrice) : 0;

  const netSoFar = realisedRecovery - refundPaid - Math.round(costSoFar);
  const projectedNet = projectedRecovery - refundToCustomer - Math.round(totalLogisticsCost);

  return {
    originalPrice: Math.round(originalPrice),
    refundToCustomer,
    refundPaid,
    refundPending,
    refundTiming,
    logisticsCostSoFar: Math.round(costSoFar),
    totalLogisticsCost: Math.round(totalLogisticsCost),
    projectedRecovery,
    realisedRecovery,
    netSoFar,
    projectedNet,
    note: 'Simplified prototype model — no taxes, platform commission, or restocking.',
  };
};

module.exports = {
  RESALE_CLASS,
  destinationTypeForDecision,
  buildShipmentPlan,
  buildLegs,
  statusLine,
  derive,
  computeFinancials,
};
