const Brand = require('./brand.model');
const BrandEnrollment = require('./brandEnrollment.model');
const User = require('../users/user.model');
const Product = require('../products/product.model');

/**
 * Register a new brand. Brand user can only own one brand (enforced here).
 */
const createBrand = async (ownerId, brandData) => {
  const existing = await Brand.findOne({ ownerId }).lean();
  if (existing) {
    throw new Error('You have already registered a brand');
  }

  return await Brand.create({ ...brandData, ownerId });
};

/**
 * Get brand details by ID.
 */
const getBrandById = async (brandId) => {
  return await Brand.findById(brandId).populate('ownerId', 'firstName lastName email').lean();
};

/**
 * Get all brands (public listing).
 */
const getAllBrands = async () => {
  return await Brand.find({}).sort({ createdAt: -1 }).lean();
};

/**
 * Get the brand owned by a specific user.
 */
const getBrandByOwner = async (ownerId) => {
  return await Brand.findOne({ ownerId }).lean();
};

/**
 * Get enrolled sellers with their trust scores.
 * Only returns sellers with 'approved' enrollment status.
 */
const getEnrolledSellers = async (brandId, ownerId) => {
  // Verify ownership
  const brand = await Brand.findOne({ _id: brandId, ownerId }).lean();
  if (!brand) throw new Error('Brand not found or unauthorized');

  const enrollments = await BrandEnrollment.find({ brandId, status: 'approved' })
    .populate('sellerId', 'firstName lastName email storeName averageRating totalReviewsReceived banned suspended')
    .lean();

  return enrollments.map((e) => ({ ...e.sellerId, enrollmentId: e._id }));
};

/**
 * Get all products listed by enrolled sellers under this brand.
 * @deprecated Brand owners are not authorized to view all products of enrolled sellers.
 */
const getEnrolledSellerProducts = async (brandId, ownerId) => {
  throw new Error('Unauthorized: Brand owners are not permitted to track all products of enrolled sellers');
};

/**
 * Get standalone products claiming this brand that have been flagged for manual review.
 */
const getFlaggedProducts = async (brandId, ownerId) => {
  const brand = await Brand.findOne({ _id: brandId, ownerId }).lean();
  if (!brand) throw new Error('Brand not found or unauthorized');

  return await Product.find({
    $or: [
      { brandId },
      { brandName: { $regex: new RegExp(`^${brand.name}$`, 'i') } }
    ],
    status: 'flagged'
  })
    .populate('sellerId', 'firstName lastName email storeName')
    .sort({ createdAt: -1 })
    .lean();
};

/**
 * Get pending enrollment requests for a brand.
 */
const getPendingEnrollments = async (brandId, ownerId) => {
  const brand = await Brand.findOne({ _id: brandId, ownerId }).lean();
  if (!brand) throw new Error('Brand not found or unauthorized');

  return await BrandEnrollment.find({ brandId, status: 'pending' })
    .populate('sellerId', 'firstName lastName email storeName')
    .lean();
};

/**
 * Seller requests enrollment in a brand.
 */
const requestEnrollment = async (brandId, sellerId) => {
  const brand = await Brand.findById(brandId).lean();
  if (!brand) throw new Error('Brand not found');

  return await BrandEnrollment.create({ brandId, sellerId });
};

/**
 * Brand owner approves or rejects an enrollment.
 */
const updateEnrollmentStatus = async (brandId, enrollmentId, ownerId, status) => {
  // Verify brand ownership
  const brand = await Brand.findOne({ _id: brandId, ownerId }).lean();
  if (!brand) throw new Error('Brand not found or unauthorized');

  const enrollment = await BrandEnrollment.findOneAndUpdate(
    { _id: enrollmentId, brandId },
    { $set: { status, reviewedAt: new Date() } },
    { new: true, runValidators: true }
  ).lean();

  if (!enrollment) throw new Error('Enrollment not found');
  return enrollment;
};

/**
 * Get all brands, enriched with this seller's enrollment status for each.
 * Used in the SellerDashboard "Brand Authorization" tab.
 */
const getSellerEnrollments = async (sellerId) => {
  const [allBrands, myEnrollments] = await Promise.all([
    Brand.find({}).sort({ name: 1 }).lean(),
    BrandEnrollment.find({ sellerId }).lean(),
  ]);

  // Build a quick-lookup map: brandId → enrollment
  const enrollmentMap = {};
  myEnrollments.forEach((e) => {
    enrollmentMap[e.brandId.toString()] = e;
  });

  return allBrands.map((brand) => {
    const enrollment = enrollmentMap[brand._id.toString()];
    return {
      ...brand,
      enrollmentStatus: enrollment ? enrollment.status : null,
      enrollmentId: enrollment ? enrollment._id : null,
    };
  });
};

module.exports = {
  createBrand,
  getBrandById,
  getAllBrands,
  getBrandByOwner,
  getEnrolledSellers,
  getEnrolledSellerProducts,
  getFlaggedProducts,
  getPendingEnrollments,
  requestEnrollment,
  updateEnrollmentStatus,
  getSellerEnrollments,
};
