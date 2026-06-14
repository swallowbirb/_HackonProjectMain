const express = require('express');
const router = express.Router();
const devController = require('./dev.controller');

router.delete('/erase', devController.eraseData);
router.post('/populate', devController.populateData);
router.get('/save', devController.saveData);
router.delete('/reset-returns', devController.resetReturnData);

module.exports = router;
