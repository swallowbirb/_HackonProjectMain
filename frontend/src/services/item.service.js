import api from './api';

export const getItemById = async (itemId) => {
  const response = await api.get(`/items/${itemId}`);
  return response.data;
};

export const getItemStatus = async (itemId) => {
  const response = await api.get(`/items/${itemId}/status`);
  return response.data;
};

export const getItemLogs = async (itemId) => {
  const response = await api.get(`/items/${itemId}/logs`);
  return response.data;
};

/**
 * Poll the dynamic Pass-1 evidence form for an item (v3.44).
 * Returns { readiness: 'pending'|'ready'|'fallback', schema, source }.
 */
export const getEvidenceForm = async (itemId) => {
  const response = await api.get(`/grading/form/${itemId}`);
  return response.data;
};

export const getMyItems = async () => {
  const response = await api.get('/items/my');
  return response.data;
};

/**
 * Add/update previous-owner notes on an item (initiator only, post-grading).
 */
export const updateItemNotes = async (itemId, notes) => {
  const response = await api.patch(`/items/${itemId}/notes`, { notes });
  return response.data;
};

export const getPresignedUrl = async ({ fileName, contentType, itemId }) => {
  const response = await api.post('/uploads/presign', { fileName, contentType, itemId });
  return response.data;
};

/**
 * Upload a File object directly to S3 via presigned URL.
 * Returns the public S3 URL.
 */
export const uploadToS3 = async (file, itemId) => {
  const { data } = await getPresignedUrl({
    fileName: file.name,
    contentType: file.type,
    itemId,
  });

  await fetch(data.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });

  return data.publicUrl;
};

/**
 * Validate a single uploaded photo against an expected subject (v3.44, legacy).
 * Returns { is_valid, issues[] }.
 */
export const validateEvidencePhoto = async ({ photoUrl, itemId, expectedSubject }) => {
  const response = await api.post('/grading/validate-photo', {
    photoUrl, itemId, expectedSubject,
  });
  return response.data;
};

/**
 * Inspect a single uploaded photo at upload time (v2.34 — Evidence Inspector).
 * One multimodal LLM call decides accept / re-upload against the field + catalog
 * product, and the backend persists an Evidence_Fragment on accept.
 * Returns { accepted, reupload_reason, clarity, subject_match, identity_match, ... }.
 */
export const inspectEvidencePhoto = async ({
  photoUrl, itemId, fieldId, fieldLabel, expectedSubject, validationCriteria, reason, category, productId,
}) => {
  const response = await api.post('/grading/inspect-photo', {
    photoUrl, itemId, fieldId, fieldLabel, expectedSubject, validationCriteria, reason, category, productId,
  });
  return response.data;
};

/**
 * Verify a form field's photo SET in one call (v2.35 — "Submit Field").
 *
 * Sends every photo URL the user has uploaded for one field. The backend proxies
 * to ML which makes ONE multimodal LLM call over the set and returns a single
 * field-level decision: accepted / re-upload_reason + per_photo notes +
 * missing_views. On accept the backend persists ONE field-level
 * Evidence_Fragment (replacing any prior fragments for this fieldId).
 */
export const verifyEvidenceField = async ({
  itemId, fieldId, fieldLabel, expectedSubject, validationCriteria,
  photoUrls, reason, category, productId,
}) => {
  const response = await api.post('/grading/verify-field', {
    itemId, fieldId, fieldLabel, expectedSubject, validationCriteria,
    photoUrls, reason, category, productId,
  });
  return response.data;
};
