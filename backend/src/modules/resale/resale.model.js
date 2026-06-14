const mongoose = require('mongoose');
const { RESALE_STATUSES } = require('../../contracts/resaleListing.contract');

/**
 * ResaleListing — a second-life marketplace listing backed by an AI grade.
 *
 * This is its OWN collection; it never mutates the marketplace `Product` model.
 * One listing per item (itemId unique). Created as a DRAFT from a routing
 * decision, then published by the seller. On publish a lightweight mirror
 * `Product` is created so buyers can purchase through the existing order flow
 * (referenced via `marketplaceProductId`).
 */

const defectSchema = new mongoose.Schema(
  {
    type: String,
    severity: { type: String, enum: ['minor', 'moderate', 'major'] },
    location: String,
    description: String,
  },
  { _id: false }
);

const resaleListingSchema = new mongoose.Schema(
  {
    // 1:1 with the shared Item.
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true, unique: true, index: true },
    gradeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Grade', default: null },
    routingDecisionId: { type: mongoose.Schema.Types.ObjectId, ref: 'RoutingDecision', default: null },

    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    intakePath: { type: String, enum: ['return', 'sell-used'] },

    // Listing copy (deterministic from grade + product data).
    title: { type: String, trim: true },
    description: { type: String, trim: true },
    category: { type: String, trim: true, index: true },
    images: { type: [String], default: [] },

    // Pricing.
    originalPrice: { type: Number, min: 0, default: 0 },
    suggestedPrice: { type: Number, min: 0, default: 0 }, // immutable suggestion
    price: { type: Number, min: 0, default: 0 },          // live price, seller-editable

    // Condition story (grade snapshot).
    conditionLane: { type: String, enum: ['like-new', 'good', 'fair'], index: true },
    grade: { type: String, enum: ['A', 'B', 'C', 'D'] },
    qualityScore: { type: Number, min: 0, max: 100 },
    gradeRationale: { type: String },
    defects: { type: [defectSchema], default: [] },

    // Free-text notes added by the previous owner after grading.
    previousOwnerNotes: { type: String, trim: true, default: '' },

    // Geo-demand signal at draft time (from Phase A; 0 if unavailable).
    demandCount: { type: Number, default: 0 },

    healthCardId: { type: mongoose.Schema.Types.ObjectId, ref: 'HealthCard', default: null },

    status: { type: String, enum: RESALE_STATUSES, default: 'DRAFT', index: true },
    peerRedistribute: { type: Boolean, default: false },

    // Mirror Product created on publish so buyers reuse the existing order flow.
    marketplaceProductId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  },
  { timestamps: true }
);

resaleListingSchema.index({ status: 1, createdAt: -1 });
resaleListingSchema.index({ sellerId: 1, createdAt: -1 });

module.exports = mongoose.model('ResaleListing', resaleListingSchema);
