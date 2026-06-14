const express = require('express');
const router = express.Router();
const adminController = require('./admin.controller');
const {
  validateListQuery,
  validateUpdateStatus,
  validateUpdateModeration,
  validateParamId,
} = require('./admin.validation');
const { requireAuth, attachUser, requireRole } = require('../../middleware/auth.middleware');

// All admin routes require authentication and the 'admin' role
const adminAuth = [requireAuth, attachUser, requireRole(['admin'])];

/**
 * Dashboard Statistics
 * GET /api/admin/stats
 */
router.get('/stats', adminAuth, adminController.getDashboardStats);

/**
 * Product Management
 * GET    /api/admin/products               — list all products (filterable, paginated)
 * PATCH  /api/admin/products/:id/status    — approve or reject a product
 * PATCH  /api/admin/products/:id/moderation — ban/unban or suspend/unsuspend a product
 */
router.get('/products', adminAuth, validateListQuery, adminController.getProducts);
router.patch('/products/:id/status', adminAuth, validateUpdateStatus, adminController.updateProductStatus);
router.patch('/products/:id/moderation', adminAuth, validateUpdateModeration, adminController.updateProductModeration);

/**
 * Seller Management
 * GET    /api/admin/sellers                     — list all sellers (filterable, paginated)
 * GET    /api/admin/sellers/:id/products        — get recent products for a seller (row expansion)
 * PATCH  /api/admin/sellers/:id/moderation      — ban/unban or suspend/unsuspend a seller
 */
router.get('/sellers', adminAuth, validateListQuery, adminController.getSellers);
router.get('/sellers/:id/products', adminAuth, validateParamId, adminController.getSellerProducts);
router.patch('/sellers/:id/moderation', adminAuth, validateUpdateModeration, adminController.updateSellerModeration);

/**
 * Review Moderation
 * GET   /api/admin/reviews               — list all reviews (filterable)
 * PATCH /api/admin/reviews/:id/moderation — remove/flag a review
 */
router.get('/reviews', adminAuth, validateListQuery, adminController.getReviews);
router.patch('/reviews/:id/moderation', adminAuth, validateParamId, adminController.moderateReview);

module.exports = router;
