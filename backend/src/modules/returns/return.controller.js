const returnService = require('./return.service');

const initiateReturn = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { orderId, reasonCode, reasonText, clarifyingPhotos } = req.body;
    const result = await returnService.initiateReturn(userId, { orderId, reasonCode, reasonText, clarifyingPhotos });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    if (err.statusCode === 400 || err.code === 'CLAIM_IMPLAUSIBLE') {
      return res.status(400).json({ success: false, message: err.message });
    }
    if (['Order not found or not eligible for return', 'Return window expired', 'A return already exists for this order', 'A sell-used listing already exists for this order — you cannot also return it'].includes(err.message)) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
  }
};

const submitEvidence = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { itemId } = req.params;
    const { photos, fieldImages, additionalNotes } = req.body;

    if (!photos || !Array.isArray(photos) || photos.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one photo is required' });
    }

    const item = await returnService.submitEvidence(userId, itemId, photos, fieldImages, additionalNotes);
    res.status(200).json({ success: true, data: { itemId: item._id, status: item.status } });
  } catch (err) {
    if (err.message === 'Forbidden') return res.status(403).json({ success: false, message: 'Forbidden' });
    if (err.statusCode === 400) {
      return res.status(400).json({ success: false, message: err.message, missingFields: err.missingFields });
    }
    next(err);
  }
};

const getMyReturns = async (req, res, next) => {
  try {
    const returns = await returnService.getReturnsByUser(req.user._id);
    res.status(200).json({ success: true, data: returns });
  } catch (err) {
    next(err);
  }
};

const getReturn = async (req, res, next) => {
  try {
    const record = await returnService.getReturnById(req.params.returnId, req.user._id);
    if (!record) return res.status(404).json({ success: false, message: 'Return not found' });
    res.status(200).json({ success: true, data: record });
  } catch (err) {
    if (err.message === 'Forbidden') return res.status(403).json({ success: false, message: 'Forbidden' });
    next(err);
  }
};

module.exports = { initiateReturn, submitEvidence, getMyReturns, getReturn };
