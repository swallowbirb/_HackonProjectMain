const express = require('express');
const router = express.Router();
const demandController = require('./demand.controller');
const { validateCreateWant } = require('./demand.validation');
const { requireAuth, attachUser, requireRole } = require('../../middleware/auth.middleware');

const auth = [requireAuth, attachUser];
const adminAuth = [requireAuth, attachUser, requireRole(['admin'])];

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'demand', status: 'ok' });
});

// Admin demand map + warehouse list (admin-gated).
router.get('/map', adminAuth, demandController.getDemandMap);
router.get('/warehouses', adminAuth, demandController.getWarehouses);

// Debug match endpoint.
router.get('/match', demandController.matchDemand);

// Buyer "Looking for…" posts.
router.post('/', auth, validateCreateWant, demandController.createWant);
router.get('/user', auth, demandController.getWantsByUser);
router.delete('/:id', auth, demandController.deleteWant);

module.exports = router;
