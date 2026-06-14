const mongoose = require('mongoose');

const validateCreateBrand = (req, res, next) => {
  const { name } = req.body;
  const errors = [];

  if (!name || typeof name !== 'string' || name.trim() === '') {
    errors.push('name is required');
  }

  if (errors.length > 0) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors });
  }

  next();
};

const validateEnrollmentStatus = (req, res, next) => {
  const { status } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'status must be "approved" or "rejected"',
    });
  }
  next();
};

const validateBrandId = (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid brand ID' });
  }
  next();
};

module.exports = {
  validateCreateBrand,
  validateEnrollmentStatus,
  validateBrandId,
};
