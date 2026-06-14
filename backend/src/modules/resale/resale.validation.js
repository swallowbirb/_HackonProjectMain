/**
 * Hand-rolled validation middleware for the resale module (matches the
 * project convention — no Joi/Zod).
 */

const { CONDITION_LANES } = require('../../contracts/listing.contract');

const validateUpdatePrice = (req, res, next) => {
  const { price } = req.body || {};
  const num = Number(price);
  if (price === undefined || price === null || !Number.isFinite(num) || num < 0) {
    return res.status(400).json({ success: false, message: 'price is required and must be a non-negative number' });
  }
  next();
};

const validateStorefrontQuery = (req, res, next) => {
  const { conditionLane } = req.query || {};
  if (conditionLane && !CONDITION_LANES.includes(conditionLane)) {
    return res.status(400).json({
      success: false,
      message: `conditionLane must be one of: ${CONDITION_LANES.join(', ')}`,
    });
  }
  next();
};

module.exports = { validateUpdatePrice, validateStorefrontQuery };
