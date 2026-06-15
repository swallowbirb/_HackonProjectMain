const mongoose = require('mongoose');

/**
 * Ngo — donation recipient directory.
 *
 * Seeded for the demo cities. Matched to a donated item by category + proximity
 * using a `$geoNear` aggregation over the 2dsphere `location` index (same pattern
 * as the demand registry).
 */

const ngoSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    categoriesAccepted: { type: [String], default: [] }, // empty = accepts all
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [lng, lat]
    },
    pickupRadiusKm: { type: Number, default: 25 },
    contact: {
      phone: { type: String, default: '' },
      email: { type: String, default: '' },
      address: { type: String, default: '' },
    },
    city: { type: String, trim: true },
    active: { type: Boolean, default: true },
    // Tag for idempotent demo seeding (e.g. 'p8demo').
    seedTag: { type: String, default: null, index: true },
  },
  { timestamps: true }
);

ngoSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Ngo', ngoSchema);
