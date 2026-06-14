const express = require('express');
const router = express.Router();
const { getEventsByItemId } = require('./lifecycle.service');
const { requireAuth, attachUser } = require('../../middleware/auth.middleware');

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'lifecycle', status: 'ok' });
});

// GET /api/lifecycle/:itemId — get all lifecycle events for an item
router.get('/:itemId', requireAuth, attachUser, async (req, res, next) => {
  try {
    const events = await getEventsByItemId(req.params.itemId);
    res.status(200).json({ success: true, data: events });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
