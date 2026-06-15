/**
 * Validation for buyer "Looking for…" post creation.
 */
const validateCreateWant = (req, res, next) => {
  const errors = [];
  const { productCategory, lng, lat, location, maxPrice, condition } = req.body;

  if (!productCategory || typeof productCategory !== 'string') {
    errors.push('productCategory is required');
  }

  const resolvedLng = lng ?? location?.coordinates?.[0];
  const resolvedLat = lat ?? location?.coordinates?.[1];
  if (resolvedLng == null || resolvedLat == null) {
    errors.push('location (lng/lat) is required');
  } else {
    if (Number.isNaN(Number(resolvedLng)) || Number(resolvedLng) < -180 || Number(resolvedLng) > 180) {
      errors.push('lng must be between -180 and 180');
    }
    if (Number.isNaN(Number(resolvedLat)) || Number(resolvedLat) < -90 || Number(resolvedLat) > 90) {
      errors.push('lat must be between -90 and 90');
    }
  }

  if (maxPrice !== undefined && (Number.isNaN(Number(maxPrice)) || Number(maxPrice) < 0)) {
    errors.push('maxPrice must be a non-negative number');
  }

  if (condition !== undefined && !['any', 'like-new', 'good', 'fair'].includes(condition)) {
    errors.push('condition must be one of: any, like-new, good, fair');
  }

  if (errors.length > 0) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors });
  }
  next();
};

module.exports = { validateCreateWant };
