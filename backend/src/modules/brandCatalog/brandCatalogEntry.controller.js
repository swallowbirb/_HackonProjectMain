const catalogService = require('./brandCatalogEntry.service');

const createCatalogEntry = async (req, res, next) => {
  try {
    const entry = await catalogService.createCatalogEntry(req.user._id, req.body);
    res.status(201).json({ success: true, data: entry });
  } catch (error) {
    next(error);
  }
};

const getCatalogEntriesByBrand = async (req, res, next) => {
  try {
    const { brandId } = req.query;
    if (!brandId) {
      return res.status(400).json({ success: false, message: 'brandId query parameter is required' });
    }
    const entries = await catalogService.getCatalogEntriesByBrand(brandId);
    res.status(200).json({ success: true, data: entries });
  } catch (error) {
    next(error);
  }
};

const getCatalogEntryById = async (req, res, next) => {
  try {
    const entry = await catalogService.getCatalogEntryById(req.params.id);
    if (!entry) {
      return res.status(404).json({ success: false, message: 'Catalog entry not found' });
    }
    res.status(200).json({ success: true, data: entry });
  } catch (error) {
    next(error);
  }
};

const updateCatalogEntry = async (req, res, next) => {
  try {
    const entry = await catalogService.updateCatalogEntry(req.params.id, req.user._id, req.body);
    res.status(200).json({ success: true, data: entry });
  } catch (error) {
    next(error);
  }
};

const deleteCatalogEntry = async (req, res, next) => {
  try {
    await catalogService.deleteCatalogEntry(req.params.id, req.user._id);
    res.status(200).json({ success: true, message: 'Catalog entry removed' });
  } catch (error) {
    next(error);
  }
};

const getMyCatalogEntries = async (req, res, next) => {
  try {
    const entries = await catalogService.getMyCatalogEntries(req.user._id);
    res.status(200).json({ success: true, data: entries });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createCatalogEntry,
  getCatalogEntriesByBrand,
  getCatalogEntryById,
  updateCatalogEntry,
  deleteCatalogEntry,
  getMyCatalogEntries,
};
