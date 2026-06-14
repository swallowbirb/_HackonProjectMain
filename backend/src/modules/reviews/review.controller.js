const reviewService = require('./review.service');
const Product = require('../products/product.model');

const createReview = async (req, res, next) => {
  try {
    const buyerId = req.user._id;
    const { productId, rating, title, text } = req.body;

    let sellerId;

    // Fetch product to get sellerId
    const product = await Product.findById(productId).select('sellerId status').lean();
    if (product) {
      if (product.status !== 'published' && product.status !== 'approved') {
        return res.status(400).json({ success: false, message: 'Cannot review an unpublished product' });
      }
      sellerId = product.sellerId;
    } else {
      // Check if it's a BrandCatalogEntry
      const BrandCatalogEntry = require('../brandCatalog/brandCatalogEntry.model');
      const catalogEntry = await BrandCatalogEntry.findById(productId).populate('brandId').lean();
      if (!catalogEntry) {
        return res.status(404).json({ success: false, message: 'Product or Catalog Entry not found' });
      }
      if (catalogEntry.isActive === false) {
        return res.status(400).json({ success: false, message: 'Cannot review an inactive catalog entry' });
      }

      // Try to find if user has a completed order for this catalog entry
      const Order = require('../orders/order.model');
      const order = await Order.findOne({
        buyerId,
        catalogEntryId: productId,
        status: 'completed',
      }).select('sellerId').lean();

      if (order) {
        sellerId = order.sellerId;
      } else {
        // Fallback 1: Buy box winner or any active offer for this catalog entry
        const SellerOffer = require('../offers/sellerOffer.model');
        const activeOffer = await SellerOffer.findOne({ catalogEntryId: productId, status: 'active' })
          .select('sellerId')
          .lean();
        if (activeOffer) {
          sellerId = activeOffer.sellerId;
        } else {
          // Fallback 2: The brand owner
          sellerId = catalogEntry.brandId?.ownerId;
        }
      }

      if (!sellerId) {
        return res.status(400).json({ success: false, message: 'No seller or brand owner found for this catalog entry' });
      }
    }

    const ipAddress = req.ip || req.headers['x-forwarded-for'];
    const deviceFingerprint = req.headers['user-agent'];

    const review = await reviewService.createReview({
      productId,
      buyerId,
      sellerId,
      rating,
      title,
      text,
      ipAddress,
      deviceFingerprint,
    });

    res.status(201).json({ success: true, data: review });
  } catch (error) {
    // MongoDB duplicate key error = buyer already reviewed this product
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'You have already reviewed this product',
      });
    }
    next(error);
  }
};

const getReviewsByProduct = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const result = await reviewService.getReviewsByProduct(productId, Number(page), Number(limit));
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

const getReviewsByUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const result = await reviewService.getReviewsByUser(userId, Number(page), Number(limit));
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

const updateReview = async (req, res, next) => {
  try {
    const buyerId = req.user._id;
    const { id } = req.params;
    const { rating, title, text } = req.body;

    const review = await reviewService.updateReview(id, buyerId, { rating, title, text });
    if (!review) {
      return res.status(404).json({ success: false, message: 'Review not found or unauthorized' });
    }

    res.status(200).json({ success: true, data: review });
  } catch (error) {
    next(error);
  }
};

const deleteReview = async (req, res, next) => {
  try {
    const { id } = req.params;
    const isAdmin = req.user.role === 'admin';
    const requesterId = req.user._id;

    const review = await reviewService.deleteReview(id, requesterId, isAdmin);
    if (!review) {
      return res.status(404).json({ success: false, message: 'Review not found or unauthorized' });
    }

    res.status(200).json({ success: true, message: 'Review deleted successfully' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createReview,
  getReviewsByProduct,
  getReviewsByUser,
  updateReview,
  deleteReview,
};
