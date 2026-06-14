const mongoose = require('mongoose');
const PeerOffer = require('./peerOffer.model');
const { PEER } = require('../routing/routing.config');
const ItemLogger = require('../../utils/itemLogger');

/**
 * peer.service.js — Phase 8, Part E: peer-to-peer redistribution.
 *
 * When routing picks `peer-redistribute` with real nearby demand, we hand the
 * returned item straight from the customer's home to a buyer who already wants
 * it — one short hop, no warehouse. The first buyer to CLAIM reserves it (atomic),
 * then has a short window to pay; the purchase reuses the resale mirror Product.
 *
 * Lazy expiry (no scheduler): every read lapses stale reservations and triggers
 * the warehouse fallback for fully-expired windows.
 */

const TRUSTED_FOR_PEER = new Set(['verified', 'trusted', 'standard']);

/**
 * Is the returner trust-eligible for peer-redistribute? (§11.9)
 * Restricted/watch returners skip peer and go to a warehouse (physical re-grade).
 */
const isPeerEligible = (tier) => !tier || TRUSTED_FOR_PEER.has(tier);

/**
 * Create PeerOffers for the top-N matched buyers when an item is peer-routed.
 * Idempotent: skips if offers already exist for this item.
 *
 * @param {object} args { item, decision, posts, listing }
 * @returns {Promise<PeerOffer[]>}
 */
const createPeerOffers = async ({ item, decision, posts = [], listing = null }) => {
  if (!item?._id || !Array.isArray(posts) || posts.length === 0) return [];

  const existing = await PeerOffer.countDocuments({ itemId: item._id, status: { $in: ['offered', 'reserved', 'purchased'] } });
  if (existing > 0) return [];

  // Fetch the listing snapshot if not supplied (idempotent recompute path).
  if (!listing) {
    try {
      const ResaleListing = require('../resale/resale.model');
      listing = await ResaleListing.findOne({ itemId: item._id }).lean();
    } catch (_) { /* optional */ }
  }

  const expiresAt = decision?.matchWindow?.expiresAt || new Date(Date.now() + 48 * 3600 * 1000);
  const top = posts.slice(0, PEER.maxOffers);

  const offers = await Promise.all(
    top.map((post) =>
      PeerOffer.create({
        itemId: item._id,
        routingDecisionId: decision?._id || null,
        listingId: listing?._id || null,
        wantId: post._id || null,
        buyerUserId: post.userId,
        returnerUserId: item.initiatorUserId || null,
        sellerUserId: listing?.sellerId || null,
        category: listing?.category || item.category || null,
        title: listing?.title || item.category || 'Pre-owned item',
        images: listing?.images || [],
        grade: listing?.grade || null,
        conditionLane: listing?.conditionLane || null,
        price: listing?.price || listing?.suggestedPrice || 0,
        distanceKm: PEER.hopKm,
        status: 'offered',
        offeredAt: new Date(),
        expiresAt,
      })
    )
  );

  await ItemLogger.log(
    item._id,
    'PEER_OFFERS',
    `🤝 ${offers.length} peer offer(s) sent to nearby buyer(s) — first to claim wins (window closes ${new Date(expiresAt).toLocaleString()}).`,
    { count: offers.length }
  );

  return offers;
};

/**
 * Lazily lapse reservations past reservedUntil and expire offers past the
 * first-dibs window. Returns ids of items whose window fully expired with no
 * purchase (caller may trigger the warehouse fallback).
 */
const expireStaleOffers = async () => {
  const now = new Date();

  // Lapse reservations whose pay-by window passed → back to 'offered' (if window open) else 'expired'.
  const lapsed = await PeerOffer.find({ status: 'reserved', reservedUntil: { $lt: now } }).lean();
  for (const offer of lapsed) {
    const windowOpen = offer.expiresAt && offer.expiresAt > now;
    await PeerOffer.updateOne(
      { _id: offer._id, status: 'reserved' },
      windowOpen
        ? { $set: { status: 'offered' }, $unset: { reservedAt: '', reservedUntil: '' } }
        : { $set: { status: 'expired' } }
    );
    // Release the listing reservation.
    if (windowOpen) {
      try {
        const ResaleListing = require('../resale/resale.model');
        await ResaleListing.findOneAndUpdate(
          { itemId: offer.itemId, status: 'RESERVED' },
          { $set: { status: 'DRAFT', reservedForUserId: null, reservedUntil: null } }
        );
      } catch (_) { /* optional */ }
    }
  }

  // Expire whole windows with no purchase.
  await PeerOffer.updateMany(
    { status: 'offered', expiresAt: { $lt: now } },
    { $set: { status: 'expired' } }
  );

  // Items whose every offer is now expired and none purchased → fallback candidates.
  const expiredItems = await PeerOffer.aggregate([
    { $match: { expiresAt: { $lt: now } } },
    { $group: { _id: '$itemId', statuses: { $addToSet: '$status' } } },
    { $match: { statuses: { $nin: ['purchased', 'reserved', 'offered'] } } },
  ]);

  // Trigger the warehouse fallback (§11.3 [5b]) for each fully-expired window.
  if (expiredItems.length) {
    try {
      const routingService = require('../routing/routing.service');
      for (const e of expiredItems) {
        await routingService.fallbackToWarehouse(e._id).catch(() => {});
      }
    } catch (_) { /* routing optional */ }
  }

  return expiredItems.map((e) => e._id);
};

/**
 * Active offers for a buyer (the "Available near you" feed). Lazily expires first.
 */
