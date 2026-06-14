import api from './api';

export const createProduct = async (productData) => {
  const response = await api.post('/products', productData);
  return response.data;
};

export const getSellerProducts = async () => {
  const response = await api.get('/products/seller/list');
  return response.data;
};

export const getPublishedProducts = async () => {
  const response = await api.get('/products');
  return response.data;
};

export const getProductById = async (id) => {
  const response = await api.get(`/products/${id}`);
  return response.data;
};

export const updateProduct = async (id, updateData) => {
  const response = await api.patch(`/products/${id}`, updateData);
  return response.data;
};

export const deleteProduct = async (id) => {
  const response = await api.delete(`/products/${id}`);
  return response.data;
};

export const searchProducts = async (params = {}) => {
  const response = await api.get('/products/search', { params });
  return response.data;
};

export const getSellerStore = async (sellerId) => {
  const response = await api.get(`/users/${sellerId}/store`);
  return response.data;
};
