const REASON_CODES = ['defective', 'not_as_described', 'changed_mind', 'wrong_item', 'other'];

const validateInitiateReturn = (req, res, next) => {
  const { orderId, reasonCode } = req.body;
  const errors = [];
  if (!orderId) errors.push('orderId is required');
  if (!reasonCode || !REASON_CODES.includes(reasonCode)) {
    errors.push(`reasonCode must be one of: ${REASON_CODES.join(', ')}`);
  }
  if (errors.length) return res.status(400).json({ success: false, message: 'Validation failed', errors });
  next();
};

const validateSubmitEvidence = (req, res, next) => {
  const { photos } = req.body;
  if (!photos || !Array.isArray(photos) || photos.length === 0) {
    return res.status(400).json({ success: false, message: 'photos array with at least one S3 URL is required' });
  }
  next();
};

module.exports = { validateInitiateReturn, validateSubmitEvidence };
