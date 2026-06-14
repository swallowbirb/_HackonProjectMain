const express = require('express');
const router = express.Router();
const resaleController = require('./resale.controller');
const { validateUpdatePrice, validateStorefrontQuery } = require('./resale.validation');
const { requireAuth, attachUser, requireRole } = require('../../middleware/auth.middleware');

const sellerAuth = [requireAuth, attachUser, requireRole(['seller', 'admin'])];

// Health.
router.get('/health', (req, res) => {
  res.status(200).json({ module: 'resale', status: 'ok' });
});

// Public storefront.
router.get('/', validateStorefrontQuery, resaleController.getStorefront);

// Seller's own listings (static — keep before /:id).
router.get('/seller/mine', sellerAuth, resaleController.getSellerListings);

// Seller/admin mutations.
router.post('/:id/publish', sellerAuth, resaleController.publish);
router.post('/:id/unlist', sellerAuth, resaleController.unlist);
router.patch('/:id/price', sellerAuth, validateUpdatePrice, resaleController.updatePrice);

// Public listing detail — keep last so it doesn't shadow static routes.
router.get('/:id', resaleController.getListing);

module.exports = router;
