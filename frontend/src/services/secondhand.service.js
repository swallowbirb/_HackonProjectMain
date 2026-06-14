import api from './api';

export const initiateFromOrder = async ({ orderId, description, askingPrice, clarifyingPhotos }) => {
  const response = await api.post('/secondhand/from-order', { orderId, description, askingPrice, clarifyingPhotos });
  return response.data;
};

export const submitSecondhandEvidence = async (itemId, photos, fieldImages, additionalNotes) => {
  const response = await api.post(`/secondhand/${itemId}/evidence`, { photos, fieldImages, additionalNotes });
  return response.data;
};

export const getMySecondhandListings = async () => {
  const response = await api.get('/secondhand/my');
  return response.data;
};
