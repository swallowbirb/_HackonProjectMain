const mongoose = require('mongoose');

const REASON_CODES = ['defective', 'not_as_described', 'changed_mind', 'wrong_item', 'other'];

const returnSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', default: null },

    reasonCode: { type: String, enum: REASON_CODES, required: true },
    reasonText: { type: String, trim: true },

    // Snapshotted from order at intake time
    originalProductId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    originalCatalogEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'BrandCatalogEntry', default: null },
    productTitle: { type: String },
    productCategory: { type: String },
    orderTotal: { type: Number },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Return', returnSchema);
