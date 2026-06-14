const mongoose = require('mongoose');

const ITEM_STATUSES = [
  'INITIATED',
  'AWAITING_EVIDENCE',
  'EVIDENCE_PENDING',
  'GRADING',
  'GRADED',
  'ROUTED',
  'IN_TRANSIT',
  'LISTED',
  'SOLD',
  'DONATED',
  'LIQUIDATED',
  'REJECTED',
  'CANCELLED',
];

const REASON_CODES = [
  'defective',
  'not_as_described',
  'changed_mind',
  'wrong_item',
  'other',
];

const itemSchema = new mongoose.Schema(
  {
    intakePath: {
      type: String,
      enum: ['return', 'sell-used'],
      required: true,
    },
    initiatorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // Source records — exactly one will be set
    returnId: { type: mongoose.Schema.Types.ObjectId, ref: 'Return', default: null },
    secondhandId: { type: mongoose.Schema.Types.ObjectId, ref: 'SecondhandItem', default: null },

    // Snapshot from the order/product at intake time
    originalOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    originalProductId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    category: { type: String, trim: true },

    // User-provided context
    reasonCode: { type: String, enum: REASON_CODES },
    reasonText: { type: String, trim: true },
    description: { type: String, trim: true },

    // Free-text notes the previous owner adds after grading — surfaced on the
    // resale listing (Phase B). Editable by the initiator only.
    ownerNotes: { type: String, trim: true, default: '' },

    // Evidence collected during intake
    evidencePhotos: { type: [String], default: [] },

    // v3.44 — optional clarifying photo(s) attached at the CLAIM step (before the
    // dynamic form), used as multimodal context for Pass 1 form generation.
    clarifyingPhotos: { type: [String], default: [] },

    // v3.44 — the dynamic Pass-1 evidence form, persisted on the item so it survives
    // restarts and multiple backend instances (improvement #4). The in-memory map in
    // grading.service is only a fast cache; this is the source of truth.
    evidenceForm: {
      status: { type: String, enum: ['none', 'pending', 'ready', 'fallback'], default: 'none' },
      schema: { type: mongoose.Schema.Types.Mixed, default: null },
      schemaVersion: { type: Number, default: null },
      source: { type: String, default: null },   // ai | cache | generic_default | cache_degraded
      provider: { type: String, default: null }, // e.g. gemini
      generatedAt: { type: Date, default: null },
    },

    // v3.44 — which uploaded photo answers which named form field (improvement #3).
    // { fieldId: [s3Url, ...] }. Carried through to Pass 2 for explainable grades.
    evidenceFieldImages: { type: mongoose.Schema.Types.Mixed, default: {} },

    // v2.34/v2.35 — Evidence Inspector results, written when the user submits a
    // field for AI verification. Two cardinalities coexist transparently:
    //   • v2.34 (per-photo): one fragment per (fieldId, imageHash) — the legacy
    //     per-upload path that's still served by /api/grading/inspect-photo.
    //   • v2.35 (per-field): one fragment per fieldId carrying `imageUrls` (the
    //     whole photo set), `perPhoto` (descriptive notes per image), and
    //     `missingViews` (views still required) — produced by the user's
    //     "Submit Field" click via /api/grading/verify-field. When v2.35
    //     verification runs, ALL prior fragments under the same fieldId
    //     (whether v2.34 or v2.35) are removed and replaced by the new one
    //     so the synthesizer never double-counts.
    evidenceFragments: {
      type: [
        {
          fieldId: { type: String, default: null },
          fieldLabel: { type: String, default: null },
          // v2.34 single-photo shape
          imageUrl: { type: String, default: null },
          imageHash: { type: String, default: null, index: true },
          // v2.35 multi-photo shape
          imageUrls: { type: [String], default: undefined },
          perPhoto: { type: mongoose.Schema.Types.Mixed, default: undefined },
          missingViews: { type: [String], default: undefined },
          ocrTextPerPhoto: { type: mongoose.Schema.Types.Mixed, default: undefined },
          preflightPerPhoto: { type: mongoose.Schema.Types.Mixed, default: undefined },
          // Common evidence fields
          accepted: { type: Boolean, default: true },
          reuploadReason: { type: String, default: null },
          clarity: { type: String, default: null },
          subjectMatch: { type: Boolean, default: null },
          identityMatch: { type: String, default: null }, // yes | no | unknown
          observations: { type: [String], default: [] },
          ocrText: { type: String, default: null },
          conditionSignals: { type: [String], default: [] },
          preflight: { type: mongoose.Schema.Types.Mixed, default: {} },
          inspectorModel: { type: String, default: null },
          inspectorStatus: { type: String, default: null },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },

    // State machine
    status: {
      type: String,
      enum: ITEM_STATUSES,
      default: 'INITIATED',
      index: true,
    },

    // Trust context — snapshotted at submission time (Phase 3 fills in)
    trustTierAtSubmission: { type: String, default: null },

    // Forward refs — populated by later phases
    gradeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Grade', default: null },
    routingDecisionId: { type: mongoose.Schema.Types.ObjectId, ref: 'RoutingDecision', default: null },
    healthCardId: { type: mongoose.Schema.Types.ObjectId, ref: 'HealthCard', default: null },
    listingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  },
  { timestamps: true }
);

itemSchema.index({ initiatorUserId: 1, createdAt: -1 });
itemSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Item', itemSchema);
module.exports.ITEM_STATUSES = ITEM_STATUSES;
