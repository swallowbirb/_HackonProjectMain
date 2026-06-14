const express = require('express');
const router = express.Router();
const secondhandController = require('./secondhand.controller');
const { requireAuth, attachUser, requireRole } = require('../../middleware/auth.middleware');

const buyerAuth = [requireAuth, attachUser, requireRole(['buyer'])];

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'secondhand', status: 'ok' });
});

// POST /api/secondhand/from-order — initiate from a past platform order
router.post('/from-order', buyerAuth, secondhandController.initiateFromOrder);

// POST /api/secondhand/:itemId/evidence — submit photos
router.post('/:itemId/evidence', buyerAuth, secondhandController.submitEvidence);

// GET /api/secondhand/my — buyer's sell-used listings
router.get('/my', buyerAuth, secondhandController.getMyListings);

// GET /api/secondhand/:id — single listing detail
router.get('/:id', buyerAuth, secondhandController.getListing);

module.exports = router;
