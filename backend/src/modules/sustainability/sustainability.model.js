const mongoose = require('mongoose');

/**
 * SustainabilityImpact Model — CO2/water savings per item
 * TODO: Expected fields:
 *   - itemId: ObjectId
 *   - userId: ObjectId (ref: User) — the buyer/beneficiary
 *   - category: String
 *   - co2SavedKg: Number — from category factor table
 *   - waterSavedLiters: Number — from category factor table
 *   - greenCreditsEarned: Number
 *   - eventType: String (sale | donation | repair)
 *   - createdAt: Date
 */

const sustainabilitySchema = new mongoose.Schema(
  {
    itemId: { type: mongoose.Schema.Types.ObjectId, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    category: { type: String },
    co2SavedKg: { type: Number, min: 0, default: 0 },
    waterSavedLiters: { type: Number, min: 0, default: 0 },
    greenCreditsEarned: { type: Number, min: 0, default: 0 },
    eventType: {
      type: String,
      enum: ['sale', 'donation', 'repair', 'resell'],
      default: 'resell',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SustainabilityImpact', sustainabilitySchema);
