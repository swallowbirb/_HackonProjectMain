const mongoose = require('mongoose');

/**
 * Warehouse Model — the Chhattisgarh demo distribution centres.
 * Seeded idempotently by seed-demand.js from routing.config.WAREHOUSES.
 * Shape frozen in contracts/demand.contract.js.
 */
const warehouseSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    city: { type: String, required: true },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [lng, lat]
    },
    capacity: { type: Number, default: 0 },
    categories: { type: [String], default: [] },
  },
  { timestamps: true }
);

warehouseSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Warehouse', warehouseSchema);
