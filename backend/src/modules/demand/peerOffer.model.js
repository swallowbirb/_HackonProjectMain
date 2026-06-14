const mongoose = require('mongoose');

/**
 * PeerOffer — Phase 8, Part E.
 *
 * When routing picks `peer-redistribute` and there are real nearby buyers
 * (matched Want posts), we create one PeerOffer per top-N buyer. The first buyer
 * to CLAIM reserves the item (atomic), then has `reservedUntil` to pay. The
 * winning purchase reuses the resale mirror Product / order flow.
 *
 * Lightweight + append-only-ish. A TTL index on `expiresAt` auto-cleans stale
 * docs. Lazy expiry (no scheduler) lapses reservations + triggers the warehouse
 * fallback on read.
 */
const peerOfferSchema = new mongoose.Schema(
  {
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true, index: true },
    routingDecisionId: { type: mongoose.Schema.Types.ObjectId, ref: 'RoutingDecision', default: null },
    listingId: { type: mongoose.Schema.Types.ObjectId, ref: 'ResaleListing', default: null },

    wantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Want', default: null },
    buyerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    returnerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    sellerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Snapshot for the buyer-facing card.
    category: { type: String },
    title: { type: String },
    images: { type: [String], default: [] },
    grade: { type: String },
    conditionLane: { type: String },
    price: { type: Number, default: 0 },
    distanceKm: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ['offered', 'reserved', 'purchased', 'closed', 'expired'],
      default: 'offered',
      index: true,
    },

    offeredAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null },     // = matchWindow.expiresAt (first-dibs window)
    reservedAt: { type: Date, default: null },
    reservedUntil: { type: Date, default: null },  // = reservedAt + CLAIM_TTL (pay-by)
    purchasedAt: { type: Date, default: null },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  },
  { timestamps: true }
);

peerOfferSchema.index({ buyerUserId: 1, status: 1 });
peerOfferSchema.index({ itemId: 1, status: 1 });
// TTL: clean up docs a day after the first-dibs window closes.
peerOfferSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('PeerOffer', peerOfferSchema);
