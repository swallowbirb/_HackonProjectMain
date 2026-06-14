const mongoose = require('mongoose');

/**
 * GreenCreditLedger — append-only ledger of green-credit movements.
 *
 * A user's balance is the running sum of `delta` across their entries. We also
 * snapshot `balanceAfter` on every write so the balance can be read from the
 * latest entry without re-summing, and so the history is auditable.
 *
 * Credits are earned for circular actions (selling/buying second-hand, donating)
 * and spent when redeemed as a checkout discount (1 credit = ₹1).
 */

const REASONS = [
  'resale_sale_buyer',   // +10  buyer chose second-hand
  'resale_sale_seller',  // +10  seller's item kept in circulation
  'donation',            // +25  donor gave the item away
  'redeem_checkout',      // -N   redeemed as a checkout discount
];

const greenCreditLedgerSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    delta: { type: Number, required: true }, // +earned, -spent
    reason: { type: String, enum: REASONS, required: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', default: null },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    balanceAfter: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

greenCreditLedgerSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('GreenCreditLedger', greenCreditLedgerSchema);
module.exports.REASONS = REASONS;
