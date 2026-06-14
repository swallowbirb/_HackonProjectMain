const mongoose = require('mongoose');
const {
  FIT_VERDICTS,
  COMPAT_VERDICTS,
  DIMENSION_VERDICTS,
  RETURN_REASON_CODES,
} = require('../../contracts/prevention.contract');

/**
 * ReturnInsight (RIKB) — Phase 7
 * One compact aggregate per product, plus synthetic (brand, category) rollup
 * docs for cold items. Bounded storage: ~0.5 KB/doc → 1,000 SKUs ≈ 0.5 MB.
 * We store aggregates, never raw events.
 *
 * Owned exclusively by Phase 7. Rebuilt nightly by prevention.job.
 */

const reasonHistogramSchema = new mongoose.Schema(
  RETURN_REASON_CODES.reduce((acc, code) => {
    acc[code] = { type: Number, default: 0 };
    return acc;
  }, {}),
  { _id: false }
);

const fitSignalSchema = new mongoose.Schema(
  {
    verdict: { type: String, enum: FIT_VERDICTS, default: 'unknown' },
    smallMentions: { type: Number, default: 0 },
    largeMentions: { type: Number, default: 0 },
    sampleSize: { type: Number, default: 0 },
    confidence: { type: Number, default: 0, min: 0, max: 1 },
  },
  { _id: false }
);

const compatSignalSchema = new mongoose.Schema(
  {
    verdict: { type: String, enum: COMPAT_VERDICTS, default: 'unknown' },
    compatMentions: { type: Number, default: 0 },
    setupMentions: { type: Number, default: 0 },
    sampleSize: { type: Number, default: 0 },
    confidence: { type: Number, default: 0, min: 0, max: 1 },
  },
  { _id: false }
);

const dimensionSignalSchema = new mongoose.Schema(
  {
    verdict: { type: String, enum: DIMENSION_VERDICTS, default: 'unknown' },
    largeMentions: { type: Number, default: 0 },
    smallMentions: { type: Number, default: 0 },
    colorMentions: { type: Number, default: 0 },
    sampleSize: { type: Number, default: 0 },
    confidence: { type: Number, default: 0, min: 0, max: 1 },
  },
  { _id: false }
);

const returnInsightSchema = new mongoose.Schema(
  {
    // Scope: either a specific product, or a category-level rollup (productId null)
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
    },
    brandName: { type: String, default: null },
    category: { type: String, index: true }, // always set (cold-start backoff)

    unitsSold: { type: Number, default: 0 },
    unitsReturned: { type: Number, default: 0 },
    returnRate: { type: Number, default: 0, min: 0, max: 1 },

    reasonHistogram: { type: reasonHistogramSchema, default: () => ({}) },
    dominantReason: { type: String, default: null },

    fitSignal: { type: fitSignalSchema, default: () => ({}) },
    compatSignal: { type: compatSignalSchema, default: () => ({}) },
    dimensionSignal: { type: dimensionSignalSchema, default: () => ({}) },

    topComplaints: { type: [String], default: [] }, // cap 5 short phrases
    sellerSummary: { type: String, default: null }, // ONE nightly LLM sentence

    // Before/After tracking (§17)
    previousReturnRate30d: { type: Number, default: null },
    rateChangeDirection: {
      type: String,
      enum: ['improved', 'worsened', 'stable', null],
      default: null,
    },

    scope: {
      type: String,
      enum: ['product', 'category'],
      default: 'product',
      index: true,
    },
    lastComputed: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Fast PDP lookup + cold-start backoff
returnInsightSchema.index({ productId: 1 });
returnInsightSchema.index({ scope: 1, category: 1 });

module.exports = mongoose.model('ReturnInsight', returnInsightSchema);
