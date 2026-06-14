const mongoose = require('mongoose');
const { EVENT_TYPES, ACTOR_ROLES } = require('../../contracts/lifecycleEvent.contract');

const lifecycleEventSchema = new mongoose.Schema(
  {
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: true,
    },
    sequence: {
      type: Number,
      required: true,
    },
    eventType: {
      type: String,
      enum: EVENT_TYPES,
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    actor: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      role: { type: String, enum: ACTOR_ROLES },
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // Phase 5 will compute and fill these
    previousHash: { type: String, default: null },
    hash: { type: String, default: null },
  },
  { timestamps: false }
);

// Compound unique index — already created by createIndexes.js
lifecycleEventSchema.index({ itemId: 1, sequence: 1 }, { unique: true });

module.exports = mongoose.model('LifecycleEvent', lifecycleEventSchema);
