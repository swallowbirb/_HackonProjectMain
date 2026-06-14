const { POST_CONDITIONS } = require('../../contracts/demand.contract');

/**
 * Validate buyer "Looking for…" post creation.
 * Required: productCategory + a location (lng/lat). Either `text` or `keywords`
 * should be present so the post is matchable.
 */
const validateCreateWant = (req, res, next) => {
  const { text, productCategory, keywords, condition, lng, lat, maxPrice, radiusKm } = req.body;

  if (!productCategory || !String(productCategory).trim()) {
    return res.status(400).json({ success: false, message: 'productCategory is required' });
  }

  const hasText = text && String(text).trim().length > 0;
  const hasKeywords = Array.isArray(keywords) && keywords.length > 0;
  if (!hasText && !hasKeywords) {
    return res
      .status(400)
      .json({ success: false, message: 'Describe what you are looking for (text or keywords)' });
  }

  const nLng = Number(lng);
  const nLat = Number(lat);
  if (!Number.isFinite(nLng) || !Number.isFinite(nLat) || nLng < -180 || nLng > 180 || nLat < -90 || nLat > 90) {
    return res
      .status(400)
      .json({ success: false, message: 'A valid location (lng/lat) is required' });
  }

  if (condition && !POST_CONDITIONS.includes(condition)) {
    return res
      .status(400)
      .json({ success: false, message: `condition must be one of: ${POST_CONDITIONS.join(', ')}` });
  }

  if (maxPrice != null && (!Number.isFinite(Number(maxPrice)) || Number(maxPrice) < 0)) {
    return res.status(400).json({ success: false, message: 'maxPrice must be a non-negative number' });
  }

  if (radiusKm != null && (!Number.isFinite(Number(radiusKm)) || Number(radiusKm) <= 0)) {
    return res.status(400).json({ success: false, message: 'radiusKm must be a positive number' });
  }

  next();
};

module.exports = { validateCreateWant };
