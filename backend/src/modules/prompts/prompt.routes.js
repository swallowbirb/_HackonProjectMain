const express = require('express');
const router = express.Router();
const promptController = require('./prompt.controller');
const { requireAuth, attachUser, requireRole } = require('../../middleware/auth.middleware');

// All prompt-config routes are admin-only.
const adminAuth = [requireAuth, attachUser, requireRole(['admin'])];

router.get('/', adminAuth, promptController.listPrompts);
router.put('/', adminAuth, promptController.upsertPrompt);
router.post('/reset', adminAuth, promptController.resetPrompt);
router.delete('/category', adminAuth, promptController.deleteCategory);

module.exports = router;
