const mongoose = require('mongoose');

const secondhandSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', default: null },

    // Source order (required — only platform purchases allowed)
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    originalProductId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    originalCatalogEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'BrandCatalogEntry', default: null },

    // Snapshotted from product/catalog at intake
    productTitle: { type: String },
    productCategory: { type: String },
    orderTotal: { type: Number },

    // User-provided
    description: { type: String, trim: true },
    askingPrice: { type: Number, min: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SecondhandItem', secondhandSchema);
