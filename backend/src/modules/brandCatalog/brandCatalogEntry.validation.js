/**
 * Validates the body for creating a BrandCatalogEntry.
 */
const validateCreateCatalogEntry = (req, res, next) => {
  if (!req.body.sku || typeof req.body.sku !== 'string' || req.body.sku.trim() === '') {
    req.body.sku = `CAT-${Math.random().toString(36).substring(2, 8).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  }
  const { sku, title, description, category, bulletPoints, officialImages } = req.body;
  const errors = [];

  if (!title || typeof title !== 'string' || title.trim() === '') {
    errors.push('title is required and must be a non-empty string');
  }

  if (!description || typeof description !== 'string' || description.trim() === '') {
    errors.push('description is required and must be a non-empty string');
  }

  if (!category || typeof category !== 'string' || category.trim() === '') {
    errors.push('category is required and must be a non-empty string');
  }

  if (bulletPoints !== undefined) {
    if (!Array.isArray(bulletPoints)) {
      errors.push('bulletPoints must be an array of strings');
    } else if (bulletPoints.length > 5) {
      errors.push('bulletPoints can have at most 5 items');
    } else if (bulletPoints.some((b) => typeof b !== 'string')) {
      errors.push('Each bulletPoint must be a string');
    }
  }

  if (officialImages !== undefined) {
    if (!Array.isArray(officialImages)) {
      errors.push('officialImages must be an array of URL strings');
    } else if (officialImages.some((url) => typeof url !== 'string')) {
      errors.push('Each officialImage must be a URL string');
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors });
  }

  next();
};

/**
 * Validates the body for updating a BrandCatalogEntry (all fields optional).
 */
const validateUpdateCatalogEntry = (req, res, next) => {
  const { title, description, bulletPoints, officialImages } = req.body;
  const errors = [];

  if (title !== undefined && (typeof title !== 'string' || title.trim() === '')) {
    errors.push('title must be a non-empty string');
  }

  if (description !== undefined && (typeof description !== 'string' || description.trim() === '')) {
    errors.push('description must be a non-empty string');
  }

  if (bulletPoints !== undefined) {
    if (!Array.isArray(bulletPoints)) {
      errors.push('bulletPoints must be an array of strings');
    } else if (bulletPoints.length > 5) {
      errors.push('bulletPoints can have at most 5 items');
    }
  }

  if (officialImages !== undefined && !Array.isArray(officialImages)) {
    errors.push('officialImages must be an array of URL strings');
  }

  if (errors.length > 0) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors });
  }

  next();
};

module.exports = {
  validateCreateCatalogEntry,
  validateUpdateCatalogEntry,
};
