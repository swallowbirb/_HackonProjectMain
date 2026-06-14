/**
 * routing.config.js — all tunable constants for the disposition engine.
 *
 * Pure data + a couple of small lookups. No DB, no network. Everything the
 * scoring and warehouse modules need to be deterministic lives here so the demo
 * is explainable and the unit tests are stable.
 */

// ── Reverse-logistics cost model (Haversine + weight bracket) ────────────────
// Cost ≈ baseFee + perKm × distanceKm × weightMultiplier. Cheap, no external API.
const CARRIER = {
  baseFee: 40, // ₹ flat pickup/handling
  perKm: 1.2, // ₹ per km (single leg)
};

// Weight brackets (kg) → multiplier applied to the per-km cost.
const WEIGHT_BRACKETS = [
  { maxKg: 0.5, multiplier: 0.6 },
  { maxKg: 2, multiplier: 1.0 },
  { maxKg: 5, multiplier: 1.6 },
  { maxKg: 15, multiplier: 2.4 },
  { maxKg: Infinity, multiplier: 3.5 },
];

// Default item weight (kg) when the category/item doesn't specify one.
const DEFAULT_WEIGHT_KG = 1.5;

// Rough per-category weight estimate (kg) — used when the item has no weight.
const CATEGORY_WEIGHT_KG = {
  Electronics: 1.2,
  Clothing: 0.4,
  'Home & Garden': 4,
  Sports: 2,
  Toys: 0.8,
  Books: 0.6,
  Automotive: 6,
  'Health & Beauty': 0.3,
  general: DEFAULT_WEIGHT_KG,
};

// ── Path scoring factors ─────────────────────────────────────────────────────
// Base appeal of each path before economics/grade/demand adjust it.
const PATH_BASE = {
  resell: 50,
  refurbish: 35,
  'peer-redistribute': 45,
  donate: 15,
  liquidate: 10,
  'return-to-seller': 5,
};

// Grade → how much each grade favours resale-class paths (quality multiplier).
const GRADE_RESALE_FACTOR = { A: 1.0, B: 0.8, C: 0.5, D: 0.1 };

// Demand conversion factor: nearby demand is a *signal*, not a promise (edge case #6).
// Expected conversions ≈ demandCount × DEMAND_CONVERSION, capped.
const DEMAND_CONVERSION = 0.15;
const DEMAND_SCORE_CAP = 25; // max points demand can add to a path

// Holding cost per day (₹) while an item waits at home / in a warehouse, by category.
// Fast-depreciating categories cost more to hold (edge case #8).
const HOLDING_COST_PER_DAY = {
  Electronics: 12,
  Clothing: 4,
  'Home & Garden': 3,
  Sports: 5,
  Toys: 2,
  Books: 1,
  Automotive: 6,
  'Health & Beauty': 8,
  general: 5,
};

// ── Hold-at-home matching window ─────────────────────────────────────────────
// How long we hold an item at the customer's home to try a peer match before
// shipping to a warehouse. Scales DOWN for fast-depreciating/seasonal categories.
const MATCH_WINDOW_HOURS = Number(process.env.MATCH_WINDOW_HOURS) || 48;

// Per-category override (hours). Missing → MATCH_WINDOW_HOURS.
const MATCH_WINDOW_BY_CATEGORY = {
  Electronics: 24, // depreciates fast
  'Health & Beauty': 12,
  Clothing: 36,
  Books: 72,
};

// ── Hygiene / safety gate ────────────────────────────────────────────────────
// These categories can never peer-redistribute or resell regardless of demand
// (edge case #13). They are forced to donate/liquidate locally.
const HYGIENE_CATEGORIES = ['Health & Beauty', 'Innerwear', 'Cosmetics', 'Food', 'Grocery'];

// ── Trust thresholds for refund timing ──────────────────────────────────────
const TRUST = {
  // Tiers mirror Phase 3 trust.contract: verified | trusted | standard | watch | restricted.
  TRUSTED_TIERS: ['verified', 'trusted'],
  LOW_TRUST_TIERS: ['watch'],
  RESTRICTED_TIERS: ['restricted'],
  // Inbound cost (₹) below which a trusted customer is refunded immediately.
  CHEAP_INBOUND_THRESHOLD: 150,
};

// ── Best-warehouse selection weights ─────────────────────────────────────────
const WAREHOUSE = {
  demandWeight: 0.08, // w in: resaleValue × (1 + w·demand)
  inboundWeight: 1.0,
  outboundWeight: 1.0,
  holdingDays: 14, // expected days in warehouse before sale
  expectedOutboundKm: 30, // assumed avg distance warehouse → buyer
};

// ── Chhattisgarh demo warehouses (code/name/city/lat/lng/capacity/categories) ─
const WAREHOUSES = [
  { code: 'RAIPUR-01', name: 'Raipur Central Hub', city: 'Raipur', location: { type: 'Point', coordinates: [81.6296, 21.2514] }, capacity: 500, categories: ['Electronics', 'Clothing'] },
  { code: 'BHILAI-01', name: 'Bhilai Steel City DC', city: 'Bhilai', location: { type: 'Point', coordinates: [81.3509, 21.1938] }, capacity: 400, categories: ['Automotive', 'Home & Garden'] },
  { code: 'BILASPUR-01', name: 'Bilaspur North Depot', city: 'Bilaspur', location: { type: 'Point', coordinates: [82.1409, 22.0797] }, capacity: 350, categories: ['Clothing', 'Books'] },
  { code: 'KORBA-01', name: 'Korba Industrial Store', city: 'Korba', location: { type: 'Point', coordinates: [82.7501, 22.3595] }, capacity: 250, categories: ['Electronics'] },
  { code: 'DURG-01', name: 'Durg Junction Warehouse', city: 'Durg', location: { type: 'Point', coordinates: [81.2849, 21.1904] }, capacity: 300, categories: ['Sports', 'Toys'] },
  { code: 'RAIGARH-01', name: 'Raigarh East Facility', city: 'Raigarh', location: { type: 'Point', coordinates: [83.3950, 21.8974] }, capacity: 200, categories: ['Home & Garden'] },
  { code: 'JAGDALPUR-01', name: 'Jagdalpur South Point', city: 'Jagdalpur', location: { type: 'Point', coordinates: [82.0290, 19.0748] }, capacity: 180, categories: ['Books', 'Clothing'] },
];

// Default origin used when an item/seller has no location (Item has no geo field).
const DEFAULT_ORIGIN = { type: 'Point', coordinates: [81.6296, 21.2514] }; // Raipur

module.exports = {
  CARRIER,
  WEIGHT_BRACKETS,
  DEFAULT_WEIGHT_KG,
  CATEGORY_WEIGHT_KG,
  PATH_BASE,
  GRADE_RESALE_FACTOR,
  DEMAND_CONVERSION,
  DEMAND_SCORE_CAP,
  HOLDING_COST_PER_DAY,
  MATCH_WINDOW_HOURS,
  MATCH_WINDOW_BY_CATEGORY,
  HYGIENE_CATEGORIES,
  TRUST,
  WAREHOUSE,
  WAREHOUSES,
  DEFAULT_ORIGIN,
};
