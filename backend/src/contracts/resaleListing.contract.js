/**
 * Step 0 — Frozen Contract: ResaleListing
 *
 * The canonical shape of a second-life resale listing. This is its OWN
 * collection — it never mutates the existing marketplace `Product` model.
 * A graded + routed item that lands on a resell-class path is turned into a
 * ResaleListing draft by `resale.service.createDraftFromRouting`, then the
 * seller publishes it to the storefront.
 *
 * ResaleListing JSON:
 * {
 *   itemId: ObjectId,              // 1:1 with the shared Item (unique)
 *   gradeId: ObjectId,             // the Grade this listing is backed by
 *   routingDecisionId: ObjectId,   // the RoutingDecision that created it
 *   sellerId: ObjectId,            // who sells it (see seller resolution below)
 *   intakePath: String,            // return | sell-used
 *   title: String,                 // deterministic, from grade + product data
 *   description: String,           // deterministic listing copy
 *   category: String,
 *   images: [String],              // chosen from the grade evidence bundle
 *   originalPrice: Number,         // original/reference price
 *   suggestedPrice: Number,        // grade × demand formula (immutable suggestion)
 *   price: Number,                 // live price (seller can override)
 *   conditionLane: String,         // like-new | good | fair
 *   grade: String,                 // A | B | C | D (snapshot)
 *   qualityScore: Number,          // 0-100 (snapshot)
 *   gradeRationale: String,        // the AI's reasoning behind the grade (snapshot)
 *   defects: [{ type, severity, location, description }], // snapshot
 *   previousOwnerNotes: String,    // free-text notes added by the returner/seller
 *   demandCount: Number,           // nearby-buyer demand at draft time
 *   healthCardId: ObjectId,        // optional product health card (stretch)
 *   status: String,                // DRAFT | PUBLISHED | UNLISTED | SOLD
 *   peerRedistribute: Boolean,     // true when the routing path was peer-redistribute
 *   marketplaceProductId: ObjectId // mirror Product created on publish (reuses order flow)
 * }
 *
 * Seller resolution (in createDraftFromRouting):
 *   - sell-used  → the item initiator (they own the item)
 *   - return     → the original product seller, else platform (admin), else initiator
 */

const RESALE_STATUSES = ['DRAFT', 'PUBLISHED', 'UNLISTED', 'SOLD'];

/**
 * Only these routing paths produce a resale listing. Phase A calls the seam
 * `safeCreateResaleDraft`; Phase B's createDraftFromRouting no-ops on any other
 * path so the handoff degrades gracefully.
 */
const RESALE_TRIGGER_PATHS = ['resell', 'refurbish', 'peer-redistribute'];

/**
 * Grade → condition lane. Mirrors grade.contract.GRADE_TO_CONDITION_LANE but is
 * re-declared here so the resale module has a single frozen source of truth for
 * the listing's condition story. D-grade items never reach a resell path.
 */
const GRADE_TO_CONDITION_LANE = {
  A: 'like-new',
  B: 'good',
  C: 'fair',
  D: 'fair', // defensive fallback; D shouldn't reach resale, but never emit null
};

/**
 * Shared price formula — the single source of truth for both phases.
 *   suggestedPrice = round(originalPrice × estimatedResalePct × (1 + min(demandCount/10, 0.5)))
 * A higher nearby-demand count nudges the price up, capped at +50%.
 */
const computeSuggestedPrice = (originalPrice, estimatedResalePct, demandCount = 0) => {
  const base = Number(originalPrice) || 0;
  const pct = Number(estimatedResalePct) || 0;
  const demandMultiplier = 1 + Math.min((Number(demandCount) || 0) / 10, 0.5);
  return Math.round(base * pct * demandMultiplier);
};

module.exports = {
  RESALE_STATUSES,
  RESALE_TRIGGER_PATHS,
  GRADE_TO_CONDITION_LANE,
  computeSuggestedPrice,
};
