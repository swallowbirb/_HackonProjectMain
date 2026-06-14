const mongoose = require('mongoose');

/**
 * BrandCatalogEntry — the ASIN equivalent.
 * One entry = one unique product defined by the brand.
 * This is the AI ground truth: officialImages + description are the fingerprint
 * that Phase 4 will compare against seller-submitted counterfeit listings.
 */
const brandCatalogEntrySchema = new mongoose.Schema(
  {
    // The brand that owns this entry — only they can edit it
    brandId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brand',
      required: true,
      index: true,
    },
    // Human-readable unique identifier per brand (e.g. "AIR-MAX-97-WHT-10M")
    sku: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    // Official product title — the authoritative source of truth
    title: {
      type: String,
      required: true,
      trim: true,
    },
    // Official long-form description
    description: {
      type: String,
      required: true,
      trim: true,
    },
    // Official bullet points — max 5, like Amazon A+ content
    bulletPoints: {
      type: [String],
      default: [],
      validate: {
        validator: (arr) => arr.length <= 5,
        message: 'A catalog entry can have at most 5 bullet points',
      },
    },
    // Official brand images — hero image first, then gallery
    // AI Hook (Phase 4): image similarity between these and seller product images → counterfeit detection
    officialImages: {
      type: [String],
      default: [],
    },
    // Product category for search/filtering
    category: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    // Searchable tags (e.g. ["running", "white", "men"])
    tags: {
      type: [String],
      default: [],
    },
    // Soft-delete: false = removed from public view, still in DB for AI reference
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    // Denormalized: count of active SellerOffers on this entry
    activeOfferCount: {
      type: Number,
      default: 0,
    },
    // Denormalized review stats
    averageRating: {
      type: Number,
      default: 0,
    },
    reviewCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// Compound unique index: SKU must be unique per brand
brandCatalogEntrySchema.index({ brandId: 1, sku: 1 }, { unique: true });

const BrandCatalogEntry = mongoose.model('BrandCatalogEntry', brandCatalogEntrySchema);

module.exports = BrandCatalogEntry;
