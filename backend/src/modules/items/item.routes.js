const express = require('express');
const router = express.Router();
const itemController = require('./item.controller');
const { requireAuth, attachUser } = require('../../middleware/auth.middleware');

const auth = [requireAuth, attachUser];

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'items', status: 'ok' });
});

router.get('/my', auth, itemController.getMyItems);
router.get('/:itemId/status', auth, itemController.getStatus);
router.get('/:itemId/logs', auth, itemController.getLogs);
router.patch('/:itemId/notes', auth, itemController.updateNotes);
router.get('/:itemId', auth, itemController.getItem);

module.exports = router;
