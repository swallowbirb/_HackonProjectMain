const gradingService = require('./grading.service');

/**
 * POST /api/grading/trigger
 * Body: Grading_Request_Contract { itemId, userId, productId, reason, imageUrls[], intakePath, category }
 */
const triggerGrading = async (req, res, next) => {
  try {
    const { itemId, userId, productId, reason, imageUrls, intakePath, category } = req.body;

    const grade = await gradingService.triggerGrading(itemId, {
      userId,
      productId,
      reason,
      imageUrls,
      intakePath,
      category,
    });

    return res.status(200).json({ success: true, data: grade });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    return next(error);
  }
};

/**
 * GET /api/grading/:itemId
 */
const getGrade = async (req, res, next) => {
  try {
    const grade = await gradingService.getGradeByItemId(req.params.itemId);
    if (!grade) {
      return res.status(404).json({ success: false, message: 'Grade not found for this item' });
    }
    return res.status(200).json({ success: true, data: grade });
  } catch (error) {
    return next(error);
  }
};

/**
 * GET /api/grading/health — reports ML service reachability.
 */
const health = async (req, res, next) => {
  try {
    const status = await gradingService.checkMlHealth();
    return res.status(200).json({ success: true, data: { module: 'grading', ...status } });
  } catch (error) {
    return next(error);
  }
};

/**
 * GET /api/grading/flagged — flagged grades for seller/admin dashboard (Req 9.4).
 */
const getFlaggedGrades = async (req, res, next) => {
  try {
    const grades = await gradingService.getFlaggedGrades({
      role: req.user.role,
      userId: req.user._id,
    });
    return res.status(200).json({ success: true, data: grades });
  } catch (error) {
    return next(error);
  }
};

/**
 * POST /api/grading/form/:itemId — start Pass 1 form generation (progressive form).
 * GET  /api/grading/form/:itemId — poll for readiness + current schema.
 */
const startForm = async (req, res, next) => {
  try {
    const { itemId } = req.params;
    const { productId, reason, category, initialPhotos } = req.body || {};
    // Fire-and-forget; respond immediately with pending generic form (Req 4.1 / 12.1).
    gradingService.startFormGeneration(itemId, { productId, reason, category, initialPhotos });
    const form = await gradingService.getForm(itemId);
    return res.status(202).json({ success: true, data: form });
  } catch (error) {
    return next(error);
  }
};

const getForm = async (req, res, next) => {
  try {
    const form = await gradingService.getForm(req.params.itemId);
    return res.status(200).json({ success: true, data: form });
  } catch (error) {
    return next(error);
  }
};

/**
 * POST /api/grading/validate-photo — inline per-photo validation (v3.44).
 * Body: { photoUrl, itemId, expectedSubject }
 */
const validatePhoto = async (req, res, next) => {
  try {
    const { photoUrl, itemId, expectedSubject } = req.body || {};
    if (!photoUrl) {
      return res.status(400).json({ success: false, message: 'photoUrl is required' });
    }
    const result = await gradingService.validatePhoto({ photoUrl, itemId, expectedSubject });
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
};

/**
 * POST /api/grading/inspect-photo — per-upload Evidence Inspection (v2.34).
 * Body: { photoUrl, itemId, fieldId, fieldLabel, expectedSubject, reason, category, productId }
 * Returns the inspection result (accepted, reupload_reason, clarity, ...). On accept,
 * a fragment is persisted server-side.
 */
const inspectPhoto = async (req, res, next) => {
  try {
    const { photoUrl, itemId, fieldId, fieldLabel, expectedSubject, validationCriteria,
      reason, category, productId } = req.body || {};
    if (!photoUrl) {
      return res.status(400).json({ success: false, message: 'photoUrl is required' });
    }
    const result = await gradingService.inspectPhoto({
      photoUrl, itemId, fieldId, fieldLabel, expectedSubject, validationCriteria,
      reason, category, productId,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
};

/**
 * POST /api/grading/verify-field — per-field batched Evidence Inspection (v2.35).
 * Body: { itemId, fieldId, fieldLabel, expectedSubject, validationCriteria,
 *         photoUrls: [String], reason, category, productId }
 * Returns the field-level inspection result (accepted, reupload_reason,
 *   per_photo, missing_views, observations, ...). On accept, ONE field-level
 *   fragment is persisted server-side (replacing any prior fragments for this fieldId).
 */
const verifyField = async (req, res, next) => {
  try {
    const { itemId, fieldId, fieldLabel, expectedSubject, validationCriteria,
      photoUrls, reason, category, productId } = req.body || {};
    if (!Array.isArray(photoUrls) || photoUrls.length === 0) {
      return res.status(400).json({ success: false, message: 'photoUrls is required (at least one)' });
    }
    const result = await gradingService.verifyField({
      itemId, fieldId, fieldLabel, expectedSubject, validationCriteria,
      photoUrls, reason, category, productId,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
};

module.exports = { triggerGrading, getGrade, health, getFlaggedGrades, startForm, getForm, validatePhoto, inspectPhoto, verifyField };
