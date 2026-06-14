import api from './api';

/**
 * Public storefront — published resale listings, optional category/condition filter.
 */
export const getResaleStorefront = async (params = {}) => {
  const response = await api.get('/resale', { params });
  return response.data;
};

/**
 * Public resale listing detail.
 */
export const getResaleListing = async (id) => {
  const response = await api.get(`/resale/${id}`);
  return response.data;
};

/**
 * Seller's own resale listings (any status).
 */
export const getMyResaleListings = async () => {
  const response = await api.get('/resale/seller/mine');
  return response.data;
};

export const publishResaleListing = async (id) => {
  const response = await api.post(`/resale/${id}/publish`);
  return response.data;
};

export const unlistResaleListing = async (id) => {
  const response = await api.post(`/resale/${id}/unlist`);
  return response.data;
};

export const updateResalePrice = async (id, price) => {
  const response = await api.patch(`/resale/${id}/price`, { price });
  return response.data;
};
