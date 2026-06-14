const BrandCatalogEntry = require('./brandCatalogEntry.model');
const Brand = require('../brands/brand.model');

/**
 * Brand creates a new catalog entry (ASIN-equivalent).
 * Verifies the caller owns the brand before creating.
 */
const createCatalogEntry = async (ownerId, data) => {
  // Verify the brand belongs to this user
  const brand = await Brand.findOne({ ownerId }).lean();
  if (!brand) throw new Error('Brand not found or unauthorized');

  const entry = await BrandCatalogEntry.create({
    ...data,
    brandId: brand._id,
  });

  // Increment denormalized count on Brand
  await Brand.findByIdAndUpdate(brand._id, { $inc: { catalogEntryCount: 1 } });

  return entry;
};

/**
 * List all active catalog entries for a brand — public.
 */
const getCatalogEntriesByBrand = async (brandId) => {
  return await BrandCatalogEntry.find({ brandId, isActive: true })
    .populate('brandId', 'name logoUrl isVerified')
    .sort({ createdAt: -1 })
    .lean();
};

/**
 * Get a single catalog entry by ID — public.
 */
const getCatalogEntryById = async (entryId) => {
  return await BrandCatalogEntry.findById(entryId)
    .populate('brandId', 'name logoUrl isVerified category')
    .lean();
};

/**
 * Brand updates their own catalog entry.
 * ownerId is checked against the brand to enforce ownership.
 */
const updateCatalogEntry = async (entryId, ownerId, data) => {
  const brand = await Brand.findOne({ ownerId }).lean();
  if (!brand) throw new Error('Brand not found or unauthorized');

  const entry = await BrandCatalogEntry.findOneAndUpdate(
    { _id: entryId, brandId: brand._id },
    { $set: data },
    { new: true, runValidators: true }
  ).lean();

  if (!entry) throw new Error('Catalog entry not found or unauthorized');
  return entry;
};

/**
 * Soft-delete: sets isActive = false.
 * Entry remains in DB as a reference for AI counterfeit comparison.
 */
const deleteCatalogEntry = async (entryId, ownerId) => {
  const brand = await Brand.findOne({ ownerId }).lean();
  if (!brand) throw new Error('Brand not found or unauthorized');

  const entry = await BrandCatalogEntry.findOneAndUpdate(
    { _id: entryId, brandId: brand._id },
    { $set: { isActive: false } },
    { new: true }
  ).lean();

  if (!entry) throw new Error('Catalog entry not found or unauthorized');

  // Decrement denormalized count on Brand
  await Brand.findByIdAndUpdate(brand._id, { $inc: { catalogEntryCount: -1 } });

  return entry;
};

/**
 * Get all catalog entries owned by a brand — used internally by brand dashboard.
 * Includes inactive entries so the brand can see the full picture.
 */
const getMyCatalogEntries = async (ownerId) => {
  const brand = await Brand.findOne({ ownerId }).lean();
  if (!brand) throw new Error('Brand not found');

  return await BrandCatalogEntry.find({ brandId: brand._id })
    .sort({ createdAt: -1 })
    .lean();
};

module.exports = {
  createCatalogEntry,
  getCatalogEntriesByBrand,
  getCatalogEntryById,
  updateCatalogEntry,
  deleteCatalogEntry,
  getMyCatalogEntries,
};
