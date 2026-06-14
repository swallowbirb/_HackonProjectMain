const express = require('express');
const router = express.Router();

const ctrl = require('./prevention.controller');
const {
  validateObjectIdParam,
  validateCheckoutRisk,
  validateNudgePatch,
} = require('./prevention.validation');
const { requireAuth, attachUser } = require('../../middleware/auth.middleware');

// Health (no auth)
router.get('/health', ctrl.health);

// PDP — public (no auth required; anonymous buyers get product/category data only)
router.get('/product/:productId', validateObjectIdParam('productId'), ctrl.getProductInsight);

// Checkout risk — accepts optional auth so logged-in users get personalised risk
router.post('/checkout-risk', validateCheckoutRisk, async (req, res, next) => {
  // Try to attach user if a token is present, but don't fail if anonymous.
  try {
    if (req.headers.authorization) {
      return requireAuth(req, res, () => attachUser(req, res, () => ctrl.assessCheckoutRisk(req, res, next)));
    }
  } catch (_) {
    // fall through to anonymous
  }
  return ctrl.assessCheckoutRisk(req, res, next);
});

// Seller dashboard
router.get('/seller/insights', requireAuth, attachUser, ctrl.getSellerInsights);

// Admin / dev — recompute job
router.post('/recompute', async (req, res, next) => {
  // In dev, allow without auth so the seed script can trigger it.
  if (process.env.NODE_ENV === 'production') {
    return requireAuth(req, res, () => attachUser(req, res, () => ctrl.recompute(req, res, next)));
  }
  return ctrl.recompute(req, res, next);
});

// Nudge tracking (§15)
router.patch('/nudge-event/:id', validateObjectIdParam('id'), validateNudgePatch, ctrl.patchNudgeEvent);

// Refund timing — Phase 4 frozen interface
router.get('/refund-timing', ctrl.getRefundTiming);

// Analytics dashboard (§20)
router.get('/analytics', async (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return requireAuth(req, res, () => attachUser(req, res, () => ctrl.getAnalytics(req, res, next)));
  }
  return ctrl.getAnalytics(req, res, next);
});

module.exports = router;
