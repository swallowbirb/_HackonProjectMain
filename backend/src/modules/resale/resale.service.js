const mongoose = require('mongoose');
const ResaleListing = require('./resale.model');
const Item = require('../items/item.model');
const Product = require('../products/product.model');
const itemService = require('../items/item.service');
const ItemLogger = require('../../utils/itemLogger');
const {
  RESALE_TRIGGER_PATHS,
  GRADE_TO_CONDITION_LANE,
  computeSuggestedPrice,
} = require('../../contracts/resaleListing.contract');

/**
 * Resolve the selling user for a listing.
 *   sell-used → the item initiator (they own the item)
 *   return    → the original product seller, else platform (admin), else initiator
 */
const resolveSellerId = async (item) => {
  if (item.intakePath === 'sell-used') return item.initiatorUserId;

  // return path
  if (item.originalProductId) {
    const product = await Product.findById(item.originalProductId).select('sellerId').lean();
    if (product?.sellerId) return product.sellerId;
  }

  // platform fallback — first admin user
  try {
    const User = require('../users/user.model');
    const admin = await User.findOne({ role: 'admin' }).select('_id').lean();
    if (admin?._id) return admin._id;
  } catch (_) {
    /* user model optional */
  }

  return item.initiatorUserId;
};

/**
 * Deterministic listing title from grade + product data.
 */
const buildTitle = (productTitle, category, grade) => {
  const lane = GRADE_TO_CONDITION_LANE[grade] || 'good';
  const laneLabel = { 'like-new': 'Like New', good: 'Good Condition', fair: 'Fair Condition' }[lane];
  const base = productTitle || category || 'Pre-owned item';
  return `${base} — Certified Pre-Owned (${laneLabel})`;
};

/**
 * Deterministic listing description from grade snapshot.
 */
const buildDescription = ({ productTitle, category, grade, qualityScore, defects, rationale }) => {
  const lane = GRADE_TO_CONDITION_LANE[grade] || 'good';
  const name = productTitle || category || 'This item';
  const lines = [];
  lines.push(
    `${name} has been AI-graded and certified as Grade ${grade} (${lane.replace('-', ' ')}), ` +
      `scoring ${qualityScore ?? '—'}/100 on our objective condition assessment.`
  );
  if (Array.isArray(defects) && defects.length > 0) {
    const defectText = defects
      .map((d) => `${d.severity} ${d.type}${d.location ? ` (${d.location})` : ''}`)
      .join('; ');
    lines.push(`Noted condition details: ${defectText}.`);
  } else {
    lines.push('No significant defects were detected during grading.');
  }
  if (rationale) lines.push(`Grader's assessment: ${rationale}`);
  lines.push('Backed by a full AI grade report and condition history — buy second-life with confidence.');
  return lines.join('\n\n');
};

/**
 * Pick listing photos: prefer the grade evidence bundle, fall back to item evidence.
 */
const selectImages = (grade, item) => {
  const fromBundle = grade?.evidenceBundle?.imageUrls;
  if (Array.isArray(fromBundle) && fromBundle.length > 0) return fromBundle.slice(0, 8);
  if (Array.isArray(item?.evidencePhotos) && item.evidencePhotos.length > 0) {
    return item.evidencePhotos.slice(0, 8);
  }
  return [];
};

/**
 * SEAM (called by Phase A via safeCreateResaleDraft).
 * Create a DRAFT ResaleListing from a routing decision. Idempotent per itemId.
 * No-ops (returns null) for non-resell paths so the handoff degrades gracefully.
 *
 * @param {{ itemId, routingDecision, grade }} args
 * @returns {Promise<ResaleListing|null>}
 */
