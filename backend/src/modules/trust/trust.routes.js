const express = require('express');
const router = express.Router();
const ctrl = require('./trust.controller');
const { validateUserId, validateSignal } = require('./trust.validation');
const { requireAuth, attachUser } = require('../../middleware/auth.middleware');

router.get('/health', (req, res) =>
  res.status(200).json({ module: 'trust', status: 'ok' })
);

// Admin route declared BEFORE '/:userId' so 'admin' isn't captured as a userId.
router.get('/admin/flagged', requireAuth, attachUser, ctrl.listFlagged);

router.get('/:userId', validateUserId, ctrl.getTrustProfile);
router.post('/:userId/recompute', validateUserId, ctrl.recomputeTrust);
router.post('/:userId/signals', validateUserId, validateSignal, ctrl.addSignal);

module.exports = router;
