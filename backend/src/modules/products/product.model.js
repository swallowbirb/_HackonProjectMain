const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    category: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    images: {
      type: [String],
      default: [],
    },
    // Seller's free-text brand claim
    brandName: {
      type: String,
      trim: true,
    },
    // Optional link to a registered Brand document
    brandId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brand',
      default: null,
    },
    condition: {
      type: String,
      enum: ['New', 'Used'],
      default: 'New',
    },
    // v2.34 — seller-authored AI grading instructions for THIS product. Composed into
    // the grading prompts as the seller-custom overlay (base -> category -> seller).
    // Advisory: refines, never overrides, the platform rubric.
    gradingInstructions: {
      type: String,
      trim: true,
      default: '',
    },
    // v2.34 — seller-tagged catalog reference images by angle, used for the per-upload
    // same-angle perceptual-hash duplicate check. { front, side_left, side_right, rear }.
    imageAngles: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // v2.34 — per-image custom hints. Each entry instructs Pass-1 to generate a dedicated
    // form field for that specific catalog image when a buyer returns/resells the product.
    // Shape: [{ url, label, hint }] — label is the tag heading, hint is the AI-facing
    // description used to verify the buyer's photo on a return/refund.
    imageHints: {
      type: [{ url: { type: String }, label: { type: String }, hint: { type: String } }],
      default: [],
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
    // Sales metrics
    totalSales: {
      type: Number,
      default: 0,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'published', 'approved', 'flagged', 'rejected'],
      default: 'approved',
      index: true,
    },
    // Hard block — removed from all public views
    banned: {
      type: Boolean,
      default: false,
    },
    // Soft block — temporarily hidden, can be reinstated
    suspended: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

const Product = mongoose.model('Product', productSchema);

module.exports = Product;
