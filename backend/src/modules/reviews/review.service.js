const mongoose = require('mongoose');
const Review = require('./review.model');
const Order = require('../orders/order.model');
const Product = require('../products/product.model');
const User = require('../users/user.model');
const BrandCatalogEntry = require('../brandCatalog/brandCatalogEntry.model');

/**
 * Recalculate and update a product's denormalized averageRating and reviewCount.
 */
const recalculateProductStats = async (productId) => {
  const objId = typeof productId === 'string' ? new mongoose.Types.ObjectId(productId) : productId;
  const stats = await Review.aggregate([
    { $match: { productId: objId, isRemoved: false } },
    {
      $group: {
        _id: null,
        averageRating: { $avg: '$rating' },
        reviewCount: { $sum: 1 },
      },
    },
  ]);

  const averageRating = stats.length > 0 ? Math.round(stats[0].averageRating * 10) / 10 : 0;
  const reviewCount = stats.length > 0 ? stats[0].reviewCount : 0;

  const updatedProduct = await Product.findByIdAndUpdate(productId, { averageRating, reviewCount });
  if (!updatedProduct) {
    await BrandCatalogEntry.findByIdAndUpdate(productId, { averageRating, reviewCount });
  }
};

/**
 * Recalculate and update a seller's denormalized averageRating and totalReviewsReceived.
 */
const recalculateSellerStats = async (sellerId) => {
  const stats = await Review.aggregate([
    { $match: { sellerId, isRemoved: false } },
    {
      $group: {
        _id: null,
        averageRating: { $avg: '$rating' },
        totalReviewsReceived: { $sum: 1 },
      },
    },
  ]);

  const averageRating = stats.length > 0 ? Math.round(stats[0].averageRating * 10) / 10 : 0;
  const totalReviewsReceived = stats.length > 0 ? stats[0].totalReviewsReceived : 0;

  await User.findByIdAndUpdate(sellerId, { averageRating, totalReviewsReceived });
};

/**
 * Create a new review.
 * - Verifies buyer hasn't already reviewed this product (compound index handles DB level)
 * - Sets isVerifiedPurchase based on order history
 * - Updates denormalized stats
 */
const createReview = async (reviewData) => {
  const { productId, buyerId, sellerId, rating, title, text, ipAddress, deviceFingerprint } = reviewData;

  // Check for verified purchase (either standalone product or catalog entry)
  const order = await Order.findOne({
    buyerId,
    status: 'completed',
    $or: [{ productId }, { catalogEntryId: productId }],
  }).lean();

  const review = await Review.create({
    productId,
    buyerId,
    sellerId,
    rating,
    title,
    text,
    ipAddress,
    deviceFingerprint,
    isVerifiedPurchase: !!order,
  });

  // Update buyer's review count
  await User.findByIdAndUpdate(buyerId, { $inc: { reviewCount: 1 } });

  // Recalculate product and seller stats
  await recalculateProductStats(productId);
  await recalculateSellerStats(sellerId);

  return review;
};

/**
 * Get paginated reviews for a product.
 */
const getReviewsByProduct = async (productId, page = 1, limit = 10) => {
  const skip = (page - 1) * limit;

  const [reviews, total] = await Promise.all([
    Review.find({ productId, isRemoved: false })
      .populate('buyerId', 'firstName lastName avatarUrl')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Review.countDocuments({ productId, isRemoved: false }),
  ]);

  return { reviews, total, page, limit, totalPages: Math.ceil(total / limit) };
};

/**
 * Get all reviews written by a specific user.
 */
const getReviewsByUser = async (userId, page = 1, limit = 10) => {
  const skip = (page - 1) * limit;

  const [reviews, total] = await Promise.all([
    Review.find({ buyerId: userId, isRemoved: false })
      .populate('productId', 'title images averageRating')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Review.countDocuments({ buyerId: userId, isRemoved: false }),
  ]);

  return { reviews, total, page, limit, totalPages: Math.ceil(total / limit) };
};

/**
 * Update a review (buyer can only edit their own).
 */
const updateReview = async (reviewId, buyerId, updateData) => {
  const review = await Review.findOneAndUpdate(
    { _id: reviewId, buyerId, isRemoved: false },
    { $set: { rating: updateData.rating, title: updateData.title, text: updateData.text } },
    { new: true, runValidators: true }
  ).lean();

  if (review) {
    await recalculateProductStats(review.productId);
    await recalculateSellerStats(review.sellerId);
  }

  return review;
};

/**
 * Delete a review (buyer or admin).
 * Sets isRemoved flag and updates stats.
 */
const deleteReview = async (reviewId, requesterId, isAdmin = false) => {
  const query = isAdmin ? { _id: reviewId } : { _id: reviewId, buyerId: requesterId };
  const review = await Review.findOneAndUpdate(
    query,
    { $set: { isRemoved: true } },
    { new: true }
  ).lean();

  if (review) {
    await recalculateProductStats(review.productId);
    await recalculateSellerStats(review.sellerId);
  }

  return review;
};

module.exports = {
  createReview,
  getReviewsByProduct,
  getReviewsByUser,
  updateReview,
  deleteReview,
  recalculateProductStats,
  recalculateSellerStats,
};
