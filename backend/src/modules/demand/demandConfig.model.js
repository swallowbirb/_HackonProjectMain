const mongoose = require('mongoose');

/**
 * DemandConfig — singleton override for the Admin Demand Map populator tool.
 *
 * Stores the per-tag "peak population" (the count for the busiest city) for both
 * the Search Demand and Peer Buyers views. The map endpoints read this and shape
 * it across cities using the built-in per-city weights. When absent, the service
 * falls back to its built-in defaults, so a fresh DB still renders the demo.
 *
 * One document, keyed `singleton`.
 */
const demandConfigSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: 'singleton' },
    customTags: { type: [String], default: [] },               // admin-created tags
    demand: { type: mongoose.Schema.Types.Mixed, default: {} }, // { [tag]: peakCount }
    peers: { type: mongoose.Schema.Types.Mixed, default: {} },  // { [tag]: peakCount }
  },
  { timestamps: true }
);

module.exports = mongoose.model('DemandConfig', demandConfigSchema);
