const trustService = require('./trust.service');

// GET /api/trust/:userId
const getTrustProfile = async (req, res, next) => {
  try {
    const profile = await trustService.getTrustProfile(req.params.userId);
    if (!profile) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: profile });
  } catch (e) {
    next(e);
  }
};

// POST /api/trust/:userId/recompute
const recomputeTrust = async (req, res, next) => {
  try {
    const profile = await trustService.computeTrustProfile(req.params.userId);
    if (!profile) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: profile });
  } catch (e) {
    next(e);
  }
};

// POST /api/trust/:userId/signals
const addSignal = async (req, res, next) => {
  try {
    const { signal, value, direction } = req.body;
    const profile = await trustService.addFraudSignal(req.params.userId, signal, value, direction);
    if (!profile) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: profile });
  } catch (e) {
    next(e);
  }
};

// GET /api/trust/admin/flagged
const listFlagged = async (req, res, next) => {
  try {
    // Admin gate in-controller (we do NOT touch auth.middleware).
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin only' });
    }
    const { tier, page, limit } = req.query;
    const data = await trustService.listFlaggedProfiles({
      tier,
      page: Number(page) || 1,
      limit: Number(limit) || 20,
    });
    res.json({ success: true, ...data });
  } catch (e) {
    next(e);
  }
};

module.exports = { getTrustProfile, recomputeTrust, addSignal, listFlagged };
