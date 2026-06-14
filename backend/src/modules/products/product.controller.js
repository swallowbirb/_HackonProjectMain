const productService = require('./product.service');

const createProduct = async (req, res, next) => {
  try {
    const sellerId = req.user._id; 
    const productData = { ...req.body, sellerId };
    
    const product = await productService.createProduct(productData);
    
    res.status(201).json({
      success: true,
      data: product,
    });
  } catch (error) {
    next(error);
  }
};

const getSellerProducts = async (req, res, next) => {
  try {
    const sellerId = req.user._id;
    const products = await productService.getProductsBySeller(sellerId);
    
    res.status(200).json({
      success: true,
      data: products,
    });
  } catch (error) {
    next(error);
  }
};

const getPublishedProducts = async (req, res, next) => {
  try {
    const products = await productService.getAllPublishedProducts();
    
    res.status(200).json({
      success: true,
      data: products,
    });
  } catch (error) {
    next(error);
  }
};

const getProductById = async (req, res, next) => {
  try {
    const product = await productService.getProductById(req.params.id);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }
    
    res.status(200).json({
      success: true,
      data: product,
    });
  } catch (error) {
    next(error);
  }
};

const updateProduct = async (req, res, next) => {
  try {
    const sellerId = req.user._id;
    const productId = req.params.id;
    
    const updatedProduct = await productService.updateProduct(productId, sellerId, req.body);
    
    if (!updatedProduct) {
      return res.status(404).json({
        success: false,
        message: 'Product not found or unauthorized',
      });
    }
    
    res.status(200).json({
      success: true,
      data: updatedProduct,
    });
  } catch (error) {
    next(error);
  }
};

const deleteProduct = async (req, res, next) => {
  try {
    const sellerId = req.user._id;
    const productId = req.params.id;
    
    const deletedProduct = await productService.deleteProduct(productId, sellerId);
    
    if (!deletedProduct) {
      return res.status(404).json({
        success: false,
        message: 'Product not found or unauthorized',
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Product deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

const searchProducts = async (req, res, next) => {
  try {
    const { q, category, minPrice, maxPrice, minRating, sort, page = 1, limit = 20, verifiedOnly } = req.query;
    const filters = { q, category, minPrice, maxPrice, minRating, sort, verifiedOnly };

    const result = await productService.searchProducts(filters, Number(page), Number(limit));
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createProduct,
  getSellerProducts,
  getPublishedProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  searchProducts,
};