const createDraftFromRouting = async ({ itemId, routingDecision, grade }) => {
  if (!itemId || !mongoose.isValidObjectId(itemId)) return null;

  const chosenPath = routingDecision?.chosenPath;
  if (!RESALE_TRIGGER_PATHS.includes(chosenPath)) {
    // Not a resell-class path — nothing to list.
    return null;
  }

  const item = await Item.findById(itemId).lean();
  if (!item) return null;

  // Resolve grade if not passed in.
  let gradeDoc = grade;
  if (!gradeDoc) {
    try {
      const gradingService = require('../grading/grading.service');
      gradeDoc = await gradingService.getGradeByItemId(itemId);
    } catch (_) {
      gradeDoc = null;
    }
  }
  if (!gradeDoc) return null;

  // Idempotent: return the existing draft/listing if one exists.
  const existing = await ResaleListing.findOne({ itemId });
  if (existing) return existing;

  const sellerId = await resolveSellerId(item);

  // Reference price: original product price, else order total, else 0.
  let originalPrice = 0;
  if (item.originalProductId) {
    const product = await Product.findById(item.originalProductId).select('title price category').lean();
    originalPrice = product?.price || 0;
    item.__productTitle = product?.title;
    item.__productCategory = product?.category;
  }
  if (!originalPrice && item.secondhandId) {
    try {
      const Secondhand = require('../secondhand/secondhand.model');
      const sh = await Secondhand.findById(item.secondhandId).select('orderTotal askingPrice productTitle productCategory').lean();
      originalPrice = sh?.askingPrice || sh?.orderTotal || 0;
      item.__productTitle = item.__productTitle || sh?.productTitle;
      item.__productCategory = item.__productCategory || sh?.productCategory;
    } catch (_) {
      /* optional */
    }
  }

  const demandCount = Number(routingDecision?.demandSignal?.count) || 0;
  const category = item.category || item.__productCategory || 'general';
  const productTitle = item.__productTitle;

  const suggestedPrice = computeSuggestedPrice(originalPrice, gradeDoc.estimatedResalePct, demandCount);
  const conditionLane = GRADE_TO_CONDITION_LANE[gradeDoc.grade] || 'fair';

  const listing = await ResaleListing.create({
    itemId,
    gradeId: gradeDoc._id || item.gradeId || null,
    routingDecisionId: routingDecision?._id || item.routingDecisionId || null,
    sellerId,
    intakePath: item.intakePath,
    title: buildTitle(productTitle, category, gradeDoc.grade),
    description: buildDescription({
      productTitle,
      category,
      grade: gradeDoc.grade,
      qualityScore: gradeDoc.qualityScore,
      defects: gradeDoc.defects,
      rationale: gradeDoc.rationale,
    }),
    category,
    images: selectImages(gradeDoc, item),
    originalPrice,
    suggestedPrice,
    price: suggestedPrice,
    conditionLane,
    grade: gradeDoc.grade,
    qualityScore: gradeDoc.qualityScore,
    gradeRationale: gradeDoc.rationale,
    defects: gradeDoc.defects || [],
    previousOwnerNotes: item.ownerNotes || '',
    demandCount,
    status: 'DRAFT',
    peerRedistribute: chosenPath === 'peer-redistribute',
  });

  await ItemLogger.log(
    itemId,
    'RESALE_DRAFT',
    `🏷️ Resale draft created — Grade ${gradeDoc.grade}, suggested ₹${suggestedPrice} (demand: ${demandCount})`,
    { listingId: String(listing._id), suggestedPrice, demandCount, conditionLane }
  );

  return listing;
};

/**
 * Publish a DRAFT listing: create the mirror Product, flip to PUBLISHED, and
 * walk the item ROUTED → IN_TRANSIT → LISTED. Seller/admin only.
 */
