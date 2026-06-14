const mongoose = require('mongoose');

const ALLOWED_PRODUCT_STATUSES = ['pending', 'published', 'approved', 'flagged', 'rejected'];

const validateObjectId = (id, label = 'ID') => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return `${label} is not a valid identifier`;
  }
  return null;
};

/**
 * Validates query params for GET /admin/products and GET /admin/sellers
 */
const validateListQuery = (req, res, next) => {
  const { page, limit, status } = req.query;
  const errors = [];

  if (page !== undefined && (isNaN(Number(page)) || Number(page) < 1)) {
    errors.push('page must be a positive integer');
  }

  if (limit !== undefined && (isNaN(Number(limit)) || Number(limit) < 1)) {
    errors.push('limit must be a positive integer');
  }

  if (status !== undefined && !ALLOWED_PRODUCT_STATUSES.includes(status)) {
    errors.push(`status must be one of: ${ALLOWED_PRODUCT_STATUSES.join(', ')}`);
  }

  if (errors.length > 0) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors });
  }

  next();
};

/**
 * Validates PATCH /admin/products/:id/status
 */
const validateUpdateStatus = (req, res, next) => {
  const errors = [];

  const idError = validateObjectId(req.params.id, 'Product ID');
  if (idError) errors.push(idError);

  const { status } = req.body;
  if (!status || !ALLOWED_PRODUCT_STATUSES.includes(status)) {
    errors.push(`status is required and must be one of: ${ALLOWED_PRODUCT_STATUSES.join(', ')}`);
  }

  if (errors.length > 0) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors });
  }

  next();
};

/**
 * Validates PATCH /admin/products/:id/moderation and PATCH /admin/sellers/:id/moderation
 */
const validateUpdateModeration = (req, res, next) => {
  const errors = [];

  const idError = validateObjectId(req.params.id, 'ID');
  if (idError) errors.push(idError);

  const { banned, suspended } = req.body;

  if (banned === undefined && suspended === undefined) {
    errors.push('At least one of banned or suspended must be provided');
  }

  if (banned !== undefined && typeof banned !== 'boolean') {
    errors.push('banned must be a boolean');
  }

  if (suspended !== undefined && typeof suspended !== 'boolean') {
    errors.push('suspended must be a boolean');
  }

  if (errors.length > 0) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors });
  }

  next();
};

/**
 * Validates :id param is a valid ObjectId (generic)
 */
const validateParamId = (req, res, next) => {
  const error = validateObjectId(req.params.id, 'ID');
  if (error) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: [error] });
  }
  next();
};

module.exports = {
  validateListQuery,
  validateUpdateStatus,
  validateUpdateModeration,
  validateParamId,
};
