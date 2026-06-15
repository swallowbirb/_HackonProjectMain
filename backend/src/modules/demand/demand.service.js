const Want = require('./demand.model');
const Warehouse = require('./warehouse.model');
const DemandConfig = require('./demandConfig.model');
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

/* ────────────────────────────────────────────────────────────────────────────
 * Admin Demand Map — per-city, per-tag demand model.
 *
 * The live `Want` collection is intentionally sparse demo data, and the three
 * central warehouses (Raipur / Bhilai / Durg) all sit inside one 60 km radius so
 * a pure `$geoWithin` count makes them cross-count and read identically. For the
 * admin map we instead drive the demo tags from a deterministic per-warehouse,
 * per-tag demand table (each city's economic character) scaled up ~20x with a
 * stable jitter so every city shows a distinct, realistic number. Arbitrary /
 * unknown search terms still fall back to the real live `$geoWithin` signal.
 * ──────────────────────────────────────────────────────────────────────────── */

// The tag pills shown on the admin map.
const MAP_TAGS = ['shoe', 'laptop', 'office chair', 'washing machine', 'smartphone', 'headphones', 'jacket', 'textbook'];

// Per-warehouse, per-tag demand weight (0-100) — each city's economic character.
const DEMAND_WEIGHTS = {
  'RAIPUR-01':    { shoe: 74, laptop: 80, 'office chair': 35, 'washing machine': 45, smartphone: 88, headphones: 70, jacket: 60, textbook: 40 },
  'BHILAI-01':    { shoe: 44, laptop: 50, 'office chair': 70, 'washing machine': 78, smartphone: 55, headphones: 36, jacket: 30, textbook: 30 },
  'BILASPUR-01':  { shoe: 68, laptop: 48, 'office chair': 34, 'washing machine': 32, smartphone: 52, headphones: 40, jacket: 56, textbook: 86 },
  'KORBA-01':     { shoe: 38, laptop: 76, 'office chair': 40, 'washing machine': 70, smartphone: 72, headphones: 64, jacket: 30, textbook: 28 },
  'DURG-01':      { shoe: 88, laptop: 46, 'office chair': 32, 'washing machine': 34, smartphone: 54, headphones: 44, jacket: 40, textbook: 38 },
  'RAIGARH-01':   { shoe: 36, laptop: 38, 'office chair': 82, 'washing machine': 72, smartphone: 44, headphones: 30, jacket: 26, textbook: 26 },
  'JAGDALPUR-01': { shoe: 48, laptop: 34, 'office chair': 30, 'washing machine': 28, smartphone: 46, headphones: 26, jacket: 38, textbook: 58 },
};

// How "live peer buyers ready for an instant handoff" concentrate per city —
// a different shape than total search demand (Durg/Raipur run hot peer markets).
const PEER_FACTOR = {
  'RAIPUR-01': 0.95, 'BHILAI-01': 0.6, 'BILASPUR-01': 0.72, 'KORBA-01': 0.5,
  'DURG-01': 1.0, 'RAIGARH-01': 0.45, 'JAGDALPUR-01': 0.4,
};

// Scales tuned so raw counts land ~20x above the old sparse seed (tens → hundreds).
const DEMAND_SCALE = 3.0;
const PEER_SCALE = 1.15;

// Map common synonyms onto the canonical demo tags.
const TAG_ALIASES = {
  chair: 'office chair', 'desk chair': 'office chair', shoes: 'shoe', sneakers: 'shoe',
  phone: 'smartphone', mobile: 'smartphone', book: 'textbook', books: 'textbook',
  laptops: 'laptop', headphone: 'headphones', jackets: 'jacket', washer: 'washing machine',
  'washing machines': 'washing machine',
};

const canonicalTag = (term) => {
  const t = String(term || '').toLowerCase().trim();
  return TAG_ALIASES[t] || t;
};

// FNV-1a hash → deterministic 0..1, so per-city numbers are uneven but stable.
const stableUnit = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
};

// Normalize a free-text tag the admin types into the populator.
const sanitizeTag = (raw) =>
  String(raw || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);

// A custom tag has no built-in per-city weights, so synthesize a stable, varied
// shape (20-90) from the tag name — gives each new tag organic per-city variance.
const weightFor = (whCode, tag) => {
  const builtin = DEMAND_WEIGHTS[whCode]?.[tag];
  if (builtin != null) return builtin;
  return 20 + Math.round(stableUnit(`weight|${whCode}|${tag}`) * 70);
};

