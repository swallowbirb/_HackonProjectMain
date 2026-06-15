import api from './api';

/**
 * Demand Registry API client (Phase A — buyer "Looking for…" posts).
 * Mirrors backend/src/modules/demand/demand.routes.js exactly.
 */

// Create a "Looking for…" post.
// payload: { text, productCategory, keywords?, maxPrice?, condition?, lng, lat, radiusKm? }
export const createWant = (payload) =>
  api.post('/demand', payload).then((r) => r.data?.data ?? r.data);

// Current user's posts.
export const getMyWants = () =>
  api.get('/demand/user').then((r) => r.data?.data ?? r.data);

// Deactivate (soft-delete) a post.
export const deleteWant = (id) =>
  api.delete(`/demand/${id}`).then((r) => r.data?.data ?? r.data);

// Debug match endpoint.
export const matchDemand = (params) =>
  api.get('/demand/match', { params }).then((r) => r.data?.data ?? r.data);

// Admin demand map — normalized demand per warehouse for a search term.
export const getDemandMap = (term) =>
  api.get('/demand/map', { params: { term } }).then((r) => r.data?.data ?? r.data);

// Admin demand map — peer buyers ready right now per warehouse for a search term.
export const getPeerBuyerMap = (term) =>
  api.get('/demand/peer-buyers', { params: { term } }).then((r) => r.data?.data ?? r.data);

// Populator tool — current per-tag population config (with built-in defaults).
export const getPopulatorConfig = () =>
  api.get('/demand/populator').then((r) => r.data?.data ?? r.data);

// Populator tool — replace the per-tag population ("Generate and Replace").
export const savePopulatorConfig = (payload) =>
  api.put('/demand/populator', payload).then((r) => r.data?.data ?? r.data);

// Populator tool — create a new custom tag.
export const addPopulatorTag = (tag) =>
  api.post('/demand/populator/tags', { tag }).then((r) => r.data?.data ?? r.data);

// Populator tool — remove a custom tag.
export const removePopulatorTag = (tag) =>
  api.delete(`/demand/populator/tags/${encodeURIComponent(tag)}`).then((r) => r.data?.data ?? r.data);

// Demo warehouses.
export const getWarehouses = () =>
  api.get('/demand/warehouses').then((r) => r.data?.data ?? r.data);
