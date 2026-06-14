const express = require('express');
const router = express.Router();
const gradingController = require('./grading.controller');
const { validateTriggerGrading } = require('./grading.validation');
const { requireAuth, attachUser, requireRole } = require('../../middleware/auth.middleware');

// Health — ML service reachability (Req 14.5).
router.get('/health', gradingController.health);

// Trigger grading (REST entry point for standalone testing / future use).
router.post('/trigger', validateTriggerGrading, gradingController.triggerGrading);

// Progressive form rendering (Task 2.11).
router.post('/form/:itemId', gradingController.startForm);
router.get('/form/:itemId', gradingController.getForm);

// Per-photo validation proxy (v3.44) — inline "right part? in focus?" feedback.
router.post('/validate-photo', gradingController.validatePhoto);

// Per-upload Evidence Inspection (v2.34) — accept/reupload + persists a fragment.
router.post('/inspect-photo', gradingController.inspectPhoto);

// Per-field batched Evidence Inspection (v2.35) — the user's "Submit Field" click.
// One LLM call over the whole field's photo set; persists ONE field-level fragment.
router.post('/verify-field', gradingController.verifyField);

// Flagged grades for the seller/admin dashboard (Req 9.4 / 9.5).
router.get(
  '/flagged',
  requireAuth,
  attachUser,
  requireRole(['seller', 'admin']),
  gradingController.getFlaggedGrades
);

// Get a grade by itemId — keep last so it doesn't shadow the static routes above.
router.get('/:itemId', gradingController.getGrade);

module.exports = router;
