import api from './api';

/**
 * User impact summary — CO2/water totals + green-credit balance + recent ledger.
 */
export const getUserImpact = async (userId) => {
  const response = await api.get(`/sustainability/user/${userId}`);
  return response.data;
};

/**
 * Per-item impact (resale PDP badge).
 */
export const getItemImpact = async (itemId) => {
  const response = await api.get(`/sustainability/item/${itemId}`);
  return response.data;
};

/**
 * Full donation summary for an item (NGO, credits, impact, receipt availability).
 */
export const getDonationDetails = async (itemId) => {
  const response = await api.get(`/sustainability/donation/${itemId}`);
  return response.data;
};

/**
 * Platform-wide totals.
 */
export const getPlatformImpact = async () => {
  const response = await api.get('/sustainability/platform');
  return response.data;
};

/**
 * Donate an item — matches an NGO, awards credits, generates a receipt.
 * Optional location { lng, lat } improves NGO matching.
 */
export const donateItem = async (itemId, location) => {
  const response = await api.post(`/sustainability/donate/${itemId}`, location || {});
  return response.data;
};

/**
 * Absolute URL for the donation receipt PDF (open in a new tab / download).
 */
export const getReceiptUrl = (itemId) => {
  const base = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
  return `${base}/sustainability/receipt/${itemId}`;
};

/**
 * Redeem credits for a ₹ discount at checkout.
 */
export const redeemCredits = async (amount, orderId) => {
  const response = await api.post('/sustainability/redeem', { amount, orderId });
  return response.data;
};
