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
  },
  { timestamps: true }
);

module.exports = mongoose.model('RoutingDecision', routingSchema);
