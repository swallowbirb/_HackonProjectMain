/**
 * routingDemo.js — frontend mirror of the backend "best warehouse, not nearest"
 * routing math (backend/src/modules/routing/routing.{config,warehouse}.js) plus
 * the map geometry the reseller route view needs.
 *
 * Distances here are derived from the on-screen demo layout (same approach as the
 * admin Demand Map) so the curved path drawn on the map visually matches the km
 * numbers we show. Pure functions — no network, no DOM.
 */

// ── Map canvas (matches the admin Demand Map for visual parity) ───────────────
export const MAP_W = 560;
export const MAP_H = 560;
const MAP_WIDTH_KM = 570;
export const KM_PER_PX = MAP_WIDTH_KM / MAP_W;

// Evenly-spread warehouse layout (fractions of the viewport).
export const WAREHOUSE_LAYOUT = {
  'BILASPUR-01': { fx: 0.46, fy: 0.15 },
  'KORBA-01': { fx: 0.8, fy: 0.23 },
  'RAIGARH-01': { fx: 0.85, fy: 0.48 },
  'RAIPUR-01': { fx: 0.5, fy: 0.5 },
  'BHILAI-01': { fx: 0.22, fy: 0.54 },
  'DURG-01': { fx: 0.18, fy: 0.82 },
  'JAGDALPUR-01': { fx: 0.56, fy: 0.85 },
};

// The customer / source of the returned item (offset from Raipur so the route arc
// is always visible). Demo origin is Raipur (routing.config DEFAULT_ORIGIN).
export const SOURCE_POINT = { fx: 0.36, fy: 0.66, city: 'Raipur' };

// All demo cities selectable as reseller origin
export const DEMO_CITIES = [
  { city: 'Raipur',     fx: 0.36, fy: 0.66 },
  { city: 'Bhilai',    fx: 0.22, fy: 0.54 },
  { city: 'Durg',      fx: 0.18, fy: 0.82 },
  { city: 'Bilaspur',  fx: 0.46, fy: 0.15 },
  { city: 'Korba',     fx: 0.80, fy: 0.23 },
  { city: 'Raigarh',   fx: 0.85, fy: 0.48 },
  { city: 'Jagdalpur', fx: 0.56, fy: 0.85 },
];

const BOUNDS = { minLng: 80.5, maxLng: 84.0, minLat: 18.5, maxLat: 22.8 };

export const projectGeo = ([lng, lat]) => ({
  x: ((lng - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng)) * MAP_W,
  y: MAP_H - ((lat - BOUNDS.minLat) / (BOUNDS.maxLat - BOUNDS.minLat)) * MAP_H,
});

export const warehousePos = (warehouseCode, coords) => {
  const slot = WAREHOUSE_LAYOUT[warehouseCode];
  if (slot) return { x: slot.fx * MAP_W, y: slot.fy * MAP_H };
  return coords ? projectGeo(coords) : { x: MAP_W / 2, y: MAP_H / 2 };
};

export const sourcePos = (city) => {
  if (city) {
    const c = DEMO_CITIES.find((d) => d.city === city);
    if (c) return { x: c.fx * MAP_W, y: c.fy * MAP_H };
  }
  return { x: SOURCE_POINT.fx * MAP_W, y: SOURCE_POINT.fy * MAP_H };
};

export const pixelDist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ── Reverse-logistics cost model (routing.config) ─────────────────────────────
const CARRIER = { baseFee: 40, perKm: 1.2 };
const WEIGHT_BRACKETS = [
  { maxKg: 0.5, multiplier: 0.6 },
  { maxKg: 2, multiplier: 1.0 },
  { maxKg: 5, multiplier: 1.6 },
  { maxKg: 15, multiplier: 2.4 },
  { maxKg: Infinity, multiplier: 3.5 },
];
const DEFAULT_WEIGHT_KG = 1.5;
const CATEGORY_WEIGHT_KG = {
  Electronics: 1.2, Clothing: 0.4, 'Home & Garden': 4, Sports: 2,
  Toys: 0.8, Books: 0.6, Automotive: 6, 'Health & Beauty': 0.3, general: DEFAULT_WEIGHT_KG,
};
const HOLDING_COST_PER_DAY = {
  Electronics: 12, Clothing: 4, 'Home & Garden': 3, Sports: 5,
  Toys: 2, Books: 1, Automotive: 6, 'Health & Beauty': 8, general: 5,
};
const WAREHOUSE = { demandWeight: 0.08, inboundWeight: 1.0, outboundWeight: 1.0, holdingDays: 14, expectedOutboundKm: 30 };
// Demand (normalized 0-100) at/above which a warehouse is treated as a near-certain
// sell-through. Mirrors backend routing.config.SELL_THROUGH_REF.
const SELL_THROUGH_REF = 40;

