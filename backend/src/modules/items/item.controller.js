const itemService = require('./item.service');
const ItemLogger = require('../../utils/itemLogger');
const { getEventsByItemId } = require('../lifecycle/lifecycle.service');

const getItem = async (req, res, next) => {
  try {
    const item = await itemService.getItemById(req.params.itemId);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

    // Only owner or admin can read
    if (
      item.initiatorUserId.toString() !== req.user._id.toString() &&
      req.user.role !== 'admin'
    ) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const events = await getEventsByItemId(req.params.itemId);
    res.status(200).json({ success: true, data: { ...item, lifecycleEvents: events } });
  } catch (err) {
    next(err);
  }
};

const getMyItems = async (req, res, next) => {
  try {
    const items = await itemService.getItemsByUser(req.user._id);
    res.status(200).json({ success: true, data: items });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/items/:itemId/status — unified status (state + trust + grade).
 */
const getStatus = async (req, res, next) => {
  try {
    const item = await itemService.getItemById(req.params.itemId);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

    if (
      item.initiatorUserId.toString() !== req.user._id.toString() &&
      req.user.role !== 'admin'
    ) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const status = await itemService.getItemStatus(req.params.itemId);
    res.status(200).json({ success: true, data: status });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/items/:itemId/logs — developer-visibility log stream (Phase 3.5).
 */
const getLogs = async (req, res, next) => {
  try {
    const item = await itemService.getItemById(req.params.itemId);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

    if (
      item.initiatorUserId.toString() !== req.user._id.toString() &&
      req.user.role !== 'admin'
    ) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const logs = await ItemLogger.getLogs(req.params.itemId);
    res.status(200).json({ success: true, data: { logs } });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/items/:itemId/notes — previous-owner notes (initiator only, post-grading).
 */
const updateNotes = async (req, res, next) => {
  try {
    const { notes } = req.body || {};
    if (typeof notes !== 'string') {
      return res.status(400).json({ success: false, message: 'notes must be a string' });
    }
    if (notes.length > 2000) {
      return res.status(400).json({ success: false, message: 'notes must be 2000 characters or fewer' });
    }
    const item = await itemService.addOwnerNotes(req.params.itemId, req.user._id, notes);
    return res.status(200).json({ success: true, data: { itemId: item._id, ownerNotes: item.ownerNotes } });
  } catch (err) {
    if (err.message === 'Forbidden') return res.status(403).json({ success: false, message: 'Forbidden' });
    if (err.message === 'Item not found') return res.status(404).json({ success: false, message: err.message });
    if (err.message === 'Notes can only be added once the item has been graded') {
      return res.status(409).json({ success: false, message: err.message });
    }
    return next(err);
  }
};

module.exports = { getItem, getMyItems, getStatus, getLogs, updateNotes };
