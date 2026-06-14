const SellerOffer = require('./sellerOffer.model');
const BrandCatalogEntry = require('../brandCatalog/brandCatalogEntry.model');

/**
 * Recomputes the Buy Box winner for a catalog entry.
 * The winner is the single cheapest ACTIVE offer.
 * Called on every offer create, update, and delete.
 */
const recomputeBuyBox = async (catalogEntryId) => {
  // Clear all existing winners for this entry first
  await SellerOffer.updateMany({ catalogEntryId }, { $set: { isBuyBoxWinner: false } });

  // Find the cheapest active offer
  const cheapest = await SellerOffer.findOne({ catalogEntryId, status: 'active' })
    .sort({ price: 1 })
    .select('_id')
    .lean();

  if (cheapest) {
    await SellerOffer.findByIdAndUpdate(cheapest._id, { $set: { isBuyBoxWinner: true } });
  }

  // Update denormalized activeOfferCount on the catalog entry
  const activeCount = await SellerOffer.countDocuments({ catalogEntryId, status: 'active' });
  await BrandCatalogEntry.findByIdAndUpdate(catalogEntryId, { $set: { activeOfferCount: activeCount } });
};

/**
 * Seller creates an offer on an existing catalog entry.
 * A seller can only have ONE offer per catalog entry (enforced by DB unique index).
 */
const createOffer = async (sellerId, data) => {
  const { catalogEntryId, price, condition, quantity, shippingNote } = data;

  // Verify the catalog entry exists and is active
  const entry = await BrandCatalogEntry.findOne({ _id: catalogEntryId, isActive: true }).lean();
  if (!entry) throw new Error('Catalog entry not found or inactive');

  const offer = await SellerOffer.create({
    catalogEntryId,
    sellerId,
    price,
    condition,
    quantity,
    shippingNote,
    status: 'active',
  });

  await recomputeBuyBox(catalogEntryId);

  return offer;
};

/**
 * Get all active offers for a catalog entry — public.
 * Sorted cheapest first (Buy Box winner will be at top).
 */
const getOffersByCatalogEntry = async (catalogEntryId) => {
  return await SellerOffer.find({ catalogEntryId, status: 'active' })
    .populate('sellerId', 'firstName lastName storeName averageRating')
    .sort({ price: 1 })
    .lean();
};

/**
 * Get all offers made by a specific seller.
 */
const getOffersBySeller = async (sellerId) => {
  return await SellerOffer.find({ sellerId })
    .populate('catalogEntryId', 'title officialImages sku brandId category')
    .sort({ createdAt: -1 })
    .lean();
};

/**
 * Seller updates their offer (price, condition, quantity, shippingNote).
 * Triggers Buy Box recomputation after update.
 */
const updateOffer = async (offerId, sellerId, data) => {
  // Strip fields the seller is not allowed to change
  const { price, condition, quantity, shippingNote, status } = data;
  const updateData = {};
  if (price !== undefined) updateData.price = price;
  if (condition !== undefined) updateData.condition = condition;
  if (quantity !== undefined) updateData.quantity = quantity;
  if (shippingNote !== undefined) updateData.shippingNote = shippingNote;
  if (status !== undefined && ['active', 'inactive'].includes(status)) updateData.status = status;

  const offer = await SellerOffer.findOneAndUpdate(
    { _id: offerId, sellerId },
    { $set: updateData },
    { new: true, runValidators: true }
  ).lean();

  if (!offer) throw new Error('Offer not found or unauthorized');

  await recomputeBuyBox(offer.catalogEntryId);

  return offer;
};

/**
 * Seller removes their offer.
 * Triggers Buy Box recomputation so the next cheapest offer wins.
 */
const deleteOffer = async (offerId, sellerId) => {
  const offer = await SellerOffer.findOneAndDelete({ _id: offerId, sellerId }).lean();
  if (!offer) throw new Error('Offer not found or unauthorized');

  await recomputeBuyBox(offer.catalogEntryId);

  return offer;
};

module.exports = {
  createOffer,
  getOffersByCatalogEntry,
  getOffersBySeller,
  updateOffer,
  deleteOffer,
  recomputeBuyBox,
};
