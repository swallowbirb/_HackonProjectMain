const mongoose = require('mongoose');

/**
 * TrustProfile Model — user trust scoring
 * TODO: Expected fields (see contracts/trustProfile.contract.js):
 *   - userId: ObjectId (ref: User) — unique
 *   - tier: String (verified | trusted | standard | watch | restricted)
 *   - score: Number (0-100)
 *   - signals: [{ signal, value, weight, direction }]
 *   - accountAge: Number (days)
 *   - lifetimePurchases: Number
 *   - lifetimeReturns: Number
 *   - returnRate: Number
 *   - recentReturnRate90d: Number
 *   - bracketingFlag: Boolean
 *   - wardrobingFlag: Boolean
 *   - lastComputed: Date
 */

const signalSchema = new mongoose.Schema({
  signal: String,
  value: mongoose.Schema.Types.Mixed,
  weight: Number,
  direction: { type: String, enum: ['positive', 'negative'] },
}, { _id: false });

const trustProfileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    tier: {
      type: String,
      enum: ['verified', 'trusted', 'standard', 'watch', 'restricted'],
      default: 'standard',
    },
    score: { type: Number, min: 0, max: 100, default: 50 },
    signals: { type: [signalSchema], default: [] },
    accountAge: { type: Number, default: 0 },
    lifetimePurchases: { type: Number, default: 0 },
    lifetimeReturns: { type: Number, default: 0 },
    returnRate: { type: Number, min: 0, max: 1, default: 0 },
    recentReturnRate90d: { type: Number, min: 0, max: 1, default: 0 },
    bracketingFlag: { type: Boolean, default: false },
    wardrobingFlag: { type: Boolean, default: false },
    lastComputed: { type: Date, default: Date.now },
    // Phase 3 additive: manually-injected fraud signals (via POST /:userId/signals).
    // Append-only; readFraudSignals() counts hard/soft from here. Backward-compatible.
    manualFraudSignals: {
      type: [{
        signal: String,
        value: mongoose.Schema.Types.Mixed,
        direction: { type: String, enum: ['positive', 'negative'], default: 'negative' },
        addedAt: { type: Date, default: Date.now },
      }],
      default: [],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('TrustProfile', trustProfileSchema);
