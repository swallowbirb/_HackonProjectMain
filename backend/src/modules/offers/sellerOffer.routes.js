const express = require('express');
const router = express.Router();
const controller = require('./sellerOffer.controller');
const { validateCreateOffer, validateUpdateOffer } = require('./sellerOffer.validation');
const { requireAuth, attachUser, requireRole } = require('../../middleware/auth.middleware');

const sellerAuth = [requireAuth, attachUser, requireRole(['seller'])];

// GET  /api/offers?catalogEntryId=  — Public: all active offers for a catalog entry
router.get('/', controller.getOffersByCatalogEntry);

// GET  /api/offers/my               — Seller: their own offers (must be before /:id)
router.get('/my', sellerAuth, controller.getMyOffers);

// POST /api/offers                  — Seller: create offer on a catalog entry
router.post('/', sellerAuth, validateCreateOffer, controller.createOffer);

// PATCH /api/offers/:id             — Seller: update price/condition/quantity
router.patch('/:id', sellerAuth, validateUpdateOffer, controller.updateOffer);

// DELETE /api/offers/:id            — Seller: remove offer
router.delete('/:id', sellerAuth, controller.deleteOffer);

module.exports = router;
