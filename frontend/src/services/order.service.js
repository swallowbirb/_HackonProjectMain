import api from './api';

export const createOrder = async ({ productId, offerId, quantity = 1, mockCreditCard, paymentMethod = 'prepaid' }) => {
  try {
    const response = await api.post('/orders', { productId, offerId, quantity, mockCreditCard, paymentMethod });
    return response.data;
  } catch (error) {
    throw error;
  }
};

// Phase 7.5 — cancel an order (festive mid-transit lock may apply server-side).
export const cancelOrder = async (orderId) => {
  const response = await api.post(`/orders/${orderId}/cancel`);
  return response.data;
};

// Phase 7.5 — demo helper to advance the carrier lifecycle.
export const advanceFulfillment = async (orderId, fulfillmentStatus) => {
  const response = await api.patch(`/orders/${orderId}/fulfillment`, { fulfillmentStatus });
  return response.data;
};

export const getBuyerOrders = async (page = 1, limit = 20) => {
  const response = await api.get('/orders/my', { params: { page, limit } });
  return response.data;
};

export const getSellerOrders = async (page = 1, limit = 20) => {
  const response = await api.get('/orders/seller', { params: { page, limit } });
  return response.data;
};
