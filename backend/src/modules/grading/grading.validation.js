/**
 * Validation for the Grading_Request_Contract (Requirement 1).
 *
 * POST /api/grading/trigger body:
 *   { itemId, userId, productId, reason, imageUrls[], intakePath, category }
 */

const INTAKE_PATHS = ['returns', 'sell-used'];

const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';

const isHttpsUrl = (v) => {
  if (typeof v !== 'string') return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:';
  } catch (_e) {
    return false;
  }
};

const validateTriggerGrading = (req, res, next) => {
  const body = req.body || {};
  const { itemId, userId, productId, reason, imageUrls, intakePath, category } = body;
  const errors = [];

  if (!isNonEmptyString(itemId)) errors.push('itemId is required and must be a non-empty string');
  if (!isNonEmptyString(userId)) errors.push('userId is required and must be a non-empty string');
  if (!isNonEmptyString(productId)) errors.push('productId is required and must be a non-empty string');
  if (!isNonEmptyString(reason)) errors.push('reason is required and must be a non-empty string');
  if (!isNonEmptyString(category)) errors.push('category is required and must be a non-empty string');

  if (!INTAKE_PATHS.includes(intakePath)) {
    errors.push(`intakePath must be one of: ${INTAKE_PATHS.join(', ')}`);
  }

  if (!Array.isArray(imageUrls)) {
    errors.push('imageUrls is required and must be an array of HTTPS URL strings');
  } else {
    if (imageUrls.length < 1 || imageUrls.length > 10) {
      errors.push('imageUrls must contain between 1 and 10 entries');
    }
    if (imageUrls.some((u) => !isHttpsUrl(u))) {
      errors.push('every imageUrls entry must be an HTTPS URL string');
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors });
  }

  next();
};

module.exports = { validateTriggerGrading };
