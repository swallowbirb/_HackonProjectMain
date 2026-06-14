const express = require('express');
const router = express.Router();
const orderController = require('./order.controller');
const { validateCreateOrder } = require('./order.validation');
const { requireAuth, attachUser, requireRole } = require('../../middleware/auth.middleware');

const buyerAuth = [requireAuth, attachUser, requireRole(['buyer'])];
const sellerAuth = [requireAuth, attachUser, requireRole(['seller', 'admin'])];

// POST /api/orders — Buyer places an order ("Buy Now")
router.post('/', buyerAuth, validateCreateOrder, orderController.createOrder);

// GET /api/orders/my — Buyer gets their order history
router.get('/my', buyerAuth, orderController.getBuyerOrders);

// GET /api/orders/seller — Seller gets orders for their products
router.get('/seller', sellerAuth, orderController.getSellerOrders);

// POST /api/orders/:id/cancel — Buyer cancels an order (Phase 7.5 festive cancel lock applies)
router.post('/:id/cancel', buyerAuth, orderController.cancelOrder);

// PATCH /api/orders/:id/fulfillment — Demo helper to advance the carrier lifecycle.
// Allowed for buyer/seller/admin since orders are simulated (lets the buyer demo the lock).
const fulfillmentAuth = [requireAuth, attachUser, requireRole(['buyer', 'seller', 'admin'])];
router.patch('/:id/fulfillment', fulfillmentAuth, orderController.advanceFulfillment);

module.exports = router;