const weightMultiplier = (kg) => (WEIGHT_BRACKETS.find((b) => kg <= b.maxKg) || WEIGHT_BRACKETS[WEIGHT_BRACKETS.length - 1]).multiplier;
const categoryWeight = (category) => CATEGORY_WEIGHT_KG[category] || DEFAULT_WEIGHT_KG;

const inboundCost = (distanceKm, category) => {
  const mult = weightMultiplier(categoryWeight(category));
  return Math.round(CARRIER.baseFee + CARRIER.perKm * distanceKm * mult);
};

/**
 * Rank every warehouse for an item and pick the winner — mirrors the backend
 * decision-tree's warehouse step (routing.warehouse.chooseWarehouse):
 *
 *   expectedRecovery = resaleValue × sellThrough(demand) − inboundCost
 *   sellThrough = min(1, demand / SELL_THROUGH_REF)
 *
 * Highest expected recovery wins; a warehouse is "viable" only if it turns a
 * profit (> 0). If none are viable the item is donated/liquidated instead.
 *
 * @param {object} args
 *   warehouses  [{ warehouseCode, demand (0-100), raw, warehouse:{ city, name, location } }]
 *   resaleValue Number
 *   category    String
 *   source      {x,y}  source pixel position (defaults to SOURCE_POINT)
 * @returns {{ ranked, winner, nearest }}
 */
export const rankWarehouses = ({ warehouses = [], resaleValue = 0, category = 'general', source } = {}) => {
  const src = source || sourcePos();

  const ranked = warehouses
    .map((w) => {
      const pos = warehousePos(w.warehouseCode, w.warehouse?.location?.coordinates);
      const distanceKm = Math.round(pixelDist(src, pos) * KM_PER_PX);
      const inbound = inboundCost(distanceKm, category);
      const demand = Number(w.demand) || 0; // 0-100 normalized
      const sellThrough = Math.max(0, Math.min(1, demand / SELL_THROUGH_REF));
      const expectedRecovery = Math.round(resaleValue * sellThrough - inbound);
      return {
        code: w.warehouseCode,
        city: w.warehouse?.city || w.warehouseCode,
        name: w.warehouse?.name || w.warehouseCode,
        pos,
        demand,
        raw: w.raw ?? 0,
        distanceKm,
        inbound,
        sellThrough: Math.round(sellThrough * 100) / 100,
        netRecovery: expectedRecovery,
        score: expectedRecovery,
        viable: expectedRecovery > 0,
      };
    })
    .sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm);

  const winner = ranked[0] || null;
  const nearest = [...ranked].sort((a, b) => a.distanceKm - b.distanceKm)[0] || null;
  return { ranked, winner, nearest };
};

// ── Map a resale listing to a demo demand search term ─────────────────────────
const TERM_RULES = [
  [/shoe|sneaker|pegasus|running|footwear/i, 'shoe'],
  [/headphone|earbud|wh-1000|earphone|audio/i, 'headphones'],
  [/chair|stool|seat/i, 'office chair'],
  [/laptop|macbook|notebook|tab\b|tablet|ipad/i, 'laptop'],
  [/phone|galaxy s|iphone|pixel|smartphone/i, 'smartphone'],
  [/wash|washer|dryer/i, 'washing machine'],
  [/jacket|coat|hoodie|sweater/i, 'jacket'],
  [/book|textbook|novel/i, 'textbook'],
];

export const demandTermForListing = (listing = {}) => {
  const hay = `${listing.title || ''} ${listing.category || ''}`;
  for (const [re, term] of TERM_RULES) if (re.test(hay)) return term;
  return (listing.category || 'shoe').toLowerCase();
};

// ── Curved route path (quadratic Bézier) ──────────────────────────────────────
/**
 * Build a smooth curved path string + control point from source → destination.
 * @returns {{ d: string, control: {x,y} }}
 */
export const curvedPath = (s, d, curvature = 0.24) => {
  const mx = (s.x + d.x) / 2;
  const my = (s.y + d.y) / 2;
  const dx = d.x - s.x;
  const dy = d.y - s.y;
  const len = Math.hypot(dx, dy) || 1;
  // Perpendicular unit vector → bow the arc to one side.
  const px = -dy / len;
  const py = dx / len;
  const offset = len * curvature;
  const control = { x: mx + px * offset, y: my + py * offset };
  return { d: `M ${s.x} ${s.y} Q ${control.x} ${control.y} ${d.x} ${d.y}`, control };
};

/** Point along a quadratic Bézier at t∈[0,1]. */
export const bezierPoint = (s, c, d, t) => {
  const mt = 1 - t;
  return {
    x: mt * mt * s.x + 2 * mt * t * c.x + t * t * d.x,
    y: mt * mt * s.y + 2 * mt * t * c.y + t * t * d.y,
  };
};

export const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