// Busiest-city weight for a tag, per mode ('demand' uses raw weight, 'peer'
// folds in the per-city peer concentration factor).
const cityWeight = (whCode, tag, mode) => {
  const w = weightFor(whCode, tag);
  return mode === 'peer' ? w * (PEER_FACTOR[whCode] ?? 0.5) : w;
};
const peakWeight = (tag, mode) =>
  Math.max(0, ...Object.keys(DEMAND_WEIGHTS).map((c) => cityWeight(c, tag, mode)));

/**
 * raw count for one (warehouse, tag) cell given a configured PEAK (the count for
 * the busiest city). Each city is shaped down from the peak by its relative
 * weight, with a stable ±20% jitter so the numbers look organic but never change
 * between reloads.
 */
const rawFromPeak = (whCode, tag, peak, mode) => {
  if (peak <= 0) return 0;
  const wmax = peakWeight(tag, mode);
  if (wmax <= 0) return 0;
  const share = cityWeight(whCode, tag, mode) / wmax;
  if (share <= 0) return 0;
  const jitter = (stableUnit(`${mode}|${whCode}|${tag}`) - 0.5) * 0.4; // ±20%
  return Math.max(0, Math.round(peak * share * (1 + jitter)));
};

// Default per-tag peaks for a tag list (reproduce the look before any edits).
const defaultPeaks = (tags) => {
  const demand = {};
  const peers = {};
  for (const t of tags) {
    demand[t] = Math.round(peakWeight(t, 'demand') * DEMAND_SCALE);
    peers[t] = Math.round(peakWeight(t, 'peer') * PEER_SCALE);
  }
  return { demand, peers };
};

// Load the singleton populator config doc (or null).
const loadConfigDoc = async () => {
  try {
    return await DemandConfig.findOne({ key: 'singleton' }).lean();
  } catch (_) {
    return null; // config optional — fall back to defaults
  }
};

// Built-in tags + any saved custom tags, de-duplicated.
const effectiveTagsFrom = (doc) => {
  const custom = Array.isArray(doc?.customTags) ? doc.customTags : [];
  return [...MAP_TAGS, ...custom.filter((t) => t && !MAP_TAGS.includes(t))];
};

// The full effective view: tag list + per-tag peaks (saved over defaults).
const loadEffective = async () => {
  const doc = await loadConfigDoc();
  const tags = effectiveTagsFrom(doc);
  const def = defaultPeaks(tags);
  const demand = {};
  const peers = {};
  for (const t of tags) {
    demand[t] = doc?.demand?.[t] ?? def.demand[t];
    peers[t] = doc?.peers?.[t] ?? def.peers[t];
  }
  return { tags, demand, peers, defaults: def };
};

// Normalize a set of raw rows to 0-100 for the bars/circles.
const normalizeRows = (rows) => {
  const max = Math.max(1, ...rows.map((r) => r.raw));
  return rows.map((r) => ({
    warehouseCode: r.warehouseCode,
    demand: Math.round((r.raw / max) * 100),
    raw: r.raw,
    warehouse: r.warehouse,
  }));
};

/**
 * Per-warehouse demand for a search term, normalized 0-100 for the admin map.
 * Demo tags (built-in + custom) use the rich per-city demand model (scaled with
 * variance); unknown terms fall back to the real live `$geoWithin` Want count.
 *
 * @param {string} term  e.g. "shoe"
 * @param {number} radiusKm  search radius around each warehouse (default 60)
 * @returns {Promise<[{ warehouseCode, demand, raw, warehouse }]>}
 */
const demandByWarehouse = async (term, radiusKm = 60) => {
  const warehouses = await Warehouse.find({}).sort({ code: 1 }).lean();
  if (warehouses.length === 0) return [];

  const tag = canonicalTag(term);
  const eff = await loadEffective();
  if (eff.tags.includes(tag)) {
    const peak = eff.demand[tag] ?? 0;
    const rows = warehouses.map((wh) => ({
      warehouseCode: wh.code,
      raw: rawFromPeak(wh.code, tag, peak, 'demand'),
      warehouse: wh,
    }));
    return normalizeRows(rows);
  }
  return geoDemandByWarehouse(term, radiusKm, warehouses);
};

