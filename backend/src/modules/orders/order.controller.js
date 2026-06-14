const orderService = require('./order.service');

const createOrder = async (req, res, next) => {
  try {
    const buyerId = req.user._id;
    const { productId, offerId, quantity = 1, mockCreditCard, paymentMethod = 'prepaid' } = req.body;

    const order = await orderService.createOrder({ buyerId, productId, offerId, quantity, mockCreditCard, paymentMethod });

    res.status(201).json({ success: true, data: order });
  } catch (error) {
    if (error.code === 'COD_NOT_AVAILABLE') {
      return res.status(409).json({
        success: false,
        code: 'COD_NOT_AVAILABLE',
        message: 'Cash on Delivery is not available for this order during the festive sale. Please choose prepaid.',
        festive: error.festive || null,
      });
    }
    if (error.message === 'Product not found') {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error.message === 'Product is not available for purchase') {
      console.error('Order creation error:', error.message, req.body);
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error('Order creation unknown error:', error);
    next(error);
  }
};

const getBuyerOrders = async (req, res, next) => {
  try {
    const buyerId = req.user._id;
    const { page = 1, limit = 20 } = req.query;

    const result = await orderService.getBuyerOrders(buyerId, Number(page), Number(limit));
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

const getSellerOrders = async (req, res, next) => {
  try {
    const sellerId = req.user._id;
    const { page = 1, limit = 20 } = req.query;

    const result = await orderService.getSellerOrders(sellerId, Number(page), Number(limit));
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

/**
 * Phase 7.5 — Cancel an order (respects festive mid-transit cancel lock).
 */
const cancelOrder = async (req, res, next) => {
  try {
    const buyerId = req.user._id;
    const { id } = req.params;
    const order = await orderService.cancelOrder(buyerId, id);
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    if (error.code === 'CANCEL_LOCKED') {
      return res.status(409).json({
        success: false,
        code: 'CANCEL_LOCKED',
        message: error.detail?.message || 'This order cannot be cancelled while in transit.',
        detail: error.detail || null,
      });
    }
    if (error.message === 'Order not found') {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (
      error.message === 'Order is already cancelled' ||
      error.message === 'Order cannot be cancelled' ||
      error.message === 'Order already delivered — please use the returns flow'
    ) {
      return res.status(400).json({ success: false, message: error.message });
    }
    next(error);
  }
};

/**
 * Phase 7.5 — Advance fulfillment status (demo/dev helper to simulate the carrier
 * lifecycle so the cancel lock can be shown live).
 */
const advanceFulfillment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { fulfillmentStatus } = req.body;
    const order = await orderService.advanceFulfillment(id, fulfillmentStatus);
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    if (error.message === 'Invalid fulfillmentStatus' || error.message === 'Order not found') {
      return res.status(400).json({ success: false, message: error.message });
    }
    next(error);
  }
};

module.exports = {
  createOrder,
  getBuyerOrders,
  getSellerOrders,
  cancelOrder,
  advanceFulfillment,
};
