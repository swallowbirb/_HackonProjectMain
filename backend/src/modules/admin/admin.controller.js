const adminService = require('./admin.service');

const getProducts = async (req, res, next) => {
  try {
    const { status, category, banned, suspended, search, page = 1, limit = 20 } = req.query;
    const filters = { status, category, banned, suspended, search };

    const result = await adminService.getAllProducts(filters, Number(page), Number(limit));

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

const updateProductStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const product = await adminService.updateProductStatus(id, status);

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    res.status(200).json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
};

const updateProductModeration = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { banned, suspended } = req.body;

    const product = await adminService.updateProductModeration(id, { banned, suspended });

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    res.status(200).json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
};

const getSellers = async (req, res, next) => {
  try {
    const { banned, suspended, search, page = 1, limit = 20 } = req.query;
    const filters = { banned, suspended, search };

    const result = await adminService.getAllSellers(filters, Number(page), Number(limit));

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

const getSellerProducts = async (req, res, next) => {
  try {
    const { id } = req.params;
    const products = await adminService.getProductsBySeller(id);
    res.status(200).json({ success: true, data: products });
  } catch (error) {
    next(error);
  }
};

const updateSellerModeration = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { banned, suspended } = req.body;

    const seller = await adminService.updateSellerModeration(id, { banned, suspended });

    if (!seller) {
      return res.status(404).json({ success: false, message: 'Seller not found' });
    }

    res.status(200).json({ success: true, data: seller });
  } catch (error) {
    next(error);
  }
};

const getDashboardStats = async (req, res, next) => {
  try {
    const stats = await adminService.getDashboardStats();
    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
};

const getReviews = async (req, res, next) => {
  try {
    const { isFlagged, isRemoved, productId, sellerId, page = 1, limit = 20 } = req.query;
    const filters = { isFlagged, isRemoved, productId, sellerId };

    const result = await adminService.getAllReviews(filters, Number(page), Number(limit));
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

const moderateReview = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { isRemoved, removedReason, isFlagged } = req.body;

    const review = await adminService.moderateReview(id, { isRemoved, removedReason, isFlagged });
    if (!review) {
      return res.status(404).json({ success: false, message: 'Review not found' });
    }

    res.status(200).json({ success: true, data: review });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProducts,
  updateProductStatus,
  updateProductModeration,
  getSellers,
  getSellerProducts,
  updateSellerModeration,
  getDashboardStats,
  getReviews,
  moderateReview,
};