const publish = async (listingId, user) => {
  const listing = await ResaleListing.findById(listingId);
  if (!listing) throw new Error('Listing not found');
  assertSellerOrAdmin(listing, user);

  if (listing.status === 'PUBLISHED') return listing;
  if (listing.status === 'SOLD') throw new Error('Listing already sold');

  // Create the mirror Product so the existing order flow works unchanged.
  let productId = listing.marketplaceProductId;
  if (!productId) {
    const product = await Product.create({
      title: listing.title || 'Pre-owned item',
      description: listing.description || 'Certified pre-owned item.',
      price: listing.price || listing.suggestedPrice || 1,
      category: listing.category || 'general',
      images: listing.images || [],
      condition: 'Used',
      sellerId: listing.sellerId,
      status: 'approved',
    });
    productId = product._id;
    listing.marketplaceProductId = productId;
  }

  listing.status = 'PUBLISHED';
  await listing.save();

  // Walk the item state machine forward (best-effort — seeded items may not be ROUTED).
  try {
    const item = await Item.findById(listing.itemId);
    if (item) {
      if (item.status === 'ROUTED') {
        await itemService.transitionStatus(listing.itemId, 'IN_TRANSIT', { userId: user?._id || null, role: 'system' });
        await itemService.transitionStatus(listing.itemId, 'LISTED', { userId: user?._id || null, role: 'system' });
      } else if (item.status === 'IN_TRANSIT') {
        await itemService.transitionStatus(listing.itemId, 'LISTED', { userId: user?._id || null, role: 'system' });
      }
      await Item.findByIdAndUpdate(listing.itemId, { listingId: productId });
    }
  } catch (err) {
    console.warn(`[resale] item transition on publish skipped: ${err.message}`);
  }

  // Ping nearby matching buyers (Phase A feature — defensive).
  try {
    const demandService = require('../demand/demand.service');
    if (typeof demandService.notifyMatches === 'function') {
      await demandService.notifyMatches(listing._id);
    }
  } catch (_) {
    /* Phase A not merged — non-fatal */
  }

  await ItemLogger.log(listing.itemId, 'RESALE_PUBLISHED', `📢 Resale listing published at ₹${listing.price}`, {
    listingId: String(listing._id),
    marketplaceProductId: String(productId),
  });

  return listing;
};

/**
 * Unlist a published listing (hide it from the storefront). Seller/admin only.
 */
const unlist = async (listingId, user) => {
  const listing = await ResaleListing.findById(listingId);
  if (!listing) throw new Error('Listing not found');
  assertSellerOrAdmin(listing, user);

  if (listing.status === 'SOLD') throw new Error('Listing already sold');

  listing.status = 'UNLISTED';
  await listing.save();

  // Hide the mirror product from purchase, too.
  if (listing.marketplaceProductId) {
    await Product.findByIdAndUpdate(listing.marketplaceProductId, { suspended: true });
  }
  return listing;
};

/**
 * Update the live price (keeps the immutable suggestedPrice). Seller/admin only.
 */
const updatePrice = async (listingId, price, user) => {
  const listing = await ResaleListing.findById(listingId);
  if (!listing) throw new Error('Listing not found');
  assertSellerOrAdmin(listing, user);

  const newPrice = Number(price);
  if (!Number.isFinite(newPrice) || newPrice < 0) throw new Error('Invalid price');

  listing.price = Math.round(newPrice);
  await listing.save();

  // Keep the mirror product price in sync.
  if (listing.marketplaceProductId) {
    await Product.findByIdAndUpdate(listing.marketplaceProductId, { price: listing.price });
  }
  return listing;
};

/**
 * Public listing detail (snapshots are self-contained).
 */
const getPublicListing = async (id) => {
  if (!mongoose.isValidObjectId(id)) return null;
  return ResaleListing.findById(id).lean();
};

/**
 * Paginated published storefront with optional category / condition-lane filter.
 */
const getStorefront = async ({ category, conditionLane, page = 1, limit = 20 } = {}) => {
  const filter = { status: 'PUBLISHED' };
  if (category) filter.category = category;
  if (conditionLane) filter.conditionLane = conditionLane;

  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.max(1, Math.min(60, Number(limit) || 20));

  const [listings, total] = await Promise.all([
    ResaleListing.find(filter)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    ResaleListing.countDocuments(filter),
  ]);

  return { listings, total, page: safePage, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) };
};

/**
 * All listings belonging to a seller (any status) — for the seller dashboard.
 */
const getSellerListings = async (sellerId) => {
  if (!mongoose.isValidObjectId(sellerId)) return [];
  return ResaleListing.find({ sellerId }).sort({ createdAt: -1 }).lean();
};

// ── helpers ──────────────────────────────────────────────────────────────────

function assertSellerOrAdmin(listing, user) {
  if (!user) throw new Error('Forbidden');
  if (user.role === 'admin') return;
  if (listing.sellerId?.toString() === user._id?.toString()) return;
  throw new Error('Forbidden');
}

module.exports = {
  createDraftFromRouting,
  publish,
  unlist,
  updatePrice,
  getPublicListing,
  getStorefront,
  getSellerListings,
};
