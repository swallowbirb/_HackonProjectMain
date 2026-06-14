const express = require('express');
const router = express.Router();
const returnController = require('./return.controller');
const { validateInitiateReturn, validateSubmitEvidence } = require('./return.validation');
const { requireAuth, attachUser, requireRole } = require('../../middleware/auth.middleware');

const buyerAuth = [requireAuth, attachUser, requireRole(['buyer'])];

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'returns', status: 'ok' });
});

// POST /api/returns — initiate a return
router.post('/', buyerAuth, validateInitiateReturn, returnController.initiateReturn);

// POST /api/returns/:itemId/evidence — submit photos
router.post('/:itemId/evidence', buyerAuth, validateSubmitEvidence, returnController.submitEvidence);

// GET /api/returns/my — buyer's return history
router.get('/my', buyerAuth, returnController.getMyReturns);

// GET /api/returns/:returnId — single return detail
router.get('/:returnId', buyerAuth, returnController.getReturn);

module.exports = router;
