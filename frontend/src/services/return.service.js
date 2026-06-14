import api from './api';

export const initiateReturn = async ({ orderId, reasonCode, reasonText, clarifyingPhotos }) => {
  const response = await api.post('/returns', { orderId, reasonCode, reasonText, clarifyingPhotos });
  return response.data;
};

export const submitReturnEvidence = async (itemId, photos, fieldImages, additionalNotes) => {
  const response = await api.post(`/returns/${itemId}/evidence`, { photos, fieldImages, additionalNotes });
  return response.data;
};

export const getMyReturns = async () => {
  const response = await api.get('/returns/my');
  return response.data;
};

export const getReturnById = async (returnId) => {
  const response = await api.get(`/returns/${returnId}`);
  return response.data;
};
