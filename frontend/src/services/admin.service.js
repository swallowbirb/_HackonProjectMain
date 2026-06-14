import api from './api';

/**
 * Build a query string from a filters object, omitting undefined/null/empty values.
 */
const buildParams = (filters = {}) => {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, value);
    }
  });
  return params.toString();
};

// ─── Dashboard Stats ──────────────────────────────────────────────────────────

export const getStats = async () => {
  const { data } = await api.get('/admin/stats');
  return data.data;
};

// ─── Products ─────────────────────────────────────────────────────────────────

export const getAdminProducts = async (filters = {}) => {
  const qs = buildParams(filters);
  const { data } = await api.get(`/admin/products${qs ? `?${qs}` : ''}`);
  return data.data;
};

export const updateProductStatus = async (productId, status) => {
  const { data } = await api.patch(`/admin/products/${productId}/status`, { status });
  return data.data;
};

export const updateProductModeration = async (productId, flags) => {
  const { data } = await api.patch(`/admin/products/${productId}/moderation`, flags);
  return data.data;
};

// ─── Sellers ──────────────────────────────────────────────────────────────────

export const getAdminSellers = async (filters = {}) => {
  const qs = buildParams(filters);
  const { data } = await api.get(`/admin/sellers${qs ? `?${qs}` : ''}`);
  return data.data;
};

export const getSellerProducts = async (sellerId) => {
  const { data } = await api.get(`/admin/sellers/${sellerId}/products`);
  return data.data;
};

export const updateSellerModeration = async (sellerId, flags) => {
  const { data } = await api.patch(`/admin/sellers/${sellerId}/moderation`, flags);
  return data.data;
};

// ─── Reviews ──────────────────────────────────────────────────────────────────

export const getAdminReviews = async (filters = {}) => {
  const qs = buildParams(filters);
  const { data } = await api.get(`/admin/reviews${qs ? `?${qs}` : ''}`);
  return data.data;
};

export const moderateReview = async (reviewId, update = {}) => {
  const { data } = await api.patch(`/admin/reviews/${reviewId}/moderation`, update);
  return data.data;
};

