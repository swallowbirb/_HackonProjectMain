const express = require('express');
const router = express.Router();
const reviewController = require('./review.controller');
const { validateCreateReview, validateUpdateReview, validateReviewId } = require('./review.validation');
const { requireAuth, attachUser, requireRole } = require('../../middleware/auth.middleware');

const buyerAuth = [requireAuth, attachUser, requireRole(['buyer'])];
const buyerOrAdminAuth = [requireAuth, attachUser, requireRole(['buyer', 'admin'])];

// POST /api/reviews — Buyer creates a review
router.post('/', buyerAuth, validateCreateReview, reviewController.createReview);

// GET /api/reviews/product/:productId — Public: all reviews for a product
router.get('/product/:productId', reviewController.getReviewsByProduct);

// GET /api/reviews/user/:userId — Public: all reviews by a user
router.get('/user/:userId', reviewController.getReviewsByUser);

// PATCH /api/reviews/:id — Buyer edits their own review
router.patch('/:id', buyerAuth, validateReviewId, validateUpdateReview, reviewController.updateReview);

// DELETE /api/reviews/:id — Buyer (own) or Admin
router.delete('/:id', buyerOrAdminAuth, validateReviewId, reviewController.deleteReview);

module.exports = router;
