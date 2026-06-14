const mongoose = require('mongoose');
const { NUDGE_TYPES, RISK_BANDS } = require('../../contracts/prevention.contract');

/**
 * NudgeEvent — Phase 7 §15
 * Tracks every nudge fired by the prevention layer + its outcome (acted /
 * purchased / returned). Drives the prevention analytics dashboard and the
 * auto-flagging of ineffective nudges.
 *
 * Append-only with a 90-day TTL so storage stays bounded.
 */

const nudgeEventSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    nudgeType: { type: String, enum: NUDGE_TYPES, required: true },
    riskBand: { type: String, enum: RISK_BANDS, required: true },
    trustTier: { type: String, default: 'standard' },
    category: { type: String, default: null }, // for analytics rollup

    // Outcome tracking
    shown: { type: Boolean, default: true },
    acted: { type: Boolean, default: null },
    purchased: { type: Boolean, default: null },
    returned: { type: Boolean, default: null },

    // Timestamps
    shownAt: { type: Date, default: Date.now },
    actedAt: { type: Date, default: null },
    purchasedAt: { type: Date, default: null },
    returnedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Auto-expire after 90 days to keep storage bounded
nudgeEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// Query patterns used by analytics + matching to returns
nudgeEventSchema.index({ nudgeType: 1, shown: 1, acted: 1 });
nudgeEventSchema.index({ productId: 1, nudgeType: 1 });
nudgeEventSchema.index({ userId: 1, productId: 1, shown: 1, acted: 1 });

module.exports = mongoose.model('NudgeEvent', nudgeEventSchema);
