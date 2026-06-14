import api from './api';

/**
 * Phase 7 — Prevention API client.
 * Mirrors backend/src/modules/prevention/prevention.routes.js exactly.
 */

export const getProductInsight = (productId) =>
  api.get(`/prevention/product/${productId}`).then((r) => r.data?.data ?? r.data);

export const getCheckoutRisk = (items) =>
  api.post('/prevention/checkout-risk', { items }).then((r) => r.data?.data ?? r.data);

export const getSellerInsights = () =>
  api.get('/prevention/seller/insights').then((r) => r.data?.data ?? r.data);

export const recomputePrevention = () =>
  api.post('/prevention/recompute').then((r) => r.data?.data ?? r.data);

// Nudge tracking — frontend updates outcome for analytics (§15).
export const updateNudgeEvent = (id, patch) =>
  api.patch(`/prevention/nudge-event/${id}`, patch).then((r) => r.data?.data ?? r.data);

// Refund timing — Phase 4 will consume this internally; UI can display it.
export const getRefundTiming = ({ userId, productId, riskBand }) =>
  api
    .get('/prevention/refund-timing', { params: { userId, productId, riskBand } })
    .then((r) => r.data?.data ?? r.data);

// Analytics dashboard (§20).
export const getPreventionAnalytics = (days = 7) =>
  api.get('/prevention/analytics', { params: { days } }).then((r) => r.data?.data ?? r.data);
