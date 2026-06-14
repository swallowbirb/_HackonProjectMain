const mongoose = require('mongoose');

/**
 * HealthCard Model — tamper-evident product lifecycle card
 * TODO: Expected fields:
 *   - itemId: ObjectId
 *   - events: [ObjectId] (ref: LifecycleEvent) — ordered chain
 *   - currentHash: String — SHA-256 of the latest event
 *   - signature: String — KMS signature of currentHash
 *   - qrCodeUrl: String — S3 URL of generated QR code
 *   - publicKeyVersion: String — which KMS key alias version signed this
 *   - createdAt / updatedAt: Date
 */

const healthCardSchema = new mongoose.Schema(
  {
    itemId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    events: [{ type: mongoose.Schema.Types.ObjectId, ref: 'LifecycleEvent' }],
    currentHash: { type: String },
    signature: { type: String },
    qrCodeUrl: { type: String },
    publicKeyVersion: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model('HealthCard', healthCardSchema);
