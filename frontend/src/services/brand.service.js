import api from './api';

export const getAllBrands = async () => {
  const response = await api.get('/brands');
  return response.data;
};

export const getMyBrand = async () => {
  const response = await api.get('/brands/my');
  return response.data;
};

export const createBrand = async (brandData) => {
  const response = await api.post('/brands', brandData);
  return response.data;
};

export const getBrandById = async (id) => {
  const response = await api.get(`/brands/${id}`);
  return response.data;
};

export const getEnrolledSellers = async (brandId) => {
  const response = await api.get(`/brands/${brandId}/sellers`);
  return response.data;
};

export const getEnrolledSellerProducts = async (brandId) => {
  const response = await api.get(`/brands/${brandId}/products`);
  return response.data;
};

export const getPendingEnrollments = async (brandId) => {
  const response = await api.get(`/brands/${brandId}/enrollments/pending`);
  return response.data;
};

export const requestEnrollment = async (brandId) => {
  const response = await api.post(`/brands/${brandId}/enroll`);
  return response.data;
};

export const updateEnrollmentStatus = async (brandId, enrollmentId, status) => {
  const response = await api.patch(`/brands/${brandId}/enrollments/${enrollmentId}`, { status });
  return response.data;
};

export const getSellerEnrollments = async () => {
  const response = await api.get('/brands/seller-enrollments');
  return response.data;
};
