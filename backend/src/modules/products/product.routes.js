const express = require('express');
const router = express.Router();
const productController = require('./product.controller');
const { validateCreateProduct, validateUpdateProduct } = require('./product.validation');
const { requireAuth, attachUser, requireRole } = require('../../middleware/auth.middleware');

// TODO: Review these routes later to ensure proper rate limiting and additional security validation

/**
 * Route Flow Design:
 * 1. Specific Protected Routes:
 *    - GET /seller/list: Fetches products created by the authenticated seller. Must precede parameterized GET /:id.
 * 
 * 2. Public Read Routes:
 *    - GET /: Lists all published products.
 *    - GET /:id: Fetches a single product details.
 * 
 * 3. Protected Write/Mutate Routes (Requires 'seller' or 'admin' role):
 *    - POST /: Creates a new product. Validates request body first.
 *    - PATCH /:id: Updates a product by ID. Validates request body first.
 *    - DELETE /:id: Deletes a product by ID.
 * 
 * Middleware execution flow:
 * - Authentication (requireAuth -> attachUser) verifies the Clerk token and attaches the database user.
 * - Authorization (requireRole) verifies the user has the correct role.
 * - Validation (validateCreateProduct/validateUpdateProduct) validates user input before hitting the controller.
 */

// Protected routes middleware chain
const sellerAuth = [requireAuth, attachUser, requireRole(['seller', 'admin'])];

// Protected Seller routes (place more specific routes before parameters)
router.get('/seller/list', sellerAuth, productController.getSellerProducts);

// Public routes
router.get('/search', productController.searchProducts);
router.get('/', productController.getPublishedProducts);
router.get('/:id', productController.getProductById);

// Protected mutation routes
router.post('/', sellerAuth, validateCreateProduct, productController.createProduct);
router.patch('/:id', sellerAuth, validateUpdateProduct, productController.updateProduct);
router.delete('/:id', sellerAuth, productController.deleteProduct);

module.exports = router;
