const Order = require('./order.model');
const Product = require('../products/product.model');
const SellerOffer = require('../offers/sellerOffer.model');
const BrandCatalogEntry = require('../brandCatalog/brandCatalogEntry.model');

/**
 * Phase 7.5 — resolve the festive policy for an order being placed.
 * Defensive: if the festive module is absent or errors, returns a null policy and
 * COD is treated as allowed (fail-open, sales-safe). Never throws.
 */
const resolveFestivePolicy = async ({ buyerId, cartTotal, paymentMethod }) => {
  try {
    const festiveService = require('../festive/festive.service');
    const policy = await festiveService.buildOrderFestivePolicy({
      userId: buyerId,
      cartTotal,
    });

    // Lever 2 — enforce the COD gate at placement time.
    if (paymentMethod === 'cod' && policy && policy.codPolicy && !policy.codPolicy.codAllowed) {
      const err = new Error('COD_NOT_AVAILABLE');
      err.code = 'COD_NOT_AVAILABLE';
      err.festive = policy;
      throw err;
    }

    return policy;
  } catch (error) {
    if (error.code === 'COD_NOT_AVAILABLE') throw error; // surface gate rejection
    return null; // any other failure → no festive policy, order proceeds
  }
};

/**
 * Create a simulated order ("Buy Now").
 *
 * Supports two paths:
 *   1. Catalog path: { buyerId, offerId, quantity }
 *      - Resolves price and sellerId from the SellerOffer
 *      - productId is null; offerId is populated
 *   2. Standalone path: { buyerId, productId, quantity }
 *      - Original behavior: price and sellerId from the Product
 *      - offerId is null
 */
const createOrder = async ({ buyerId, productId, offerId, quantity, mockCreditCard, paymentMethod = 'prepaid' }) => {
  // ── Catalog path ──────────────────────────────────────────────────────────
  if (offerId) {
    const offer = await SellerOffer.findById(offerId)
      .populate('catalogEntryId')
      .lean();
    if (!offer) throw new Error('Offer not found');
    if (offer.status !== 'active') throw new Error('Offer is not available for purchase');

    const totalPrice = offer.price * quantity;

    // Phase 7.5 — festive COD gate + policy snapshot (defensive; may throw COD_NOT_AVAILABLE).
    const festivePolicy = await resolveFestivePolicy({ buyerId, cartTotal: totalPrice, paymentMethod });

    const order = await Order.create({
      buyerId,
      sellerId: offer.sellerId,
      productId: null,
      offerId: offer._id,
      catalogEntryId: offer.catalogEntryId._id,
      quantity,
      totalPrice,
      status: 'completed',
      paymentMethod,
      paymentDetails: paymentMethod === 'cod' ? {} : { mockCreditCard },
      festivePolicy,
    });

    return order;
  }

  // ── Standalone path (original behavior) ──────────────────────────────────
  const product = await Product.findById(productId).lean();
  if (!product) {
    throw new Error('Product not found');
  }
  if (product.status !== 'published' && product.status !== 'approved') {
    throw new Error('Product is not available for purchase');
  }
  if (product.banned || product.suspended) {
    throw new Error('Product is not available for purchase');
  }

  const totalPrice = product.price * quantity;

  // Phase 7.5 — festive COD gate + policy snapshot (defensive; may throw COD_NOT_AVAILABLE).
  const festivePolicy = await resolveFestivePolicy({ buyerId, cartTotal: totalPrice, paymentMethod });

  const order = await Order.create({
    buyerId,
    sellerId: product.sellerId,
    productId,
    quantity,
    totalPrice,
    status: 'completed',
    paymentMethod,
    paymentDetails: paymentMethod === 'cod' ? {} : { mockCreditCard },
    festivePolicy,
  });

  // Increment product's total sales count
  await Product.findByIdAndUpdate(productId, { $inc: { totalSales: quantity } });

  return order;
};

/**
 * Get order history for the authenticated buyer.
 */
const getBuyerOrders = async (buyerId, page = 1, limit = 20) => {
  const skip = (page - 1) * limit;

  const [orders, total] = await Promise.all([
    Order.find({ buyerId })
      .populate('productId', 'title images price category')
      .populate('catalogEntryId', 'title officialImages brandId')
      .populate('sellerId', 'firstName lastName storeName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Order.countDocuments({ buyerId }),
  ]);

  return { orders, total, page, limit, totalPages: Math.ceil(total / limit) };
};

/**
 * Get orders for a seller's products.
 */
const getSellerOrders = async (sellerId, page = 1, limit = 20) => {
  const skip = (page - 1) * limit;

  const [orders, total] = await Promise.all([
    Order.find({ sellerId })
      .populate('productId', 'title images price')
      .populate('buyerId', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Order.countDocuments({ sellerId }),
  ]);

  return { orders, total, page, limit, totalPages: Math.ceil(total / limit) };
};

/**
 * Phase 7.5 — Cancel an order, respecting the festive mid-transit cancel lock (Lever 3).
 *
 * - 'placed' orders are always cancellable (pre-dispatch remorse window).
 * - Once dispatched/in_transit/out_for_delivery during a cancel-lock event (BBD/GIF),
 *   non-genuine tiers are blocked (doorstep refusal still possible).
 * - 'delivered' orders are not cancellable (use the returns flow).
 *
 * Defensive: if the festive module is absent, cancellation is always allowed.
 */
const cancelOrder = async (buyerId, orderId) => {
  const order = await Order.findOne({ _id: orderId, buyerId });
  if (!order) throw new Error('Order not found');
  if (order.status === 'cancelled') throw new Error('Order is already cancelled');
  if (order.status === 'refunded') throw new Error('Order cannot be cancelled');
  if (order.fulfillmentStatus === 'delivered') {
    throw new Error('Order already delivered — please use the returns flow');
  }

  // Consult the festive cancel lock.
  try {
    const festiveService = require('../festive/festive.service');
    const tier =
      (order.festivePolicy && order.festivePolicy.tierAtPurchase) ||
      (await festiveService.resolveTier(buyerId));
    const decision = await festiveService.canCancelOrder({
      fulfillmentStatus: order.fulfillmentStatus,
      tier,
    });
    if (!decision.canCancel) {
      const err = new Error('CANCEL_LOCKED');
      err.code = 'CANCEL_LOCKED';
      err.detail = decision;
      throw err;
    }
  } catch (error) {
    if (error.code === 'CANCEL_LOCKED') throw error;
    // festive module unavailable → fail-open, allow cancel
  }

  order.status = 'cancelled';
  order.cancelledAt = new Date();
  await order.save();

  // Restore sales count for standalone product orders.
  if (order.productId) {
    await Product.findByIdAndUpdate(order.productId, { $inc: { totalSales: -order.quantity } });
  }

  return order;
};

/**
 * Phase 7.5 — Advance an order's fulfillment status (demo/dev helper to simulate
 * the carrier lifecycle so the mid-transit cancel lock can be demonstrated).
 */
const advanceFulfillment = async (orderId, fulfillmentStatus) => {
  const valid = ['placed', 'dispatched', 'in_transit', 'out_for_delivery', 'delivered'];
  if (!valid.includes(fulfillmentStatus)) {
    throw new Error('Invalid fulfillmentStatus');
  }
  const order = await Order.findByIdAndUpdate(
    orderId,
    { fulfillmentStatus },
    { new: true }
  );
  if (!order) throw new Error('Order not found');
  return order;
};

module.exports = {
  createOrder,
  getBuyerOrders,
  getSellerOrders,
  cancelOrder,
  advanceFulfillment,
};
