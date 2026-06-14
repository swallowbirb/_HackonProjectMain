import api from './api';

export const createReview = async (reviewData) => {
  const response = await api.post('/reviews', reviewData);
  return response.data;
};

export const getReviewsByProduct = async (productId, page = 1, limit = 10) => {
  const response = await api.get(`/reviews/product/${productId}`, { params: { page, limit } });
  return response.data;
};

export const getReviewsByUser = async (userId, page = 1, limit = 10) => {
  const response = await api.get(`/reviews/user/${userId}`, { params: { page, limit } });
  return response.data;
};

export const updateReview = async (id, updateData) => {
  const response = await api.patch(`/reviews/${id}`, updateData);
  return response.data;
};

export const deleteReview = async (id) => {
  const response = await api.delete(`/reviews/${id}`);
  return response.data;
};
