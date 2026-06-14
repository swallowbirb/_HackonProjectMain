const mongoose = require('mongoose');

/**
 * ItemLog — developer-visibility log stream (the Developer Logs sidebar).
 *
 * Plain-English logs emitted at every step of the intake → grade flow so the
 * frontend Developer Logs Sidebar (and backend console) can show exactly what
 * happened, in order, for a given item — including the ML service's internal
 * pipeline steps (image fetches, Gemini attempts, vision calls) which are
 * ingested verbatim from the ML `trace`.
 *
 * These are diagnostic logs, NOT the tamper-evident lifecycle events (those live
 * in lifecycle.model.js and feed the Health Card hash chain).
 */
const itemLogSchema = new mongoose.Schema({
  itemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    required: true,
    index: true,
  },
  // Machine step key, e.g. INITIATE, FRAUD_RESULT, MODEL_INVOKE, GRADE_ASSIGNED, ERROR.
  step: { type: String, required: true },
  // Human-readable, plain-English message.
  message: { type: String, required: true },
  // Severity — drives colour + filtering in the sidebar.
  level: {
    type: String,
    enum: ['info', 'success', 'warn', 'error', 'debug'],
    default: 'info',
    index: true,
  },
  // Pipeline phase — drives the grouped timeline in the sidebar.
  // init | trust | pass1 | evidence | request | fraud | analysis | pass2 |
  // persist | lifecycle | complete | error
  phase: { type: String, default: 'general' },
  // Where the log originated.
  source: {
    type: String,
    enum: ['server', 'ml', 'client'],
    default: 'server',
  },
  // Duration of the step in milliseconds (when it represents a timed operation).
  durationMs: { type: Number },
  // Monotonic ordering hint, primarily for ML trace entries ingested in a batch.
  seq: { type: Number },
  // Optional structured payload (tier, grade, score, signals, error stack, ...).
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  timestamp: { type: Date, default: Date.now },
});

// Chronological reads, with seq as a stable tiebreaker for same-millisecond entries.
itemLogSchema.index({ itemId: 1, timestamp: 1, seq: 1 });

// Auto-expire logs after 7 days.
itemLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 604800 });

module.exports = mongoose.model('ItemLog', itemLogSchema);
