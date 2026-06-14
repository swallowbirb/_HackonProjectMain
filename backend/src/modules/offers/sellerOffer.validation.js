const validateCreateOffer = (req, res, next) => {
  const { catalogEntryId, price, condition, quantity } = req.body;
  const errors = [];

  if (!catalogEntryId || typeof catalogEntryId !== 'string') {
    errors.push('catalogEntryId is required');
  }

  if (price === undefined || typeof price !== 'number' || price < 0) {
    errors.push('price is required and must be a non-negative number');
  }

  if (condition !== undefined && !['New', 'Used', 'Refurbished'].includes(condition)) {
    errors.push("condition must be one of: 'New', 'Used', 'Refurbished'");
  }

  if (quantity !== undefined && (typeof quantity !== 'number' || quantity < 1 || !Number.isInteger(quantity))) {
    errors.push('quantity must be a positive integer');
  }

  if (errors.length > 0) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors });
  }

  next();
};

const validateUpdateOffer = (req, res, next) => {
  const { price, condition, quantity, status } = req.body;
  const errors = [];

  if (price !== undefined && (typeof price !== 'number' || price < 0)) {
    errors.push('price must be a non-negative number');
  }

  if (condition !== undefined && !['New', 'Used', 'Refurbished'].includes(condition)) {
    errors.push("condition must be one of: 'New', 'Used', 'Refurbished'");
  }

  if (quantity !== undefined && (typeof quantity !== 'number' || quantity < 1 || !Number.isInteger(quantity))) {
    errors.push('quantity must be a positive integer');
  }

  if (status !== undefined && !['active', 'inactive'].includes(status)) {
    errors.push("status must be 'active' or 'inactive'");
  }

  if (errors.length > 0) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors });
  }

  next();
};

module.exports = {
  validateCreateOffer,
  validateUpdateOffer,
};
