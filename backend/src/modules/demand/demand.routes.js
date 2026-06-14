const express = require('express');
const router = express.Router();
const demandController = require('./demand.controller');
const { validateCreateWant } = require('./demand.validation');
const { requireAuth, attachUser } = require('../../middleware/auth.middleware');

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'demand', status: 'ok' });
});

// Debug / seam endpoint — public read for matching diagnostics.
router.get('/match', demandController.matchDemand);

// Admin demand map — public read (small seeded demo data).
router.get('/map', demandController.getDemandMap);
router.get('/warehouses', demandController.getWarehouses);

// Buyer "Looking for…" posts — authenticated.
router.post('/', requireAuth, attachUser, validateCreateWant, demandController.createWant);
router.get('/user', requireAuth, attachUser, demandController.getWantsByUser);
router.delete('/:id', requireAuth, attachUser, demandController.deleteWant);

module.exports = router;
