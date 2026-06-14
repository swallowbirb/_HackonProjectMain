const mongoose = require('mongoose');

/**
 * SellerOffer — the Amazon 3P offer model.
 * Separates "offer data" (seller-controlled) from "catalog data" (brand-controlled).
 * Many sellers can have competing offers on the same BrandCatalogEntry.
 * The isBuyBoxWinner flag is recomputed on every offer create/update/delete.
 *
 * AI Hooks (Phase 4):
 *   - Multiple offers with identical pricing patterns → coordinated manipulation
 *   - Offer price drastically below average → bait-and-switch counterfeit signal
 */
const sellerOfferSchema = new mongoose.Schema(
  {
    // The catalog entry this offer competes on
    catalogEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BrandCatalogEntry',
      required: true,
      index: true,
    },
    // The seller making this offer
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Seller-set price — the Buy Box competes on this
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    // Item condition — determines eligibility & consumer trust
    condition: {
      type: String,
      enum: ['New', 'Used', 'Refurbished'],
      default: 'New',
    },
    // Available stock (default 1 for simulation simplicity)
    quantity: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },
    // Lifecycle: active = visible; inactive = seller pulled it; flagged = AI/admin flagged
    status: {
      type: String,
      enum: ['active', 'inactive', 'flagged'],
      default: 'active',
      index: true,
    },
    // Optional shipping note displayed to buyers (e.g. "Ships within 2 days")
    shippingNote: {
      type: String,
      trim: true,
      default: '',
    },
    // Computed: true if this offer has the lowest price among active offers on the same entry
    // Recomputed by recomputeBuyBox() on every create/update/delete
    isBuyBoxWinner: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

// A seller can only have one offer per catalog entry
sellerOfferSchema.index({ catalogEntryId: 1, sellerId: 1 }, { unique: true });

const SellerOffer = mongoose.model('SellerOffer', sellerOfferSchema);

module.exports = SellerOffer;
