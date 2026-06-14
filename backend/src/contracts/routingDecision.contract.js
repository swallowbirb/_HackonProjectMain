/**
 * Task 0.6 — Canonical Data Contracts
 * Routing Decision JSON — output of the smart disposition engine
 *
 * {
 *   itemId: ObjectId,
 *   gradeId: ObjectId,
 *   trustProfileId: ObjectId,
 *   chosenPath: String,       // resell | refurbish | donate | liquidate | return-to-seller | peer-redistribute
 *   rankedAlternatives: [{
 *     path: String,
 *     score: Number,
 *     netRecovery: Number,
 *     rationale: String
 *   }],
 *   hardGatesApplied: [String],
 *   reverseLogisticsCost: Number,
 *   demandSignal: { count: Number, radiusKm: Number },
 *   createdAt: Date
 * }
 */

const ROUTING_PATHS = [
  'resell',
  'refurbish',
  'donate',
  'liquidate',
  'return-to-seller',
  'peer-redistribute',
];

/**
 * Hard gate rules — these override the scoring engine
 * Key: condition → Value: forced path
 */
const HARD_GATES = {
  COUNTERFEIT_DETECTED: 'liquidate',
  GRADE_D_NO_DEMAND: 'donate',
  RESTRICTED_USER_REPEAT_OFFENDER: 'return-to-seller',
  HAZARDOUS_MATERIAL: 'liquidate',
};

module.exports = { ROUTING_PATHS, HARD_GATES };