const getOffersForBuyer = async (userId) => {
  if (!mongoose.isValidObjectId(userId)) return [];
  await expireStaleOffers().catch(() => {});
  return PeerOffer.find({
    buyerUserId: userId,
    status: { $in: ['offered', 'reserved', 'purchased'] },
  })
    .sort({ status: 1, offeredAt: -1 })
    .lean();
};

/**
 * Claim an offer (first-come reserve). Single atomic update — no locks.
 * @throws e.statusCode 409 when already reserved/expired.
 */
const claimOffer = async (offerId, buyerUserId) => {
  if (!mongoose.isValidObjectId(offerId)) { const e = new Error('Invalid offer'); e.statusCode = 400; throw e; }

  const offer = await PeerOffer.findOneAndUpdate(
    { _id: offerId, buyerUserId, status: 'offered', expiresAt: { $gt: new Date() } },
    {
      $set: {
        status: 'reserved',
        reservedAt: new Date(),
        reservedUntil: new Date(Date.now() + PEER.claimTtlMs),
      },
    },
    { new: true }
  );

  if (!offer) { const e = new Error('Already reserved or expired'); e.statusCode = 409; throw e; }

  // Close sibling offers for the same item.
  await PeerOffer.updateMany(
    { itemId: offer.itemId, _id: { $ne: offer._id }, status: 'offered' },
    { $set: { status: 'closed' } }
  );

  // Flip the listing to RESERVED for this buyer (hidden from storefront).
  try {
    const ResaleListing = require('../resale/resale.model');
    await ResaleListing.findOneAndUpdate(
      { itemId: offer.itemId },
      { $set: { status: 'RESERVED', reservedForUserId: buyerUserId, reservedUntil: offer.reservedUntil } }
    );
  } catch (_) { /* optional */ }

  await ItemLogger.log(offer.itemId, 'PEER_RESERVED', '🔒 Reserved by a nearby buyer — pay-by window started.', {});
  return offer.toObject();
};

/**
 * Purchase a reserved offer (prototype: reuses the resale mirror Product and
 * walks the item to SOLD; a full checkout integration can replace the body).
 * @throws e.statusCode 409 when not reserved by this buyer / lapsed.
 */
const purchaseOffer = async (offerId, buyerUserId) => {
  if (!mongoose.isValidObjectId(offerId)) { const e = new Error('Invalid offer'); e.statusCode = 400; throw e; }

  const offer = await PeerOffer.findOne({ _id: offerId, buyerUserId, status: 'reserved' });
  if (!offer) { const e = new Error('Offer is not reserved by you'); e.statusCode = 409; throw e; }
  if (offer.reservedUntil && offer.reservedUntil < new Date()) {
    const e = new Error('Reservation lapsed'); e.statusCode = 409; throw e;
  }

  const ResaleListing = require('../resale/resale.model');
  const Product = require('../products/product.model');
  const RoutingDecision = require('../routing/routing.model');
  const Item = require('../items/item.model');
  const itemService = require('../items/item.service');
  const shipment = require('../routing/routing.shipment');

  const listing = await ResaleListing.findOne({ itemId: offer.itemId });

  // Ensure a mirror Product exists (reuses the existing product/order surface).
  if (listing && !listing.marketplaceProductId) {
    const product = await Product.create({
      title: listing.title || 'Pre-owned item',
      description: listing.description || 'Certified pre-owned item (peer handoff).',
      price: listing.price || listing.suggestedPrice || 1,
      category: listing.category || 'general',
      images: listing.images || [],
      condition: 'Used',
      sellerId: listing.sellerId,
      status: 'approved',
    });
    listing.marketplaceProductId = product._id;
  }

  // Mark purchased.
  offer.status = 'purchased';
  offer.purchasedAt = new Date();
  await offer.save();

  if (listing) {
    listing.status = 'SOLD';
    listing.reservedForUserId = null;
    listing.reservedUntil = null;
    await listing.save();
  }

  // Start the peer-hop shipment so the seller dashboard animates the handoff.
  try {
    const decision = await RoutingDecision.findOne({ itemId: offer.itemId });
    if (decision) {
      if (!decision.shipment || !decision.shipment.startedAt) {
        const plan = shipment.buildShipmentPlan(decision.toObject(), 'Raipur');
        plan.status = 'in_transit';
        plan.startedAt = new Date();
        decision.shipment = plan;
        await decision.save();
      }
    }
  } catch (_) { /* optional */ }

  // Walk the item forward to SOLD (best-effort, defensive over the state machine).
  try {
    const item = await Item.findById(offer.itemId).lean();
    const actor = { userId: buyerUserId, role: 'system' };
    if (item) {
      if (item.status === 'ROUTED') {
        await itemService.transitionStatus(offer.itemId, 'IN_TRANSIT', actor, { reason: 'peer-purchase' });
        await itemService.transitionStatus(offer.itemId, 'LISTED', actor);
        await itemService.transitionStatus(offer.itemId, 'SOLD', actor);
      } else if (item.status === 'IN_TRANSIT') {
        await itemService.transitionStatus(offer.itemId, 'LISTED', actor);
        await itemService.transitionStatus(offer.itemId, 'SOLD', actor);
      } else if (item.status === 'LISTED') {
        await itemService.transitionStatus(offer.itemId, 'SOLD', actor);
      }
    }
  } catch (err) {
    console.warn(`[peer] item transition to SOLD skipped: ${err.message}`);
  }

  await ItemLogger.log(offer.itemId, 'PEER_PURCHASED', `✅ Peer purchase complete (₹${offer.price}). Handing off to the buyer.`, {});
  return offer.toObject();
};

module.exports = {
  isPeerEligible,
  createPeerOffers,
  expireStaleOffers,
  getOffersForBuyer,
  claimOffer,
  purchaseOffer,
};
