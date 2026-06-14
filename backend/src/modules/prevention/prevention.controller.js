const preventionService = require('./prevention.service');

// Standard_Response envelope: { success, data } — matches the rest of the repo.

// GET /api/prevention/health
const health = (req, res) => {
  res.status(200).json({ module: 'prevention', status: 'ok' });
};

// GET /api/prevention/product/:productId
const getProductInsight = async (req, res, next) => {
  try {
    const insight = await preventionService.getProductInsight(req.params.productId);
    if (!insight) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    res.json({ success: true, data: insight });
  } catch (e) {
    next(e);
  }
};

// POST /api/prevention/checkout-risk
// Body: { items: [{ productId, quantity?, sizeAdjusted? }] }
// Auth: optional — anonymous buyers still get product/category-based scoring.
const assessCheckoutRisk = async (req, res, next) => {
  try {
    const userId = req.user?._id || req.body.userId || null;
    const result = await preventionService.assessCheckoutRisk({
      userId,
      items: req.body.items,
    });
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
};

// GET /api/prevention/seller/insights
const getSellerInsights = async (req, res, next) => {
  try {
    if (!req.user || (req.user.role !== 'seller' && req.user.role !== 'admin')) {
      return res.status(403).json({ success: false, message: 'Seller or admin only' });
    }
    const sellerId = req.user.role === 'admin' && req.query.sellerId
      ? req.query.sellerId
      : req.user._id;
    const data = await preventionService.getSellerInsights(sellerId);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};

// POST /api/prevention/recompute
// Admin/dev only — runs the §3.4 nightly job on demand. Idempotent.
const recompute = async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      // Allow in non-production for the demo seed; admin-only in prod.
      if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ success: false, message: 'Admin only' });
      }
    }
    const result = await preventionService.runRecompute();
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
};

// PATCH /api/prevention/nudge-event/:id
// Body: { acted?: bool, purchased?: bool }
const patchNudgeEvent = async (req, res, next) => {
  try {
    const updated = await preventionService.patchNudgeEvent(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Nudge event not found or no valid fields' });
    }
    res.json({ success: true, data: updated });
  } catch (e) {
    next(e);
  }
};

// GET /api/prevention/refund-timing?userId=&productId=&riskBand=
const getRefundTiming = async (req, res, next) => {
  try {
    const { userId, productId, riskBand } = req.query;
    const data = await preventionService.getRefundTiming({ userId, productId, riskBand });
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};

// GET /api/prevention/analytics?days=7
const getAnalytics = async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ success: false, message: 'Admin only' });
      }
    }
    const days = Number(req.query.days) || 7;
    const data = await preventionService.getNudgeAnalytics({ days });
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
};

module.exports = {
  health,
  getProductInsight,
  assessCheckoutRisk,
  getSellerInsights,
  recompute,
  patchNudgeEvent,
  getRefundTiming,
  getAnalytics,
};
