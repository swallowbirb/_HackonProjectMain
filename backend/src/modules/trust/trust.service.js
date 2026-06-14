/**
 * trust.service.js — DB I/O + orchestration for the Trust module.
 *
 * Reads (read-only): users, orders, returns, grades.
 * Writes: ONLY the trustProfiles collection.
 *
 * Pure scoring math lives in trust.scoring.js. This file gathers raw facts from the
 * DB, hands them to assembleProfile(), and persists the result.
 *
 * Frozen interface for P1/P4: getTrustProfile(userId) -> { tier, score, ... } | null.
 */

const TrustProfile = require('./trust.model');
const User = require('../users/user.model');
const Order = require('../orders/order.model');
const Return = require('../returns/return.model');
const { RETURN_RATE_THRESHOLDS } = require('../../contracts/trustProfile.contract');
const { assembleProfile, SCORING } = require('./trust.scoring');

// P2's grading model — require defensively so Phase 3 never crashes if it's absent.
let Grade = null;
try {
  Grade = require('../grading/grading.model');
} catch (_) {
  Grade = null;
}

const DAY_MS = 86400000;
const HARD_SIGNALS = ['REVERSE_IMAGE_HIT', 'LOCKER_WEIGHT_MISMATCH', 'PHOTO_OF_SCREEN'];

// ── Pattern detectors ───────────────────────────────────────────────────────

/**
 * detectBracketing — buys the same product multiple times, returns all but (at most) one.
 * Hackathon approximation: real size/colour variants aren't modelled, so we proxy
 * "bought 4 sizes" with "bought same productId multiple times".
 */
async function detectBracketing(userId) {
  const orders = await Order.find({ buyerId: userId, status: 'completed' })
    .select('_id productId')
    .lean();
  if (orders.length < RETURN_RATE_THRESHOLDS.BRACKETING_MIN_ORDERS) return false;

  const byProduct = new Map();
  for (const o of orders) {
    if (!o.productId) continue;
    const key = String(o.productId);
    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key).push(o._id);
  }

  for (const [, orderIds] of byProduct) {
    if (orderIds.length < RETURN_RATE_THRESHOLDS.BRACKETING_SAME_PRODUCT_COUNT) continue;
    const returnsForGroup = await Return.countDocuments({
      userId,
      orderId: { $in: orderIds },
    });
    if (returnsForGroup >= orderIds.length - 1) return true; // kept <=1, returned the rest
  }
  return false;
}

/**
 * detectWardrobing — buy → use → return near the end of the return window, repeatedly.
 * We proxy "used it" with "held it ~the full window before returning", median >= ~25 of 30.
 */
async function detectWardrobing(userId) {
  const returns = await Return.find({ userId }).select('orderId createdAt').lean();
  if (returns.length < 2) return false;

  const orderIds = returns.map((r) => r.orderId).filter(Boolean);
  const orders = await Order.find({ _id: { $in: orderIds } }).select('_id createdAt').lean();
  const orderById = new Map(orders.map((o) => [String(o._id), o]));

  const daysHeldList = [];
  for (const ret of returns) {
    const order = orderById.get(String(ret.orderId));
    if (order) {
      daysHeldList.push((new Date(ret.createdAt) - new Date(order.createdAt)) / DAY_MS);
    }
  }
  if (daysHeldList.length < 2) return false;

  const median = computeMedian(daysHeldList);
  return median >= RETURN_RATE_THRESHOLDS.WARDROBE_DAYS_WINDOW - 5; // >= ~25 of a 30-day window
}

