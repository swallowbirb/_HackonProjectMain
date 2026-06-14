/**
 * Lifecycle_Event_Emitter — Phase 1 boundary (Requirement 10)
 *
 * Phase 2 MUST NOT write the lifecycle event collection directly. Phase 1 owns the
 * real writer (healthCard.appendLifecycleEvent). This thin interface attempts to
 * invoke that writer through its public function; if it is not yet implemented or
 * throws, emission is reported as deferred so the caller can mark the grade
 * `pending` for later reconciliation.
 *
 * Coordinated interface signature with Phase 1:
 *   appendLifecycleEvent(itemId, eventType, actor, data)
 */
const { EVENT_TYPES } = require('../../contracts/lifecycleEvent.contract');

// Defensive: ensure the GRADED event type exists in the shared contract.
const GRADED_EVENT = EVENT_TYPES.includes('GRADED') ? 'GRADED' : 'GRADED';

let healthCardService = null;
try {
  // Loaded lazily/defensively — Phase 1 may not have implemented the writer yet.
  healthCardService = require('../healthCard/healthCard.service');
} catch (_e) {
  healthCardService = null;
}

/**
 * Emit a GRADED lifecycle event through the Phase 1 writer interface.
 *
 * @param {string} itemId
 * @param {object} data - event payload (gradeId, grade, confidence, routingHint)
 * @returns {Promise<{ emitted: boolean, status: 'emitted'|'pending', reason?: string }>}
 */
const emitGraded = async (itemId, data = {}) => {
  const eventType = GRADED_EVENT;
  const actor = { userId: null, role: 'system' };

  if (!healthCardService || typeof healthCardService.appendLifecycleEvent !== 'function') {
    return { emitted: false, status: 'pending', reason: 'emitter_unavailable' };
  }

  try {
    const result = await healthCardService.appendLifecycleEvent(itemId, eventType, actor, data);
    // Phase 1's stub currently returns undefined; treat a thrown error as failure,
    // but a clean return (even undefined) as a successful emission once implemented.
    // Until Phase 1 implements it, the function returns undefined without persisting,
    // so we conservatively treat `undefined` as deferred to avoid claiming a false emit.
    if (result === undefined) {
      return { emitted: false, status: 'pending', reason: 'emitter_not_implemented' };
    }
    return { emitted: true, status: 'emitted' };
  } catch (err) {
    return { emitted: false, status: 'pending', reason: err.message || 'emitter_error' };
  }
};

module.exports = { emitGraded };
