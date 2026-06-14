const resaleService = require('./resale.service');

const handleKnownErrors = (err, res, next) => {
  if (err.message === 'Forbidden') {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  if (['Listing not found'].includes(err.message)) {
    return res.status(404).json({ success: false, message: err.message });
  }
  if (['Listing already sold', 'Invalid price'].includes(err.message)) {
    return res.status(400).json({ success: false, message: err.message });
  }
  return next(err);
};

/**
 * GET /api/resale — public storefront (published listings).
 */
const getStorefront = async (req, res, next) => {
  try {
    const { category, conditionLane, page, limit } = req.query;
    const data = await resaleService.getStorefront({ category, conditionLane, page, limit });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /api/resale/seller/mine — listings owned by the authenticated seller.
 */
const getSellerListings = async (req, res, next) => {
  try {
    const listings = await resaleService.getSellerListings(req.user._id);
    return res.status(200).json({ success: true, data: listings });
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /api/resale/:id — public listing detail.
 */
const getListing = async (req, res, next) => {
  try {
    const listing = await resaleService.getPublicListing(req.params.id);
    if (!listing) return res.status(404).json({ success: false, message: 'Listing not found' });
    return res.status(200).json({ success: true, data: listing });
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /api/resale/:id/publish
 */
const publish = async (req, res, next) => {
  try {
    const listing = await resaleService.publish(req.params.id, req.user);
    return res.status(200).json({ success: true, data: listing });
  } catch (err) {
    return handleKnownErrors(err, res, next);
  }
};

/**
 * POST /api/resale/:id/unlist
 */
const unlist = async (req, res, next) => {
  try {
    const listing = await resaleService.unlist(req.params.id, req.user);
    return res.status(200).json({ success: true, data: listing });
  } catch (err) {
    return handleKnownErrors(err, res, next);
  }
};

/**
 * PATCH /api/resale/:id/price
 */
const updatePrice = async (req, res, next) => {
  try {
    const listing = await resaleService.updatePrice(req.params.id, req.body.price, req.user);
    return res.status(200).json({ success: true, data: listing });
  } catch (err) {
    return handleKnownErrors(err, res, next);
  }
};

module.exports = { getStorefront, getSellerListings, getListing, publish, unlist, updatePrice };
