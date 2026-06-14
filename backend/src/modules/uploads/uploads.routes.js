const express = require('express');
const router = express.Router();
const uploadsController = require('./uploads.controller');

router.get('/health', (req, res) => {
  res.status(200).json({ module: 'uploads', status: 'ok' });
});

// POST /api/uploads/presign — returns a pre-signed S3 upload URL
router.post('/presign', uploadsController.getPresignedUrl);

module.exports = router;
