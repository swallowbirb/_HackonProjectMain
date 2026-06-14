const validateCreateProduct = (req, res, next) => {
  const { title, description, price, category, images, brandName, condition } = req.body;
  const errors = [];

  if (!title || typeof title !== 'string' || title.trim() === '') {
    errors.push('Title is required and must be a string');
  }

  if (!description || typeof description !== 'string' || description.trim() === '') {
    errors.push('Description is required and must be a string');
  }

  if (price === undefined || typeof price !== 'number' || price < 0) {
    errors.push('Price is required and must be a positive number');
  }

  if (!category || typeof category !== 'string' || category.trim() === '') {
    errors.push('Category is required and must be a string');
  }

  // Optional: images must be an array of strings if provided
  if (images !== undefined) {
    if (!Array.isArray(images)) {
      errors.push('images must be an array of URLs');
    } else if (images.some((url) => typeof url !== 'string')) {
      errors.push('Each image must be a URL string');
    }
  }

  // Optional: brandName must be a string if provided (free-text honeypot field)
  if (brandName !== undefined && (typeof brandName !== 'string' || brandName.trim() === '')) {
    errors.push('brandName must be a non-empty string');
  }

  // Optional: condition must be 'New' or 'Used' if provided
  if (condition !== undefined && !['New', 'Used'].includes(condition)) {
    errors.push("condition must be either 'New' or 'Used'");
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors,
    });
  }

  next();
};

const validateUpdateProduct = (req, res, next) => {
  const { title, description, price, category, images, brandName, condition,
    gradingInstructions, imageAngles, imageHints } = req.body;
  const errors = [];

  // v2.34 — per-product AI grading instructions (seller prompt overlay).
  if (gradingInstructions !== undefined) {
    if (typeof gradingInstructions !== 'string') {
      errors.push('gradingInstructions must be a string');
    } else if (gradingInstructions.length > 4000) {
      errors.push('gradingInstructions must be 4000 characters or fewer');
    }
  }

  // v2.34 — seller-tagged angle reference images: { front, side_left, side_right, rear }.
  if (imageAngles !== undefined &&
      (typeof imageAngles !== 'object' || imageAngles === null || Array.isArray(imageAngles))) {
    errors.push('imageAngles must be an object of { angle: imageUrl }');
  }

  // v2.34 — per-image hints for Pass-1 form generation.
  if (imageHints !== undefined) {
    if (!Array.isArray(imageHints)) {
      errors.push('imageHints must be an array of { url, hint } objects');
    } else {
      for (const h of imageHints) {
        if (typeof h !== 'object' || typeof h.url !== 'string' || typeof h.hint !== 'string') {
          errors.push('Each imageHints entry must have a string url and a string hint');
          break;
        }
        if (h.label !== undefined && typeof h.label !== 'string') {
          errors.push('Each imageHints label must be a string');
          break;
        }
        if (h.hint.length > 400) {
          errors.push('Each imageHints hint must be 400 characters or fewer');
          break;
        }
      }
    }
  }

  if (title !== undefined && (typeof title !== 'string' || title.trim() === '')) {
    errors.push('Title must be a non-empty string');
  }

  if (description !== undefined && (typeof description !== 'string' || description.trim() === '')) {
    errors.push('Description must be a non-empty string');
  }

  if (price !== undefined && (typeof price !== 'number' || price < 0)) {
    errors.push('Price must be a positive number');
  }

  if (category !== undefined && (typeof category !== 'string' || category.trim() === '')) {
    errors.push('Category must be a non-empty string');
  }

  if (images !== undefined) {
    if (!Array.isArray(images)) {
      errors.push('images must be an array of URLs');
    } else if (images.some((url) => typeof url !== 'string')) {
      errors.push('Each image must be a URL string');
    }
  }

  if (brandName !== undefined && (typeof brandName !== 'string' || brandName.trim() === '')) {
    errors.push('brandName must be a non-empty string');
  }

  if (condition !== undefined && !['New', 'Used'].includes(condition)) {
    errors.push("condition must be either 'New' or 'Used'");
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors,
    });
  }

  next();
};

module.exports = {
  validateCreateProduct,
  validateUpdateProduct,
};
