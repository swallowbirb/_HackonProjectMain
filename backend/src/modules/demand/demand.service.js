const Want = require('./demand.model');
const Warehouse = require('./warehouse.model');
const { DEFAULT_RADIUS_KM, DEFAULT_POST_TTL_DAYS } = require('../../contracts/demand.contract');

/**
 * Demand Registry service (Phase A — buyer "Looking for…" posts + geo matching).
 *
 * A "Want" is a buyer's free-text demand post ("looking for red running shoes
 * size 9 under 2000") anchored to a GeoJSON location. We derive simple search
 * keywords from the free text (deterministic fallback; an LLM tagger can replace
 * `extractKeywords` later without changing this contract).
 */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'for', 'of', 'and', 'or', 'to', 'in', 'on', 'with', 'my',
  'looking', 'want', 'wanted', 'need', 'needed', 'buy', 'under', 'below', 'less',
  'than', 'around', 'about', 'some', 'any', 'please', 'rs', 'inr', 'price',
]);

/**
 * Deterministic keyword extraction from free text — the keyword fallback the
 * plan calls for when no LLM is available. Lowercases, strips punctuation,
 * drops stopwords and pure numbers, and de-duplicates.
 */
const extractKeywords = (text = '') => {
  return [
    ...new Set(
      String(text)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
    ),
  ].slice(0, 12);
};

/**
 * Create a buyer "Looking for…" post.
 * @param {string} userId
 * @param {object} data { text, productCategory, keywords?, maxPrice?, condition?,
 *                        lng, lat, radiusKm?, notifyByEmail?, notifyByPush? }
 */
const createWant = async (userId, data) => {
  const { text, productCategory, maxPrice, condition, lng, lat } = data;

  const keywords = Array.isArray(data.keywords) && data.keywords.length
    ? data.keywords.map((k) => String(k).toLowerCase().trim()).filter(Boolean)
    : extractKeywords(text);

  const expiresAt = new Date(Date.now() + DEFAULT_POST_TTL_DAYS * 24 * 60 * 60 * 1000);

  const want = await Want.create({
    userId,
    text: text?.trim(),
    productCategory: productCategory.trim(),
    keywords,
    maxPrice: maxPrice != null ? Number(maxPrice) : undefined,
    condition: condition || 'any',
    location: { type: 'Point', coordinates: [Number(lng), Number(lat)] },
    radiusKm: data.radiusKm != null ? Number(data.radiusKm) : DEFAULT_RADIUS_KM,
    notifyByEmail: data.notifyByEmail !== false,
    notifyByPush: !!data.notifyByPush,
    active: true,
    expiresAt,
  });

  return want.toObject();
};

/**
 * Fetch a user's posts. Active, non-expired first; newest first.
 */
const getWantsByUser = async (userId, { includeInactive = true } = {}) => {
  const query = { userId };
  if (!includeInactive) {
    query.active = true;
    query.expiresAt = { $gt: new Date() };
  }
  return Want.find(query).sort({ createdAt: -1 }).lean();
};

/**
 * Geo + tag match: find active, non-expired wants near a graded item whose
 * keywords/category overlap the item. Powers the routing demand signal and the
 * peer-handoff trigger.
 *
 * @returns {{ count, radiusKm, posts }}
 */
const matchDemandForItem = async (category, tags = [], location, radiusKm = DEFAULT_RADIUS_KM) => {
  if (!location || !Array.isArray(location.coordinates)) {
    return { count: 0, radiusKm, posts: [] };
  }

  const normTags = (tags || []).map((t) => String(t).toLowerCase().trim()).filter(Boolean);

  const geoFilter = {
    active: true,
    expiresAt: { $gt: new Date() },
    location: {
      $geoWithin: {
        $centerSphere: [location.coordinates, radiusKm / 6378.1], // earth radius km
      },
    },
  };

  // Tag/category overlap: same category OR any keyword overlap with item tags.
  const matchClauses = [];
  if (category) matchClauses.push({ productCategory: category });
  if (normTags.length) matchClauses.push({ keywords: { $in: normTags } });
  if (matchClauses.length) geoFilter.$or = matchClauses;

  const posts = await Want.find(geoFilter).limit(200).lean();
  return { count: posts.length, radiusKm, posts };
};

