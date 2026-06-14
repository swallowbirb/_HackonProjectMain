const offerService = require('./sellerOffer.service');

const createOffer = async (req, res, next) => {
  try {
    const offer = await offerService.createOffer(req.user._id, req.body);
    res.status(201).json({ success: true, data: offer });
  } catch (error) {
    next(error);
  }
};

const getOffersByCatalogEntry = async (req, res, next) => {
  try {
    const { catalogEntryId } = req.query;
    if (!catalogEntryId) {
      return res.status(400).json({ success: false, message: 'catalogEntryId query parameter is required' });
    }
    const offers = await offerService.getOffersByCatalogEntry(catalogEntryId);
    res.status(200).json({ success: true, data: offers });
  } catch (error) {
    next(error);
  }
};

const getMyOffers = async (req, res, next) => {
  try {
    const offers = await offerService.getOffersBySeller(req.user._id);
    res.status(200).json({ success: true, data: offers });
  } catch (error) {
    next(error);
  }
};

const updateOffer = async (req, res, next) => {
  try {
    const offer = await offerService.updateOffer(req.params.id, req.user._id, req.body);
    res.status(200).json({ success: true, data: offer });
  } catch (error) {
    next(error);
  }
};

const deleteOffer = async (req, res, next) => {
  try {
    await offerService.deleteOffer(req.params.id, req.user._id);
    res.status(200).json({ success: true, message: 'Offer removed' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createOffer,
  getOffersByCatalogEntry,
  getMyOffers,
  updateOffer,
  deleteOffer,
};
