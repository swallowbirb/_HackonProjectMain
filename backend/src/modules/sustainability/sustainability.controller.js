const fs = require('fs');
const mongoose = require('mongoose');
const sustainabilityService = require('./sustainability.service');

/**
 * GET /api/sustainability/user/:userId — balance + CO2/water summary + recent ledger.
 */
const getUserImpact = async (req, res, next) => {
  try {
    const data = await sustainabilityService.getUserImpactSummary(req.params.userId);
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/sustainability/platform — platform-wide totals (internal/demo).
 */
const getPlatformImpact = async (req, res, next) => {
  try {
    const data = await sustainabilityService.getPlatformImpactSummary();
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/sustainability/item/:itemId — per-item impact (resale PDP badge).
 */
const getItemImpact = async (req, res, next) => {
  try {
    const data = await sustainabilityService.getItemImpact(req.params.itemId);
    if (!data) return res.status(404).json({ success: false, message: 'No impact recorded for this item' });
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/sustainability/donation/:itemId — full donation summary (survives reload).
 */
const getDonation = async (req, res, next) => {
  try {
    const data = await sustainabilityService.getDonationDetails(req.params.itemId);
    if (!data) return res.status(404).json({ success: false, message: 'This item was not donated' });
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/sustainability/donate/:itemId — trigger the donation flow.
 * Body (optional): { lng, lat } donor location for NGO matching.
 */
const donate = async (req, res, next) => {
  try {
    const { itemId } = req.params;
    if (!mongoose.isValidObjectId(itemId)) {
      return res.status(400).json({ success: false, message: 'Invalid itemId' });
    }
    const { lng, lat } = req.body || {};
    const location =
      Number.isFinite(Number(lng)) && Number.isFinite(Number(lat))
        ? { lng: Number(lng), lat: Number(lat) }
        : undefined;

    const result = await sustainabilityService.recordDonation({
      itemId,
      donorId: req.user._id,
      location,
    });
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error.message === 'Item not found') {
      return res.status(404).json({ success: false, message: error.message });
    }
    next(error);
  }
};

/**
 * GET /api/sustainability/receipt/:itemId — download the donation receipt PDF.
 */
const getReceipt = async (req, res, next) => {
  try {
    const { itemId } = req.params;
    if (!mongoose.isValidObjectId(itemId)) {
      return res.status(400).json({ success: false, message: 'Invalid itemId' });
    }

    // Find the receiptId from the item's DONATED lifecycle event.
    const LifecycleEvent = require('../lifecycle/lifecycle.model');
    const event = await LifecycleEvent.findOne({ itemId, eventType: 'DONATED' })
      .sort({ sequence: -1 })
      .lean();
    const receiptId = event?.data?.receiptId;
    if (!receiptId) {
      return res.status(404).json({ success: false, message: 'No receipt found for this item' });
    }

    const filePath = sustainabilityService.getReceiptPath(receiptId);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Receipt file not found' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${receiptId}.pdf"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/sustainability/redeem — redeem credits for a discount.
 * Body: { amount, orderId? }
 */
const redeem = async (req, res, next) => {
  try {
    const { amount, orderId } = req.body || {};
    const result = await sustainabilityService.redeemCredits(req.user._id, amount, { orderId: orderId || null });
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

module.exports = { getUserImpact, getPlatformImpact, getItemImpact, donate, getReceipt, redeem, getDonation };
