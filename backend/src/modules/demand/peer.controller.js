const peerService = require('./peer.service');

// GET /api/demand/peer/offers — the authenticated buyer's active peer offers.
const getMyOffers = async (req, res, next) => {
  try {
    const data = await peerService.getOffersForBuyer(req.user._id);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// POST /api/demand/peer/:offerId/claim — reserve an offer (first-come).
const claimOffer = async (req, res, next) => {
  try {
    const offer = await peerService.claimOffer(req.params.offerId, req.user._id);
    res.json({ success: true, data: offer });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

// POST /api/demand/peer/:offerId/purchase — pay for a reserved offer.
const purchaseOffer = async (req, res, next) => {
  try {
    const offer = await peerService.purchaseOffer(req.params.offerId, req.user._id);
    res.json({ success: true, data: offer });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

module.exports = { getMyOffers, claimOffer, purchaseOffer };
