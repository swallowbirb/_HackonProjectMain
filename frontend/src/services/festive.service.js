import api from './api';

/**
 * Phase 7.5 — Festive Defense API client.
 * Mirrors backend/src/modules/festive/festive.routes.js.
 */

// Currently-active festive event (or null) + its policies.
export const getActiveFestive = () =>
  api.get('/festive/active').then((r) => r.data?.data ?? r.data);

// Tier × cart COD decision for the checkout UI.
export const getPaymentPolicy = (cartTotal = 0) =>
  api
    .get('/festive/payment-policy', { params: { cartTotal } })
    .then((r) => r.data?.data ?? r.data);

// Effective return-window days for an order placed now.
export const getReturnWindow = (reasonCode) =>
  api
    .get('/festive/return-window', { params: reasonCode ? { reasonCode } : {} })
    .then((r) => r.data?.data ?? r.data);

// Admin/dev — full calendar + demo override toggle.
export const getFestiveCalendar = () =>
  api.get('/festive/calendar').then((r) => r.data?.data ?? r.data);

export const setFestiveOverride = (instanceKey, on = true) =>
  api.post('/festive/override', { instanceKey, on }).then((r) => r.data?.data ?? r.data);
