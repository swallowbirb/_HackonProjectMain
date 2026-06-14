const demandService = require('./demand.service');

// Standard response envelope: { success, data } — matches the rest of the repo.

// POST /api/demand — create a buyer "Looking for…" post
const createWant = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const want = await demandService.createWant(userId, req.body);
    res.status(201).json({ success: true, data: want });
  } catch (error) {
    next(error);
  }
};

// GET /api/demand/user — current user's posts
const getWantsByUser = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const wants = await demandService.getWantsByUser(userId);
    res.json({ success: true, data: wants });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/demand/:id — deactivate one of the user's posts
const deleteWant = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const updated = await demandService.deactivateWant(req.params.id, userId);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

// GET /api/demand/match?category=&tags=&lng=&lat=&radiusKm= — debug/seam endpoint
const matchDemand = async (req, res, next) => {
  try {
    const { category, lng, lat, radiusKm } = req.query;
    const tags = req.query.tags
      ? String(req.query.tags).split(',').map((t) => t.trim()).filter(Boolean)
      : [];
    const location =
      lng != null && lat != null
        ? { type: 'Point', coordinates: [Number(lng), Number(lat)] }
        : null;
    const result = await demandService.matchDemandForItem(
      category,
      tags,
      location,
      radiusKm != null ? Number(radiusKm) : undefined
    );
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

// GET /api/demand/map?term=shoe — normalized demand per warehouse for the admin map
const getDemandMap = async (req, res, next) => {
  try {
    const term = req.query.term || '';
    const radiusKm = req.query.radiusKm != null ? Number(req.query.radiusKm) : undefined;
    const data = await demandService.demandByWarehouse(term, radiusKm);
    res.json({ success: true, data: { term, warehouses: data } });
  } catch (error) {
    next(error);
  }
};

// GET /api/demand/warehouses — list demo warehouses
const getWarehouses = async (req, res, next) => {
  try {
    const data = await demandService.listWarehouses();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

module.exports = { createWant, getWantsByUser, deleteWant, matchDemand, getDemandMap, getWarehouses };
