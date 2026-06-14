const express = require('express');
const router = express.Router();
const sustainabilityController = require('./sustainability.controller');
const { requireAuth, attachUser } = require('../../middleware/auth.middleware');

const auth = [requireAuth, attachUser];

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'sustainability', status: 'ok' });
});

// Platform + per-item impact (public/read).
router.get('/platform', sustainabilityController.getPlatformImpact);
router.get('/item/:itemId', sustainabilityController.getItemImpact);

// Donation flow + receipt.
router.post('/donate/:itemId', auth, sustainabilityController.donate);
router.get('/donation/:itemId', sustainabilityController.getDonation);
router.get('/receipt/:itemId', sustainabilityController.getReceipt);

// Credit redemption.
router.post('/redeem', auth, sustainabilityController.redeem);

// User summary (keep last — dynamic param).
router.get('/user/:userId', sustainabilityController.getUserImpact);

module.exports = router;
