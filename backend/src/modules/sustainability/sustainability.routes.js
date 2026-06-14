const express = require('express');
const router = express.Router();
const sustainabilityController = require('./sustainability.controller');

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'sustainability', status: 'scaffolded' });
});

router.get('/platform', sustainabilityController.getPlatformImpact);
router.get('/user/:userId', sustainabilityController.getUserImpact);

module.exports = router;
