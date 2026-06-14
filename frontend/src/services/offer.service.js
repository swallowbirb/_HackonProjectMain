import api from './api';

export const createOffer = async (data) => {
  const response = await api.post('/offers', data);
  return response.data;
};

export const getOffersByCatalogEntry = async (catalogEntryId) => {
  const response = await api.get(`/offers?catalogEntryId=${catalogEntryId}`);
  return response.data;
};

export const getMyOffers = async () => {
  const response = await api.get('/offers/my');
  return response.data;
};

export const updateOffer = async (id, data) => {
  const response = await api.patch(`/offers/${id}`, data);
  return response.data;
};

export const deleteOffer = async (id) => {
  const response = await api.delete(`/offers/${id}`);
  return response.data;
};
