/**
 * Task 0.6 — Canonical Data Contracts
 * Grade JSON v1.43 — output of the two-pass AI grading pipeline
 *
 * {
 *   itemId: ObjectId,
 *   grade: String,            // A | B | C | D
 *   qualityScore: Number,     // 0-100
 *   confidence: String,       // high | medium | low
 *   defects: [{
 *     type: String,
 *     severity: String,       // minor | moderate | major
 *     location: String,
 *     description: String
 *   }],
 *   missingEvidence: [String],
 *   returnClaimVerified: Boolean,
 *   estimatedResalePct: Number,  // 0.0-1.0
 *   routingHint: String,         // resell | refurbish | donate | liquidate
 *   rationale: String,
 *   modelVersions: {
 *     pass1Model: String,
 *     pass2Model: String,
 *     rekognitionVersion: String
 *   },
 *   createdAt: Date
 * }
 */

const GRADES = ['A', 'B', 'C', 'D'];
const CONFIDENCE_LEVELS = ['high', 'medium', 'low'];
const DEFECT_SEVERITIES = ['minor', 'moderate', 'major'];
const ROUTING_HINTS = ['resell', 'refurbish', 'donate', 'liquidate'];

/**
 * Grade → condition lane mapping
 * Used when creating a Listing from a graded item
 */
const GRADE_TO_CONDITION_LANE = {
  A: 'like-new',
  B: 'good',
  C: 'fair',
  D: null, // D-grade items don't get listed; go to donate/liquidate
};

module.exports = {
  GRADES,
  CONFIDENCE_LEVELS,
  DEFECT_SEVERITIES,
  ROUTING_HINTS,
  GRADE_TO_CONDITION_LANE,
};
