const express = require('express');
const router = express.Router();
const controller = require('./brandCatalogEntry.controller');
const { validateCreateCatalogEntry, validateUpdateCatalogEntry } = require('./brandCatalogEntry.validation');
const { requireAuth, attachUser, requireRole } = require('../../middleware/auth.middleware');

const brandAuth = [requireAuth, attachUser, requireRole(['brand'])];

// GET  /api/brand-catalog?brandId=   — Public: list entries by brand
router.get('/', controller.getCatalogEntriesByBrand);

// GET  /api/brand-catalog/my         — Brand: get all their own entries (incl. inactive)
router.get('/my', brandAuth, controller.getMyCatalogEntries);

// POST /api/brand-catalog             — Brand: create a new catalog entry
router.post('/', brandAuth, validateCreateCatalogEntry, controller.createCatalogEntry);

// GET  /api/brand-catalog/:id         — Public: single entry detail
router.get('/:id', controller.getCatalogEntryById);

// PATCH /api/brand-catalog/:id        — Brand: update entry (must own brand)
router.patch('/:id', brandAuth, validateUpdateCatalogEntry, controller.updateCatalogEntry);

// DELETE /api/brand-catalog/:id       — Brand: soft-delete entry (must own brand)
router.delete('/:id', brandAuth, controller.deleteCatalogEntry);

module.exports = router;