/**
 * Per-warehouse "peer buyers ready right now" for a tag, normalized 0-100.
 * These are nearby buyers eligible for an instant peer-to-peer handoff — a
 * subset of total search demand with its own per-city concentration.
 *
 * @param {string} term  e.g. "shoe"
 * @returns {Promise<[{ warehouseCode, demand, raw, warehouse }]>}
 */
const peerBuyersByWarehouse = async (term) => {
  const warehouses = await Warehouse.find({}).sort({ code: 1 }).lean();
  if (warehouses.length === 0) return [];

  const tag = canonicalTag(term);
  const eff = await loadEffective();
  if (!eff.tags.includes(tag)) {
    return warehouses.map((wh) => ({ warehouseCode: wh.code, demand: 0, raw: 0, warehouse: wh }));
  }
  const peak = eff.peers[tag] ?? 0;
  const rows = warehouses.map((wh) => ({
    warehouseCode: wh.code,
    raw: rawFromPeak(wh.code, tag, peak, 'peer'),
    warehouse: wh,
  }));
  return normalizeRows(rows);
};

/**
 * Populator tool — read the current effective per-tag peak population (saved
 * overrides merged over built-in defaults), plus the defaults and tag list so
 * the admin sidebar can render + reset its sliders.
 */
const getPopulatorConfig = async () => {
  const eff = await loadEffective();
  return {
    tags: eff.tags,
    builtinTags: MAP_TAGS,
    demand: eff.demand,
    peers: eff.peers,
    defaults: eff.defaults,
  };
};

/**
 * Populator tool — replace the saved per-tag peak population. "Generate and
 * Replace": the next map read reshapes every city from these new peaks.
 *
 * @param {{ demand?: object, peers?: object }} body  per-tag peak counts
 */
const savePopulatorConfig = async ({ demand = {}, peers = {} } = {}) => {
  const doc = await loadConfigDoc();
  const tags = effectiveTagsFrom(doc);
  const clean = (obj) => {
    const out = {};
    for (const t of tags) {
      const v = Number(obj?.[t]);
      if (Number.isFinite(v)) out[t] = Math.min(100000, Math.max(0, Math.round(v)));
    }
    return out;
  };
  await DemandConfig.findOneAndUpdate(
    { key: 'singleton' },
    { $set: { demand: clean(demand), peers: clean(peers) } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return getPopulatorConfig();
};

/**
 * Populator tool — create a new custom tag. Idempotent; built-in tags and
 * duplicates are no-ops. Returns the refreshed config (new tag gets defaults).
 *
 * @param {string} raw  free-text tag, e.g. "gaming console"
 */
const addPopulatorTag = async (raw) => {
  const tag = sanitizeTag(raw);
  if (!tag) {
    const e = new Error('Enter a valid tag name (letters, numbers, spaces).');
    e.statusCode = 400;
    throw e;
  }
  const doc = await loadConfigDoc();
  const custom = Array.isArray(doc?.customTags) ? doc.customTags : [];
  if (!MAP_TAGS.includes(tag) && !custom.includes(tag)) {
    await DemandConfig.findOneAndUpdate(
      { key: 'singleton' },
      { $addToSet: { customTags: tag } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  return getPopulatorConfig();
};

/**
 * Populator tool — remove a custom tag (and its saved peaks). Built-in tags
 * cannot be removed. Returns the refreshed config.
 *
 * @param {string} raw  the custom tag to remove
 */
const removePopulatorTag = async (raw) => {
  const tag = sanitizeTag(raw);
  if (MAP_TAGS.includes(tag)) {
    const e = new Error('Built-in tags cannot be removed.');
    e.statusCode = 400;
    throw e;
  }
  await DemandConfig.findOneAndUpdate(
    { key: 'singleton' },
    { $pull: { customTags: tag }, $unset: { [`demand.${tag}`]: '', [`peers.${tag}`]: '' } },
    { new: true }
  );
  return getPopulatorConfig();
};

/**
 * Real live demand signal: counts active nearby wants whose category/keywords
 * match the term (via `$geoWithin` over the warehouse radius), then min-max
 * normalizes. Used as the fallback for arbitrary (non-demo) search terms.
 */
const geoDemandByWarehouse = async (term, radiusKm = 60, warehouses = null) => {
  warehouses = warehouses || (await Warehouse.find({}).sort({ code: 1 }).lean());
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

  return normalizeRows(counts);
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
  peerBuyersByWarehouse,
  getPopulatorConfig,
  savePopulatorConfig,
  addPopulatorTag,
  removePopulatorTag,
  notifyMatches,
};
