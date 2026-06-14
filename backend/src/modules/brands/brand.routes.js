const express = require('express');
const router = express.Router();
const brandController = require('./brand.controller');
const { validateCreateBrand, validateEnrollmentStatus, validateBrandId } = require('./brand.validation');
const { requireAuth, attachUser, requireRole } = require('../../middleware/auth.middleware');

const brandAuth = [requireAuth, attachUser, requireRole(['brand'])];
const sellerAuth = [requireAuth, attachUser, requireRole(['seller'])];

// GET  /api/brands — Public: list all brands
router.get('/', brandController.getAllBrands);

// GET  /api/brands/my — Brand user: get their own brand
router.get('/my', brandAuth, brandController.getMyBrand);

// GET  /api/brands/seller-enrollments — Seller: get all brands with their enrollment status
router.get('/seller-enrollments', sellerAuth, brandController.getSellerEnrollments);

// POST /api/brands — Brand user registers a brand
router.post('/', brandAuth, validateCreateBrand, brandController.createBrand);

// GET  /api/brands/:id — Public: get brand by ID
router.get('/:id', validateBrandId, brandController.getBrandById);

// GET  /api/brands/:id/sellers — Brand owner: get enrolled sellers with trust scores
router.get('/:id/sellers', brandAuth, validateBrandId, brandController.getEnrolledSellers);

// GET  /api/brands/:id/products — Brand owner: get products from enrolled sellers
router.get('/:id/products', brandAuth, validateBrandId, brandController.getEnrolledSellerProducts);

// GET  /api/brands/:id/flagged-products — Brand owner: get flagged counterfeit claims
router.get('/:id/flagged-products', brandAuth, validateBrandId, brandController.getFlaggedProducts);

// GET  /api/brands/:id/enrollments/pending — Brand owner: see pending requests
router.get('/:id/enrollments/pending', brandAuth, validateBrandId, brandController.getPendingEnrollments);

// POST /api/brands/:id/enroll — Seller requests enrollment
router.post('/:id/enroll', sellerAuth, validateBrandId, brandController.requestEnrollment);

// PATCH /api/brands/:id/enrollments/:enrollmentId — Brand owner approves/rejects
router.patch('/:id/enrollments/:enrollmentId', brandAuth, validateBrandId, validateEnrollmentStatus, brandController.updateEnrollmentStatus);

module.exports = router;
