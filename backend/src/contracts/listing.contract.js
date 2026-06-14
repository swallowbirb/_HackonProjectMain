/**
 * Task 0.6 — Canonical Data Contracts
 * Listing JSON — extends Product for second-life marketplace items
 *
 * {
 *   // ...inherits from existing product schema
 *   intakePath: String,       // return | sell-used
 *   gradeId: ObjectId,
 *   healthCardId: ObjectId,
 *   conditionLane: String,    // like-new | good | fair
 *   aiGeneratedTitle: String,
 *   aiGeneratedDescription: String,
 *   suggestedPrice: Number,
 *   selectedPhotos: [String], // S3 URLs
 *   demandCount: Number,      // from geo query at listing time
 *   sustainabilityImpact: {
 *     co2SavedKg: Number,
 *     waterSavedLiters: Number
 *   }
 * }
 */

const INTAKE_PATHS = ['return', 'sell-used'];
const CONDITION_LANES = ['like-new', 'good', 'fair'];

/**
 * Condition lane → suggested price discount from original
 * Used as a starting point for AI price suggestion
 */
const CONDITION_LANE_DISCOUNT = {
  'like-new': 0.25,  // 25% off original
  'good': 0.45,      // 45% off original
  'fair': 0.65,      // 65% off original
};

module.exports = { INTAKE_PATHS, CONDITION_LANES, CONDITION_LANE_DISCOUNT };