/**
 * Soft-delete: deactivate a post (owner only). Returns the updated doc or null.
 */
const deactivateWant = async (wantId, userId) => {
  return Want.findOneAndUpdate(
    { _id: wantId, userId },
    { $set: { active: false } },
    { new: true }
  ).lean();
};

/**
 * Turn an item into search tags. Deterministic keyword fallback (the plan's
 * "keyword fallback if the LLM is unavailable"). An LLM tagger can replace the
 * body later without changing the signature.
 *
 * @param {object} item  { category, description, reasonText, ... }
 * @param {object} grade { defects, rationale, ... } (optional)
 * @returns {string[]}
 */
const generateTags = (item = {}, grade = {}) => {
  const parts = [
    item.category,
    item.description,
    item.reasonText,
    item.__productTitle,
    grade?.rationale,
    ...(grade?.defects || []).map((d) => `${d.type} ${d.location || ''}`),
  ].filter(Boolean);
  const tags = extractKeywords(parts.join(' '));
  if (item.category) tags.unshift(String(item.category).toLowerCase());
  return [...new Set(tags)].slice(0, 12);
};

/**
 * List demo warehouses.
 */
const listWarehouses = async () => Warehouse.find({}).sort({ code: 1 }).lean();

/**
 * Per-warehouse demand for a search term, normalized 0-100 for the admin map.
 * For each warehouse, counts active nearby wants whose category/keywords match
 * the term (via `$geoWithin` over the warehouse radius), then min-max normalizes.
 *
 * @param {string} term  e.g. "shoe"
 * @param {number} radiusKm  search radius around each warehouse (default 60)
 * @returns {Promise<[{ warehouseCode, demand, raw, warehouse }]>}
 */
const demandByWarehouse = async (term, radiusKm = 60) => {
  const warehouses = await Warehouse.find({}).lean();
  if (warehouses.length === 0) return [];

  const tags = term ? extractKeywords(term) : [];
  const termLc = term ? String(term).toLowerCase().trim() : '';

  const matchClause =
    termLc || tags.length
      ? {
          $or: [
            { productCategory: new RegExp(termLc, 'i') },
            { keywords: { $in: tags.length ? tags : [termLc] } },
            { text: new RegExp(termLc, 'i') },
          ],
        }
      : {};

  const counts = await Promise.all(
    warehouses.map(async (wh) => {
      const raw = await Want.countDocuments({
        active: true,
        expiresAt: { $gt: new Date() },
        ...matchClause,
        location: {
          $geoWithin: { $centerSphere: [wh.location.coordinates, radiusKm / 6378.1] },
        },
      });
      return { warehouseCode: wh.code, raw, warehouse: wh };
    })
  );

  const max = Math.max(1, ...counts.map((c) => c.raw));
  return counts.map((c) => ({
    warehouseCode: c.warehouseCode,
    demand: Math.round((c.raw / max) * 100),
    raw: c.raw,
    warehouse: c.warehouse,
  }));
};

/**
 * Notify nearby buyers that a matching item is available (in-app flag).
 * Real email/SMS/push = TODO. For the demo this marks matched wants as notified
 * and returns the count pinged.
 *
 * @param {object} args { category, tags, location, radiusKm }
 */
const notifyMatches = async ({ category, tags = [], location, radiusKm = DEFAULT_RADIUS_KM } = {}) => {
  const { posts } = await matchDemandForItem(category, tags, location, radiusKm);
  if (!posts.length) return { notified: 0 };
  const ids = posts.map((p) => p._id);
  await Want.updateMany({ _id: { $in: ids } }, { $set: { lastNotifiedAt: new Date() } });
  return { notified: posts.length, postIds: ids };
};

module.exports = {
  extractKeywords,
  createWant,
  getWantsByUser,
  matchDemandForItem,
  deactivateWant,
  generateTags,
  listWarehouses,
  demandByWarehouse,
  notifyMatches,
};