function computeMedian(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * readFraudSignals — counts hard/soft fraud hits from P2's grades + our manual signals.
 *
 * Grade docs carry itemId (not userId), so we resolve the user's items via their returns
 * (returns.itemId, read-only) and match grades by itemId. Returns zeros gracefully if the
 * grading model isn't merged yet or no link exists.
 */
async function readFraudSignals(userId) {
  let hardFraudHits = 0;
  let softFraudHits = 0;

  if (Grade) {
    try {
      const returns = await Return.find({ userId }).select('itemId').lean();
      const itemIds = returns.map((r) => r.itemId).filter(Boolean);
      if (itemIds.length) {
        const grades = await Grade.find({ itemId: { $in: itemIds } }).select('fraudCheck').lean();
        for (const g of grades) {
          const fc = g && g.fraudCheck;
          if (!fc) continue;
          if (fc.phash_match === true) hardFraudHits++;
          if (fc.rekognition_web_match === true) hardFraudHits++;
          if (fc.classification === 'hard_fraud') hardFraudHits++;
          if (fc.exif_has_camera_data === false) softFraudHits++;
          if (fc.classification === 'soft_fraud') softFraudHits++;
        }
      }
    } catch (_) {
      // grading not ready — fall through with zeros from grades
    }
  }

  // Manual signals stored on our own TrustProfile doc.
  const profile = await TrustProfile.findOne({ userId }).select('manualFraudSignals').lean();
  for (const s of (profile && profile.manualFraudSignals) || []) {
    if (HARD_SIGNALS.includes(s.signal)) hardFraudHits++;
    else softFraudHits++;
  }

  return { hardFraudHits, softFraudHits };
}

// ── Fact gathering ──────────────────────────────────────────────────────────

async function gatherFacts(userId) {
  const user = await User.findById(userId).lean();
  if (!user) return null;

  const now = Date.now();
  const accountAgeDays = Math.floor((now - new Date(user.createdAt).getTime()) / DAY_MS);
  const since90 = new Date(now - 90 * DAY_MS);

  const [lifetimePurchases, lifetimeReturns, purchases90, returns90] = await Promise.all([
    Order.countDocuments({ buyerId: userId, status: 'completed' }),
    Return.countDocuments({ userId }),
    Order.countDocuments({ buyerId: userId, status: 'completed', createdAt: { $gte: since90 } }),
    Return.countDocuments({ userId, createdAt: { $gte: since90 } }),
  ]);

  const returnRate = lifetimePurchases > 0 ? lifetimeReturns / lifetimePurchases : 0;
  const recentReturnRate90d = purchases90 > 0 ? returns90 / purchases90 : 0;

  const [bracketingFlag, wardrobingFlag, fraud] = await Promise.all([
    detectBracketing(userId),
    detectWardrobing(userId),
    readFraudSignals(userId),
  ]);

  return {
    accountAgeDays,
    lifetimePurchases,
    lifetimeReturns,
    returnRate,
    recentReturnRate90d,
    bracketingFlag,
    wardrobingFlag,
    banned: !!user.banned,
    hardFraudHits: fraud.hardFraudHits,
    softFraudHits: fraud.softFraudHits,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * computeTrustProfile — gather facts, run pure scoring, upsert the TrustProfile doc.
 */
async function computeTrustProfile(userId) {
  const facts = await gatherFacts(userId);
  if (!facts) return null;

  const profile = assembleProfile(facts);

  const doc = await TrustProfile.findOneAndUpdate(
    { userId },
    {
      userId,
      tier: profile.tier,
      score: profile.score,
      signals: profile.signals,
      accountAge: facts.accountAgeDays,
      lifetimePurchases: facts.lifetimePurchases,
      lifetimeReturns: facts.lifetimeReturns,
      returnRate: facts.returnRate,
      recentReturnRate90d: facts.recentReturnRate90d,
      bracketingFlag: facts.bracketingFlag,
      wardrobingFlag: facts.wardrobingFlag,
      lastComputed: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  return doc;
}

/**
 * getTrustProfile — P1/P4 frozen interface. Returns cached profile, recomputing if stale.
 * Returns null if the user doesn't exist.
 */
async function getTrustProfile(userId) {
  const existing = await TrustProfile.findOne({ userId }).lean();
  const ttlMs = SCORING.STALE_TTL_HOURS * 3600 * 1000;
  const isStale =
    !existing ||
    !existing.lastComputed ||
    Date.now() - new Date(existing.lastComputed).getTime() > ttlMs;

  if (isStale) {
    return computeTrustProfile(userId); // null if user not found
  }
  return existing;
}

/**
 * addFraudSignal — append a manual fraud signal, then recompute so it influences the tier.
 */
async function addFraudSignal(userId, signal, value, direction) {
  let profile = await TrustProfile.findOne({ userId });
  if (!profile) {
    await computeTrustProfile(userId);
    profile = await TrustProfile.findOne({ userId });
  }
  if (!profile) return null;

  profile.manualFraudSignals.push({
    signal,
    value,
    direction: direction || 'negative',
    addedAt: new Date(),
  });
  await profile.save();

  // Re-run full compute so the new signal flows through readFraudSignals -> scoring.
  return computeTrustProfile(userId);
}

/**
 * listFlaggedProfiles — paginated list of flagged users (watch + restricted by default).
 */
async function listFlaggedProfiles({ tier, page = 1, limit = 20 } = {}) {
  const filter = tier ? { tier } : { tier: { $in: ['watch', 'restricted'] } };
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.max(1, Number(limit) || 20);

  const [items, total] = await Promise.all([
    TrustProfile.find(filter)
      .sort({ score: 1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    TrustProfile.countDocuments(filter),
  ]);

  return {
    items,
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.ceil(total / safeLimit),
  };
}

module.exports = {
  getTrustProfile,
  computeTrustProfile,
  addFraudSignal,
  listFlaggedProfiles,
  // exported for testing / reuse
  gatherFacts,
  detectBracketing,
  detectWardrobing,
  readFraudSignals,
};
