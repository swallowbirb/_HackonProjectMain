const express = require('express');
const router = express.Router();

const ctrl = require('./festive.controller');
const { validatePaymentPolicyQuery, validateOverride } = require('./festive.validation');
const { requireAuth, attachUser, requireRole } = require('../../middleware/auth.middleware');

// Optional-auth wrapper: attach the user if a token is present, but never block
// anonymous callers (mirrors the prevention module's checkout-risk pattern).
const optionalAuth = (req, res, next) => {
  if (req.headers.authorization) {
    return requireAuth(req, res, () => attachUser(req, res, () => next()));
  }
  return next();
};

// Admin/dev gate: in development allow unauthenticated access (seed/demo scripts),
// in production require an admin.
const adminAuth = (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return requireAuth(req, res, () =>
      attachUser(req, res, () => requireRole(['admin'])(req, res, next))
    );
  }
  return next();
};

// ── Public / optional-auth query endpoints (consumed by checkout UI) ──────────
router.get('/active', ctrl.getActive);
router.get('/payment-policy', optionalAuth, validatePaymentPolicyQuery, ctrl.getPaymentPolicy);
router.get('/return-window', optionalAuth, ctrl.getReturnWindow);

// ── Admin / dev — calendar visibility + demo override ─────────────────────────
router.get('/calendar', adminAuth, ctrl.listCalendar);
router.post('/override', adminAuth, validateOverride, ctrl.setOverride);

module.exports = router;
