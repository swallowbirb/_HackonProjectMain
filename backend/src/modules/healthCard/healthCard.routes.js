const express = require('express');
const router = express.Router();
const healthCardController = require('./healthCard.controller');

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'healthCard', status: 'scaffolded' });
});

router.get('/:itemId', healthCardController.getHealthCard);
router.get('/:itemId/verify', healthCardController.verifyChain);

module.exports = router;
