const express = require('express');
const router = express.Router();
const routingController = require('./routing.controller');
const { validateComputeRouting } = require('./routing.validation');

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'routing', status: 'scaffolded' });
});

router.post('/compute', validateComputeRouting, routingController.computeRouting);
router.get('/:itemId', routingController.getDecision);

module.exports = router;
