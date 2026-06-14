const mongoose = require('mongoose');

/**
 * Lightweight order model.
 * We're NOT building a full checkout/payment system.
 * Orders are simulated — clicking "Buy Now" creates a record instantly.
 * Purpose: establish purchase legitimacy for reviews + sales velocity for anomaly detection.
 */
const orderSchema = new mongoose.Schema(
  {
    buyerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Denormalized from product — avoids extra join on every order query
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      index: true,
      default: null,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },
    // Price at time of purchase (product price × quantity)
    totalPrice: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ['completed', 'cancelled', 'refunded'],
      default: 'completed',
    },
    // Payment method. 'prepaid' = mock card (existing behavior). 'cod' = cash on
    // delivery. Defaulted to 'prepaid' so all existing order creates are unaffected.
    paymentMethod: {
      type: String,
      enum: ['prepaid', 'cod'],
      default: 'prepaid',
    },
    paymentDetails: {
      mockCreditCard: {
        type: String,
        // Required only for prepaid orders — COD orders carry no card.
        required: function () {
          return this.paymentMethod !== 'cod';
        },
      },
    },
    // Phase 7.5 — fulfillment lifecycle (additive; default 'placed').
    // Drives the mid-transit cancel lock (Lever 3). Simulated/advanced via a dev hook.
    fulfillmentStatus: {
      type: String,
      enum: ['placed', 'dispatched', 'in_transit', 'out_for_delivery', 'delivered'],
      default: 'placed',
    },
    // Phase 7.5 — festive policy snapshotted at placement time. Null for orders
    // placed outside any festive window. Snapshotting protects the buyer from
    // later calendar edits. Read by returns (window) and cancel (lock) flows.
    festivePolicy: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    // Phase 7.5 — set when a cancel attempt was blocked by the mid-transit lock,
    // and when the order was actually cancelled (for the admin festive panel).
    cancelledAt: { type: Date, default: null },
    // Populated when the order was placed via a catalog entry offer (catalog path).
    // Null for standalone product orders (existing behavior).
    offerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SellerOffer',
      default: null,
    },
    catalogEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BrandCatalogEntry',
      default: null,
    },
  },
  { timestamps: true } // createdAt = order date, used for velocity calculation
);

const Order = mongoose.model('Order', orderSchema);

module.exports = Order;
