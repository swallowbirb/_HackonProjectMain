const mongoose = require('mongoose');

/**
 * Links sellers to brands.
 * Brand owners can see enrolled sellers' trust scores and products.
 * This is the authorization mechanism for brand-scoped visibility.
 */
const brandEnrollmentSchema = new mongoose.Schema(
  {
    brandId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brand',
      required: true,
      index: true,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    appliedAt: {
      type: Date,
      default: Date.now,
    },
    reviewedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

// One enrollment per seller per brand
brandEnrollmentSchema.index({ brandId: 1, sellerId: 1 }, { unique: true });

const BrandEnrollment = mongoose.model('BrandEnrollment', brandEnrollmentSchema);

module.exports = BrandEnrollment;
