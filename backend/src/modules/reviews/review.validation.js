const mongoose = require('mongoose');

const validateCreateReview = (req, res, next) => {
  const { productId, rating, text } = req.body;
  const errors = [];

  if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
    errors.push('productId is required and must be a valid ID');
  }

  if (rating === undefined || typeof rating !== 'number' || rating < 1 || rating > 5) {
    errors.push('rating is required and must be a number between 1 and 5');
  }

  if (!text || typeof text !== 'string' || text.trim() === '') {
    errors.push('text is required and must be a non-empty string');
  }

  if (errors.length > 0) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors });
  }

  next();
};

const validateUpdateReview = (req, res, next) => {
  const { rating, text } = req.body;
  const errors = [];

  if (rating !== undefined && (typeof rating !== 'number' || rating < 1 || rating > 5)) {
    errors.push('rating must be a number between 1 and 5');
  }

  if (text !== undefined && (typeof text !== 'string' || text.trim() === '')) {
    errors.push('text must be a non-empty string');
  }

  if (errors.length > 0) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors });
  }

  next();
};

const validateReviewId = (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid review ID' });
  }
  next();
};

module.exports = {
  validateCreateReview,
  validateUpdateReview,
  validateReviewId,
};
