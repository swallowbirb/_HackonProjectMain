const mongoose = require('mongoose');

const validateObjectIdParam = (paramName) => (req, res, next) => {
  const v = req.params[paramName];
  if (!mongoose.isValidObjectId(v)) {
    return res
      .status(400)
      .json({ success: false, message: `Invalid ${paramName}` });
  }
  next();
};

const validateCheckoutRisk = (req, res, next) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: 'items must be a non-empty array' });
  }
  for (const it of items) {
    if (!it || !mongoose.isValidObjectId(it.productId)) {
      return res
        .status(400)
        .json({ success: false, message: 'each item must have a valid productId' });
    }
    if (it.quantity != null && (!Number.isInteger(it.quantity) || it.quantity < 1)) {
      return res
        .status(400)
        .json({ success: false, message: 'quantity must be a positive integer' });
    }
  }
  next();
};

const validateNudgePatch = (req, res, next) => {
  const { acted, purchased } = req.body || {};
  if (acted == null && purchased == null) {
    return res
      .status(400)
      .json({ success: false, message: 'patch must include `acted` and/or `purchased`' });
  }
  if (acted != null && typeof acted !== 'boolean') {
    return res.status(400).json({ success: false, message: '`acted` must be boolean' });
  }
  if (purchased != null && typeof purchased !== 'boolean') {
    return res.status(400).json({ success: false, message: '`purchased` must be boolean' });
  }
  next();
};

const validatePostReturnQuery = (req, res, next) => {
  const { userId, productId } = req.query || {};
  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ success: false, message: 'Invalid userId' });
  }
  if (!mongoose.isValidObjectId(productId)) {
    return res.status(400).json({ success: false, message: 'Invalid productId' });
  }
  next();
};

module.exports = {
  validateObjectIdParam,
  validateCheckoutRisk,
  validateNudgePatch,
};
