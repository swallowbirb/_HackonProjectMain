const demandService = require('./demand.service');

const createWant = async (req, res, next) => {
  try {
    const userId = req.user?._id;
    const want = await demandService.createWant(userId, req.body);
    res.status(201).json({ success: true, data: want });
  } catch (error) {
    next(error);
  }
};

const getWantsByUser = async (req, res, next) => {
  try {
    const userId = req.user?._id;
    const wants = await demandService.getWantsByUser(userId);
    res.status(200).json({ success: true, data: wants });
  } catch (error) {
    next(error);
  }
};

const deleteWant = async (req, res, next) => {
  try {
    const userId = req.user?._id;
    const want = await demandService.deactivateWant(req.params.id, userId);
    if (!want) return res.status(404).json({ success: false, message: 'Want not found' });
    res.status(200).json({ success: true, data: want });
  } catch (error) {
    next(error);
  }
};

const matchDemand = async (req, res, next) => {
  try {
    const { category, tags, lng, lat, radiusKm } = req.query;
    const location = lng != null && lat != null
      ? { type: 'Point', coordinates: [Number(lng), Number(lat)] }
      : null;
    const tagList = tags ? String(tags).split(',').map((t) => t.trim()).filter(Boolean) : [];
    const result = await demandService.matchDemandForItem(category, tagList, location, Number(radiusKm) || undefined);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/demand/map?term=shoe — normalized demand per warehouse for a term.
 * Enriches each row with the warehouse document for the admin map plot.
 */
const getDemandMap = async (req, res, next) => {
  try {
    const term = req.query.term || '';
    const rows = await demandService.demandByWarehouse(term);
    const warehouses = rows.map((r) => ({
      warehouseCode: r.warehouseCode,
      demand: r.demand,
      raw: r.raw,
      warehouse: r.warehouse,
    }));
    res.status(200).json({ success: true, data: { term, warehouses } });
  } catch (error) {
    next(error);
  }
};

const getWarehouses = async (req, res, next) => {
  try {
    const warehouses = await demandService.listWarehouses();
    res.status(200).json({ success: true, data: warehouses });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createWant,
  getWantsByUser,
  deleteWant,
  matchDemand,
  getDemandMap,
  getWarehouses,
};
