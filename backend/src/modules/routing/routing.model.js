const mongoose = require('mongoose');

/**
 * RoutingDecision Model — stores the smart disposition engine output
 * TODO: Expected fields (see contracts/routingDecision.contract.js):
 *   - itemId: ObjectId
 *   - gradeId: ObjectId
 *   - trustProfileId: ObjectId
 *   - chosenPath: String (resell | refurbish | donate | liquidate | return-to-seller | peer-redistribute)
 *   - rankedAlternatives: [{ path, score, netRecovery, rationale }]
 *   - hardGatesApplied: [String]
 *   - reverseLogisticsCost: Number
 *   - demandSignal: { count, radiusKm }
 *   - createdAt: Date
 */

const alternativeSchema = new mongoose.Schema({
  path: String,
  score: Number,
  netRecovery: Number,
  rationale: String,
}, { _id: false });

const routingSchema = new mongoose.Schema(
  {
    itemId: { type: mongoose.Schema.Types.ObjectId, required: true },
    gradeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Grade' },
    trustProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'TrustProfile' },
    chosenPath: {
      type: String,
      enum: ['resell', 'refurbish', 'donate', 'liquidate', 'return-to-seller', 'peer-redistribute'],
      required: true,
    },
    rankedAlternatives: { type: [alternativeSchema], default: [] },
    hardGatesApplied: { type: [String], default: [] },
    reverseLogisticsCost: { type: Number, min: 0 },
    demandSignal: {
      count: { type: Number, default: 0 },
      radiusKm: { type: Number, default: 0 },
    },

    // Refund-timing decision (Combined plan §8).
    refundTiming: {
      type: String,
      enum: ['immediate', 'on-resolution', 'on-inspection', 'rejected'],
      default: 'on-resolution',
    },
    refundHold: { type: Boolean, default: false },
    refundHoldReason: { type: String, default: null },

    // Best-warehouse selection (null for peer-handoff / donate / local paths).
    chosenWarehouse: {
      code: { type: String, default: null },
      name: { type: String, default: null },
      city: { type: String, default: null },
      score: { type: Number, default: null },
      breakdown: { type: mongoose.Schema.Types.Mixed, default: null },
    },

    // Hold-at-home matching window (set when a peer match exists).
    matchWindow: {
      active: { type: Boolean, default: false },
      hours: { type: Number, default: null },
      expiresAt: { type: Date, default: null },
    },

    // Search tags generated for this item (drives matching).
    tags: { type: [String], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('RoutingDecision', routingSchema);
