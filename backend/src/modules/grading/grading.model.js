const mongoose = require('mongoose');

/**
 * Grade Model — stores the AI grading result (Grade JSON v1.43) plus the full
 * Evidence_Bundle for dispute resolution and model retraining (Requirement 8).
 *
 * One grade document per item (itemId is unique).
 */

const defectSchema = new mongoose.Schema({
  type: String,
  severity: { type: String, enum: ['minor', 'moderate', 'major'] },
  location: String,
  description: String,
}, { _id: false });

/**
 * Evidence_Bundle — full provenance of a grade (Req 8.2).
 */
const evidenceBundleSchema = new mongoose.Schema({
  prompts: {
    pass1: { type: String, default: '' },
    pass2: { type: String, default: '' },
  },
  imageUrls: { type: [String], default: [] },
  analysisSummary: { type: mongoose.Schema.Types.Mixed, default: {} },
  formSchema: { type: mongoose.Schema.Types.Mixed, default: {} },
  fraud: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { _id: false });

const gradingSchema = new mongoose.Schema(
  {
    // Unique per item — exactly one grade document per item (Req 8.1).
    itemId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId },
    intakePath: { type: String, enum: ['returns', 'sell-used'] },

    grade: { type: String, enum: ['A', 'B', 'C', 'D'], required: true },
    qualityScore: { type: Number, min: 0, max: 100 },
    confidence: { type: String, enum: ['high', 'medium', 'low'] },
    defects: { type: [defectSchema], default: [] },
    missingEvidence: { type: [String], default: [] },
    returnClaimVerified: { type: Boolean, default: false },
    estimatedResalePct: { type: Number, min: 0, max: 1 },
    routingHint: { type: String, enum: ['resell', 'refurbish', 'donate', 'liquidate'] },
    rationale: { type: String },
    modelVersions: {
      pass1Model: String,
      pass2Model: String,
      rekognitionVersion: String,
    },

    // Evidence bundle (full provenance).
    evidenceBundle: { type: evidenceBundleSchema, default: () => ({}) },

    // Human-review escalation (Requirement 9).
    flaggedForReview: { type: Boolean, default: false, index: true },
    reviewReason: { type: String },

    // Lifecycle emission status (Requirement 10).
    lifecycleEmission: {
      type: String,
      enum: ['emitted', 'pending', 'skipped'],
      default: 'pending',
    },

    // Fraud short-circuit marker.
    status: { type: String, enum: ['ok', 'fraud_rejected'], default: 'ok' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Grade', gradingSchema);
