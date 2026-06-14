/**
 * Step 0 — Frozen Contract: Demand Registry
 *
 * Shapes shared between Phase A (which implements the geo-matching engine, the
 * admin demand map, and the buyer "Looking for…" posts) and Phase B (which only
 * reads demandCount onto a listing). Phase B does NOT implement these services —
 * it consumes the seam `demand.service.matchDemandForItem` defensively via the
 * `safeMatchDemand` wrapper, degrading to a zero-demand signal if Phase A isn't
 * merged yet.
 *
 * Buyer "Looking for…" post JSON:
 * {
 *   userId: ObjectId,
 *   text: String,              // free-text want, e.g. "red running shoes size 9 under 2000"
 *   tags: [String],            // LLM/keyword-extracted search tags
 *   category: String,
 *   maxPrice: Number,
 *   condition: String,         // like-new | good | fair | any
 *   location: { type:'Point', coordinates:[lng, lat] },  // GeoJSON, 2dsphere
 *   radiusKm: Number,          // how far the buyer will travel
 *   expiresAt: Date,           // stale "wants" are ignored after this
 *   active: Boolean
 * }
 *
 * Warehouse JSON (Chhattisgarh demo set, ~6-8 self-seeded):
 * {
 *   code: String,              // stable short id, e.g. "RAIPUR-01"
 *   name: String,
 *   city: String,
 *   location: { type:'Point', coordinates:[lng, lat] },  // GeoJSON, 2dsphere
 *   capacity: Number,
 *   categories: [String]       // optional specialization (capacity/specialization = TODO)
 * }
 *
 * Seam contracts (names + shapes are frozen here; Phase A implements them):
 *   matchDemandForItem(category, tags, location, radiusKm)
 *       → { count: Number, radiusKm: Number, posts: [post] }
 *   demandByWarehouse(term)
 *       → [{ warehouseCode: String, demand: Number }]  // demand normalized 0-100
 */

const POST_CONDITIONS = ['like-new', 'good', 'fair', 'any'];

const DEFAULT_RADIUS_KM = 25;
const DEFAULT_POST_TTL_DAYS = 30;

/**
 * The neutral demand signal returned by `safeMatchDemand` when the demand
 * service is unavailable (e.g. Phase A not merged). Keeps Phase B fully
 * functional with a zero-demand fallback.
 */
const EMPTY_DEMAND_SIGNAL = { count: 0, radiusKm: DEFAULT_RADIUS_KM, posts: [] };

module.exports = {
  POST_CONDITIONS,
  DEFAULT_RADIUS_KM,
  DEFAULT_POST_TTL_DAYS,
  EMPTY_DEMAND_SIGNAL,
};
