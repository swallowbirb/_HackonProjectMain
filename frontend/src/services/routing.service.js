import api from './api';

/**
 * Routing API client (Phase A — smart disposition engine).
 * Mirrors backend/src/modules/routing/routing.routes.js.
 */

// Compute (or recompute) a routing decision for a graded item.
// payload: { itemId, sellerLocation?, counterfeit?, hazardous? }
export const computeRouting = (payload) =>
  api.post('/routing/compute', payload).then((r) => r.data?.data ?? r.data);

// Fetch the stored decision for an item.
export const getRoutingDecision = (itemId) =>
  api.get(`/routing/${itemId}`).then((r) => r.data?.data ?? r.data);
