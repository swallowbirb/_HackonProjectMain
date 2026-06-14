/**
 * festive.validation.js — plain-JS request validators (matches project convention).
 */

const validatePaymentPolicyQuery = (req, res, next) => {
  const { cartTotal } = req.query;
  const errors = [];

  if (cartTotal !== undefined) {
    const n = Number(cartTotal);
    if (Number.isNaN(n) || n < 0) errors.push('cartTotal must be a non-negative number');
  }

  if (errors.length) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors });
  }
  next();
};

const validateOverride = (req, res, next) => {
  const { instanceKey, on } = req.body;
  const errors = [];

  if (!instanceKey || typeof instanceKey !== 'string') {
    errors.push('instanceKey is required as a string');
  }
  if (on !== undefined && typeof on !== 'boolean') {
    errors.push('on must be a boolean');
  }

  if (errors.length) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors });
  }
  next();
};

module.exports = { validatePaymentPolicyQuery, validateOverride };
