/**
 * demand.service.js — Demand Registry: buyer "Looking for…" posts, geo + tag
 * matching, and per-warehouse demand for the admin map.
 *
 * Pure-ish: all geo work is MongoDB `$geoNear` aggregation over the `wants`
 * collection (2dsphere index). LLM tagging is keyword-based and deterministic
 * (no network) so the demo is stable.
 */

const mongoose = require('mongoose');
const Want = require('./demand.model');
const Warehouse = require('./warehouse.model');
const { WAREHOUSES } = require('../routing/routing.config');
const { DEFAULT_RADIUS_KM, DEFAULT_POST_TTL_DAYS } = require('../../contracts/demand.contract');

const DAY_MS = 86400000;

// Common words we never want as search tags.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'looking', 'want', 'need', 'a', 'an', 'of', 'to',
  'in', 'on', 'under', 'over', 'used', 'new', 'second', 'hand', 'good', 'condition',
  'size', 'my', 'me', 'please', 'any', 'some', 'this', 'that', 'is', 'are',
]);

/**
 * Reduce a word to a crude singular stem so matching is bidirectional:
 *   shoes→shoe, boxes→box, watches→watch, laptop→laptop.
 * Because the stem is a prefix of the inflected form, a substring regex built
 * from the stem matches BOTH singular and plural stored keywords.
 */
const stemToken = (t) => {
  const w = String(t).toLowerCase();
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1);
  return w;
};

// Build a case-insensitive regex from stemmed tokens (or null if none).
const buildKeywordRegex = (tokens = []) => {
  const stems = [...new Set(tokens.map(stemToken).filter(Boolean))];
  if (stems.length === 0) return null;
  const escaped = stems.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(escaped.join('|'), 'i');
};

/**
 * generateTags — turn an item (or free text) into a small set of search tags.
 * Deterministic keyword extraction; no LLM dependency.
 */
const generateTags = (item = {}, grade = null) => {
  const parts = [
    item.title,
    item.__productTitle,
    item.category,
    item.description,
    item.reasonText,
    grade?.grade ? `grade-${grade.grade}` : null,
  ].filter(Boolean);
  const text = parts.join(' ').toLowerCase();
  const words = text
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
  return [...new Set(words)].slice(0, 10);
};

// Build a "not expired + active" filter fragment.
const liveFilter = () => ({
  active: true,
  $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }],
});

/**
 * createWant — register a buyer "Looking for…" post.
 * Accepts both { lng, lat } and a GeoJSON { location } shape.
 */
const createWant = async (userId, data = {}) => {
  const lng = data.lng ?? data.location?.coordinates?.[0];
  const lat = data.lat ?? data.location?.coordinates?.[1];
  if (lng == null || lat == null) throw new Error('Location (lng/lat) is required');

  const keywords =
    Array.isArray(data.keywords) && data.keywords.length > 0
      ? data.keywords
      : generateTags({ description: data.text, category: data.productCategory });

  const expiresAt =
    data.expiresAt || new Date(Date.now() + DEFAULT_POST_TTL_DAYS * DAY_MS);

  return Want.create({
    userId,
    productCategory: data.productCategory,
    keywords,
    maxPrice: data.maxPrice,
    condition: data.condition || 'any',
    location: { type: 'Point', coordinates: [Number(lng), Number(lat)] },
    radiusKm: data.radiusKm || DEFAULT_RADIUS_KM,
    active: true,
    expiresAt,
  });
};

const getWantsByUser = async (userId) => {
  if (!mongoose.isValidObjectId(userId)) return [];
  return Want.find({ userId, ...liveFilter() }).sort({ createdAt: -1 }).lean();
};

const deactivateWant = async (wantId, userId) => {
  if (!mongoose.isValidObjectId(wantId)) return null;
  return Want.findOneAndUpdate({ _id: wantId, userId }, { active: false }, { new: true }).lean();
};

/**
 * matchDemandForItem — nearby buyer posts matching an item's category/tags.
 * Returns { count, radiusKm, posts }. Used by routing (demand signal + peer trigger).
 */
const matchDemandForItem = async (category, tags = [], location, radiusKm = DEFAULT_RADIUS_KM) => {
  if (!location?.coordinates) return { count: 0, radiusKm, posts: [] };

  const tagOr = [];
  if (category) tagOr.push({ productCategory: category });
  const kwRegex = buildKeywordRegex(tags);
  if (kwRegex) tagOr.push({ keywords: kwRegex });
  const query = tagOr.length ? _mergeFilters(liveFilter(), { $or: tagOr }) : liveFilter();

  const posts = await Want.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: location.coordinates },
        distanceField: 'distanceM',
        maxDistance: radiusKm * 1000,
        query,
        spherical: true,
      },
    },
    { $limit: 50 },
  ]);

  return { count: posts.length, radiusKm, posts };
};

