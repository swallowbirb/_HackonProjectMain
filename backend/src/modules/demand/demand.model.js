const mongoose = require('mongoose');

/**
 * Want Model — demand registry entry
 * TODO: Expected fields:
 *   - userId: ObjectId (ref: User)
 *   - productCategory: String
 *   - keywords: [String]
 *   - maxPrice: Number
 *   - condition: String (any | like-new | good | fair)
 *   - location: GeoJSON Point { type: 'Point', coordinates: [lng, lat] }
 *   - radiusKm: Number — how far user is willing to travel/receive from
 *   - notifyByEmail: Boolean
 *   - notifyByPush: Boolean
 *   - active: Boolean
 *   - expiresAt: Date
 *   - createdAt / updatedAt: Date
 */

const wantSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    productCategory: { type: String, required: true, trim: true, index: true },
    keywords: { type: [String], default: [] },
    maxPrice: { type: Number, min: 0 },
    condition: {
      type: String,
      enum: ['any', 'like-new', 'good', 'fair'],
      default: 'any',
    },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [lng, lat]
    },
    radiusKm: { type: Number, default: 25 },
    notifyByEmail: { type: Boolean, default: true },
    notifyByPush: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

// 2dsphere index for geo queries (also created in createIndexes.js)
wantSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Want', wantSchema);
