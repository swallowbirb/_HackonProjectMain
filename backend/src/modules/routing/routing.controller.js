const routingService = require('./routing.service');

// POST /api/routing/compute  body: { itemId, sellerLocation?, counterfeit?, hazardous? }
const computeRouting = async (req, res, next) => {
  try {
    const { itemId, sellerLocation, counterfeit, hazardous } = req.body;
    const decision = await routingService.computeRoutingDecision(itemId, {
      sellerLocation,
      counterfeit,
      hazardous,
    });
    res.json({ success: true, data: decision });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

// GET /api/routing/:itemId
const getDecision = async (req, res, next) => {
  try {
    const decision = await routingService.getDecisionByItemId(req.params.itemId);
    if (!decision) {
      return res.status(404).json({ success: false, message: 'No routing decision for this item' });
    }
    res.json({ success: true, data: decision });
  } catch (error) {
    next(error);
  }
};

module.exports = { computeRouting, getDecision };