// Merge two mongo filters without clobbering a shared `$or` key.
const _mergeFilters = (a = {}, b = {}) => {
  const ands = [];
  if (Object.keys(a).length) ands.push(a);
  if (Object.keys(b).length) ands.push(b);
  if (ands.length === 0) return {};
  if (ands.length === 1) return ands[0];
  return { $and: ands };
};

// Distance-decay demand near a point: each matching want contributes
// (1 − dist/maxDist), so closer demand counts more. Returns { score, count }.
// This differentiates warehouses by proximity instead of a flat radius count
// (which made every nearby warehouse tie at the same number).
const _demandNear = async (coordinates, maxDistanceKm, filter = {}) => {
  const maxDistanceM = maxDistanceKm * 1000;
  const res = await Want.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates },
        distanceField: 'distanceM',
        maxDistance: maxDistanceM,
        query: _mergeFilters(liveFilter(), filter),
        spherical: true,
      },
    },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        score: { $sum: { $subtract: [1, { $divide: ['$distanceM', maxDistanceM] }] } },
      },
    },
  ]);
  const row = res[0] || { count: 0, score: 0 };
  return { count: row.count, score: row.score };
};

// Normalize a `score` field across rows → 0..100 (relative to the hottest).
const _normalize = (rows) => {
  const max = Math.max(0, ...rows.map((r) => r.score || 0));
  return rows.map((r) => ({ ...r, demand: max > 0 ? Math.round(((r.score || 0) / max) * 100) : 0 }));
};

/**
 * demandByWarehouse(term) → [{ warehouseCode, demand, raw, warehouse }]
 * Distance-decay demand for a search term near each warehouse, normalized 0-100.
 * `raw` is the actual matching want count; `demand` is the normalized heat score.
 */
const demandByWarehouse = async (term, { maxDistanceKm = 150 } = {}) => {
  const warehouses = (await Warehouse.find().lean()) || [];
  const list = warehouses.length ? warehouses : WAREHOUSES;

  const tokens = String(term || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  const filter = (() => {
    const rx = buildKeywordRegex(tokens);
    if (!rx) return {};
    return { $or: [{ keywords: rx }, { productCategory: rx }] };
  })();

  const rows = [];
  for (const wh of list) {
    const { score, count } = await _demandNear(wh.location.coordinates, maxDistanceKm, filter);
    rows.push({ warehouseCode: wh.code, score, raw: count, warehouse: wh });
  }
  return _normalize(rows);
};

/**
 * demandByWarehouseForItem(category, tags) → { [warehouseCode]: demand(0-100) }
 * Used by routing.warehouse.chooseWarehouse to weight warehouses by nearby demand.
 */
const demandByWarehouseForItem = async (category, tags = [], { maxDistanceKm = 150 } = {}) => {
  const tagOr = [];
  if (category) tagOr.push({ productCategory: category });
  const kwRegex = buildKeywordRegex(tags);
  if (kwRegex) tagOr.push({ keywords: kwRegex });
  const filter = tagOr.length ? { $or: tagOr } : {};

  const list = (await Warehouse.find().lean()) || [];
  const warehouses = list.length ? list : WAREHOUSES;

  const rows = [];
  for (const wh of warehouses) {
    const { score } = await _demandNear(wh.location.coordinates, maxDistanceKm, filter);
    rows.push({ warehouseCode: wh.code, score });
  }
  const normalized = _normalize(rows);
  return Object.fromEntries(normalized.map((r) => [r.warehouseCode, r.demand]));
};

const listWarehouses = async () => {
  const list = await Warehouse.find().lean();
  return list.length ? list : WAREHOUSES;
};

/**
 * notifyMatches — in-app "ping nearby buyers" stub. Real email/SMS = TODO.
 * Best-effort, never throws.
 */
const notifyMatches = async (listingId) => {
  try {
    return { notified: 0, listingId: String(listingId) };
  } catch (_) {
    return { notified: 0 };
  }
};

module.exports = {
  generateTags,
  createWant,
  getWantsByUser,
  deactivateWant,
  matchDemandForItem,
  demandByWarehouse,
  demandByWarehouseForItem,
  listWarehouses,
  notifyMatches,
};
