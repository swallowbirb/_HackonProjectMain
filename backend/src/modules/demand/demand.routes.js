const express = require('express');
const router = express.Router();
const demandController = require('./demand.controller');
const { validateCreateWant } = require('./demand.validation');

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'demand', status: 'scaffolded' });
});

router.post('/', validateCreateWant, demandController.createWant);
router.get('/user', demandController.getWantsByUser);
router.get('/match', demandController.matchDemand);

module.exports = router;
