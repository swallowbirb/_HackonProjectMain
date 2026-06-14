const Product = require('../products/product.model');
const User = require('../users/user.model');
const Review = require('../reviews/review.model');
const { recalculateProductStats, recalculateSellerStats } = require('../reviews/review.service');

/**
 * Fetch all products with optional filters and pagination.
 * Populates seller name and email from the User collection.
 */
const getAllProducts = async (filters = {}, page = 1, limit = 20) => {
  const query = {};

  if (filters.status) query.status = filters.status;
  if (filters.category) query.category = new RegExp(filters.category, 'i');
  if (filters.banned !== undefined) query.banned = filters.banned === 'true' || filters.banned === true;
  if (filters.suspended !== undefined) query.suspended = filters.suspended === 'true' || filters.suspended === true;
  if (filters.search) {
    query.$or = [
      { title: new RegExp(filters.search, 'i') },
      { description: new RegExp(filters.search, 'i') },
    ];
  }

  const skip = (page - 1) * limit;

  const [products, total] = await Promise.all([
    Product.find(query)
      .populate('sellerId', 'firstName lastName email banned suspended')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments(query),
  ]);

  return { products, total, page, limit, totalPages: Math.ceil(total / limit) };
};

const updateProductStatus = async (productId, status) => {
  return await Product.findByIdAndUpdate(
    productId,
    { $set: { status } },
    { new: true, runValidators: true }
  ).lean();
};

/**
 * Update moderation flags (banned / suspended) for a product.
 */
const updateProductModeration = async (productId, flags) => {
  const update = {};
  if (flags.banned !== undefined) update.banned = flags.banned;
  if (flags.suspended !== undefined) update.suspended = flags.suspended;

  return await Product.findByIdAndUpdate(
    productId,
    { $set: update },
    { new: true, runValidators: true }
  ).lean();
};

/**
 * Fetch all sellers with optional filters and pagination.
 * Includes aggregated product count per seller.
 */
const getAllSellers = async (filters = {}, page = 1, limit = 20) => {
  const query = { role: 'seller' };

  if (filters.banned !== undefined) query.banned = filters.banned === 'true' || filters.banned === true;
  if (filters.suspended !== undefined) query.suspended = filters.suspended === 'true' || filters.suspended === true;
  if (filters.search) {
    query.$or = [
      { firstName: new RegExp(filters.search, 'i') },
      { lastName: new RegExp(filters.search, 'i') },
      { email: new RegExp(filters.search, 'i') },
    ];
  }

  const skip = (page - 1) * limit;

  const [sellers, total] = await Promise.all([
    User.find(query)
      .select('-clerkId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(query),
  ]);

  // Attach product counts to each seller
  const sellerIds = sellers.map((s) => s._id);
  const productCounts = await Product.aggregate([
    { $match: { sellerId: { $in: sellerIds } } },
    { $group: { _id: '$sellerId', count: { $sum: 1 } } },
  ]);

  const countMap = {};
  productCounts.forEach((pc) => { countMap[pc._id.toString()] = pc.count; });

  const sellersWithCounts = sellers.map((seller) => ({
    ...seller,
    productCount: countMap[seller._id.toString()] || 0,
  }));

  return { sellers: sellersWithCounts, total, page, limit, totalPages: Math.ceil(total / limit) };
};

/**
 * Fetch recent products for a specific seller (used in seller row expansion).
 */
const getProductsBySeller = async (sellerId, limit = 5) => {
  return await Product.find({ sellerId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
};

/**
 * Update moderation flags (banned / suspended) for a seller.
 */
const updateSellerModeration = async (sellerId, flags) => {
  const update = {};
  if (flags.banned !== undefined) update.banned = flags.banned;
  if (flags.suspended !== undefined) update.suspended = flags.suspended;

  return await User.findByIdAndUpdate(
    sellerId,
    { $set: update },
    { new: true, runValidators: true }
  ).select('-clerkId').lean();
};

/**
 * Return aggregated platform statistics for the admin dashboard.
 */
const getDashboardStats = async () => {
  const [
    totalProducts,
    productsByStatus,
    totalSellers,
    bannedProducts,
    suspendedProducts,
    bannedSellers,
    suspendedSellers,
  ] = await Promise.all([
    Product.countDocuments(),
    Product.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    User.countDocuments({ role: 'seller' }),
    Product.countDocuments({ banned: true }),
    Product.countDocuments({ suspended: true }),
    User.countDocuments({ role: 'seller', banned: true }),
    User.countDocuments({ role: 'seller', suspended: true }),
  ]);

  const statusMap = { pending: 0, published: 0, approved: 0, flagged: 0, rejected: 0 };
  productsByStatus.forEach((s) => { if (statusMap[s._id] !== undefined) statusMap[s._id] = s.count; });

  return {
    products: {
      total: totalProducts,
      byStatus: statusMap,
      banned: bannedProducts,
      suspended: suspendedProducts,
    },
    sellers: {
      total: totalSellers,
      banned: bannedSellers,
      suspended: suspendedSellers,
    },
  };
};

/**
 * Fetch all reviews with optional filters and pagination.
 */
const getAllReviews = async (filters = {}, page = 1, limit = 20) => {
  const query = {};

  if (filters.isFlagged !== undefined) query.isFlagged = filters.isFlagged === 'true' || filters.isFlagged === true;
  if (filters.isRemoved !== undefined) query.isRemoved = filters.isRemoved === 'true' || filters.isRemoved === true;
  if (filters.productId) query.productId = filters.productId;
  if (filters.sellerId) query.sellerId = filters.sellerId;

  const skip = (page - 1) * limit;

  const [reviews, total] = await Promise.all([
    Review.find(query)
      .populate('buyerId', 'firstName lastName email')
      .populate('productId', 'title')
      .populate('sellerId', 'firstName lastName email storeName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Review.countDocuments(query),
  ]);

  return { reviews, total, page, limit, totalPages: Math.ceil(total / limit) };
};

/**
 * Admin remove or restore a review and update isRemoved flag.
 * Also recalculates product and seller stats.
 */
const moderateReview = async (reviewId, flags) => {
  const update = {};
  if (flags.isRemoved !== undefined) update.isRemoved = flags.isRemoved;
  if (flags.removedReason !== undefined) update.removedReason = flags.removedReason;
  if (flags.isFlagged !== undefined) update.isFlagged = flags.isFlagged;

  const review = await Review.findByIdAndUpdate(
    reviewId,
    { $set: update },
    { new: true, runValidators: true }
  ).lean();

  if (review) {
    await recalculateProductStats(review.productId);
    await recalculateSellerStats(review.sellerId);
  }

  return review;
};

module.exports = {
  getAllProducts,
  updateProductStatus,
  updateProductModeration,
  getAllSellers,
  getProductsBySeller,
  updateSellerModeration,
  getDashboardStats,
  getAllReviews,
  moderateReview,
};
