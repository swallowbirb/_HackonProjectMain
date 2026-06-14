const mongoose = require('mongoose');

const brandSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    // The 'brand' role user who owns this registration
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    description: {
      type: String,
      trim: true,
    },
    logoUrl: {
      type: String,
    },
    // Keywords for External Trend Shield + counterfeit detection
    protectedKeywords: {
      type: [String],
      default: [],
    },
    // Primary category for brand-product matching
    category: {
      type: String,
      trim: true,
    },
    // Auto-true for hackathon — would be admin-verified in production
    isVerified: {
      type: Boolean,
      default: true,
    },
    // Denormalized: incremented/decremented as catalog entries are created/deleted
    catalogEntryCount: {
      type: Number,
      default: 0,
    },
    // Optional brand website for verification/display purposes
    website: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

const Brand = mongoose.model('Brand', brandSchema);

module.exports = Brand;
