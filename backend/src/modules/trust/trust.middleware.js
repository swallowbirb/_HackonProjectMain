const { getTrustProfile } = require('./trust.service');

/**
 * attachTrustProfile — mount on any route to expose req.trustProfile.
 * Resolves userId from req.user._id (preferred) or req.params.userId.
 *
 * P1 usage (one line in their route):
 *   const { attachTrustProfile } = require('../trust/trust.middleware');
 *   router.post('/returns', requireAuth, attachUser, attachTrustProfile, ctrl.initiate);
 * Then in their controller: req.trustProfile.tier  // 'verified'|'trusted'|...
 */
const attachTrustProfile = async (req, res, next) => {
  try {
    const userId = (req.user && req.user._id) || req.params.userId;
    req.trustProfile = userId ? await getTrustProfile(userId) : null;
    next();
  } catch (e) {
    next(e);
  }
};

module.exports = { attachTrustProfile };
