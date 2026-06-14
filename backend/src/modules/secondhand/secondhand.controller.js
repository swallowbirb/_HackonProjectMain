const secondhandService = require('./secondhand.service');

const initiateFromOrder = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { orderId, description, askingPrice, clarifyingPhotos } = req.body;
    const result = await secondhandService.initiateFromOrder(userId, { orderId, description, askingPrice, clarifyingPhotos });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    if (['Order not found or not eligible', 'A sell-used listing already exists for this order', 'A return already exists for this order — you cannot also sell it'].includes(err.message)) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
  }
};

const submitEvidence = async (req, res, next) => {
  try {
    const { photos, fieldImages, additionalNotes } = req.body;
    if (!photos || !Array.isArray(photos) || photos.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one photo is required' });
    }
    const item = await secondhandService.submitEvidence(req.user._id, req.params.itemId, photos, fieldImages, additionalNotes);
    res.status(200).json({ success: true, data: { itemId: item._id, status: item.status } });
  } catch (err) {
    if (err.message === 'Forbidden') return res.status(403).json({ success: false, message: 'Forbidden' });
    if (err.statusCode === 400) {
      return res.status(400).json({ success: false, message: err.message, missingFields: err.missingFields });
    }
    next(err);
  }
};

const getMyListings = async (req, res, next) => {
  try {
    const listings = await secondhandService.getListingsByUser(req.user._id);
    res.status(200).json({ success: true, data: listings });
  } catch (err) {
    next(err);
  }
};

const getListing = async (req, res, next) => {
  try {
    const record = await secondhandService.getListingById(req.params.id, req.user._id);
    if (!record) return res.status(404).json({ success: false, message: 'Not found' });
    res.status(200).json({ success: true, data: record });
  } catch (err) {
    if (err.message === 'Forbidden') return res.status(403).json({ success: false, message: 'Forbidden' });
    next(err);
  }
};

module.exports = { initiateFromOrder, submitEvidence, getMyListings, getListing };
