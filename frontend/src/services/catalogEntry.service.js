import api from './api';

export const createCatalogEntry = async (data) => {
  const response = await api.post('/brand-catalog', data);
  return response.data;
};

export const getCatalogEntriesByBrand = async (brandId) => {
  const response = await api.get(`/brand-catalog?brandId=${brandId}`);
  return response.data;
};

export const getMyCatalogEntries = async () => {
  const response = await api.get('/brand-catalog/my');
  return response.data;
};

export const getCatalogEntryById = async (id) => {
  const response = await api.get(`/brand-catalog/${id}`);
  return response.data;
};

export const updateCatalogEntry = async (id, data) => {
  const response = await api.patch(`/brand-catalog/${id}`, data);
  return response.data;
};

export const deleteCatalogEntry = async (id) => {
  const response = await api.delete(`/brand-catalog/${id}`);
  return response.data;
};
