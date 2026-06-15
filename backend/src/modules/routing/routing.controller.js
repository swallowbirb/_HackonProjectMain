const routingService = require('./routing.service');

const computeRouting = async (req, res, next) => {
  try {
    const { itemId, sellerLocation, counterfeit, hazardous } = req.body;
    const decision = await routingService.computeRoutingDecision(itemId, {
      sellerLocation,
      counterfeit,
      hazardous,
    });
    res.status(200).json({ success: true, data: decision });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    next(error);
  }
};

const getDecision = async (req, res, next) => {
  try {
    const decision = await routingService.getDecisionByItemId(req.params.itemId);
    if (!decision) {
      return res.status(404).json({ success: false, message: 'No routing decision for this item' });
    }
    res.status(200).json({ success: true, data: decision });
  } catch (error) {
    next(error);
  }
};

module.exports = { computeRouting, getDecision };
