const Return = require('./return.model');
const Order = require('../orders/order.model');
const itemService = require('../items/item.service');
const { getEventsByItemId } = require('../lifecycle/lifecycle.service');

const RETURN_WINDOW_DAYS = 30;

/**
 * Initiate a return for a completed order.
 */
const initiateReturn = async (userId, { orderId, reasonCode, reasonText, clarifyingPhotos }) => {
  // Verify order belongs to user and is completed
  const order = await Order.findOne({ _id: orderId, buyerId: userId, status: 'completed' })
    .populate('productId', 'title category')
    .populate('catalogEntryId', 'title category')
    .lean();

  if (!order) throw new Error('Order not found or not eligible for return');

  // Enforce return window — Phase 7.5 makes this festive- and tier-aware.
  // Defensive: if the festive module is absent or errors, fall back to the base window.
  // Prefer the policy snapshotted on the order at placement time; otherwise compute now.
  let windowDays = RETURN_WINDOW_DAYS;
  try {
    const festiveService = require('../festive/festive.service');
    const snapshot = order.festivePolicy;
    const isFullWindowReason = ['defective', 'wrong_item'].includes(reasonCode);

    if (snapshot && snapshot.returnWindowDays != null && !isFullWindowReason) {
      windowDays = snapshot.returnWindowDays;
    } else if (!isFullWindowReason) {
      let tier = snapshot && snapshot.tierAtPurchase;
      if (!tier) tier = await festiveService.resolveTier(userId);
      const w = await festiveService.getReturnWindowDays({
        orderCreatedAt: order.createdAt,
        tier,
        reasonCode,
      });
      windowDays = w.windowDays;
    }
  } catch (_) {
    windowDays = RETURN_WINDOW_DAYS; // festive module not ready → base window
  }

  const daysSinceOrder = (Date.now() - new Date(order.createdAt)) / (1000 * 60 * 60 * 24);
  if (daysSinceOrder > windowDays) {
    throw new Error(`Return window expired (${windowDays} days)`);
  }

  // Check no active return already exists for this order
  const existing = await Return.findOne({ orderId, userId });
  if (existing) throw new Error('A return already exists for this order');

  // Block if a sell-used listing already exists for this order
  const SecondhandItem = require('../secondhand/secondhand.model');
  const existingSell = await SecondhandItem.findOne({ orderId, userId });
  if (existingSell) throw new Error('A sell-used listing already exists for this order — you cannot also return it');

  // Resolve product info
  const isCatalog = !!order.catalogEntryId;
  const productTitle = isCatalog ? order.catalogEntryId?.title : order.productId?.title;
  const productCategory = isCatalog ? order.catalogEntryId?.category : order.productId?.category;

  // v2.34 — cheap claim plausibility gate BEFORE any expensive grading work. Rejects
  // claims that clearly can't pertain to this product (e.g. "fridge not cooling" on a
  // phone). Fail-open: ML outage or vague claims pass through.
  if (reasonText && reasonText.trim().length >= 6) {
    try {
      const gradingService = require('../grading/grading.service');
      const check = await gradingService.validateClaim({
        reason: reasonText,
        category: productCategory,
        productTitle,
        productId: isCatalog ? null : order.productId?._id,
      });
      if (check.checked && check.plausible === false) {
        const err = new Error(
          check.reason ||
          'This description does not seem to match the product you are returning. Please describe the actual issue with this item.'
        );
        err.statusCode = 400;
        err.code = 'CLAIM_IMPLAUSIBLE';
        throw err;
      }
    } catch (e) {
      if (e.code === 'CLAIM_IMPLAUSIBLE') throw e;
      // Any other failure → fail open, continue with the return.
    }
  }

  // Snapshot trust tier (Phase 3 fills this — graceful fallback)
  let trustTierAtSubmission = null;
  try {
    const trustService = require('../trust/trust.service');
    const profile = await trustService.getTrustProfile(userId);
    if (profile) trustTierAtSubmission = profile.tier;
  } catch {
    // Phase 3 not yet implemented — continue
  }

  const actor = { userId, role: 'buyer' };

  // Create the shared Item (convergence model)
  const item = await itemService.createItem(
    {
      intakePath: 'return',
      initiatorUserId: userId,
      originalOrderId: orderId,
      originalProductId: isCatalog ? null : order.productId?._id,
      category: productCategory,
      reasonCode,
      reasonText,
      trustTierAtSubmission,
    },
    actor
  );

  // Create the Return record
  const returnRecord = await Return.create({
    orderId,
    userId,
    itemId: item._id,
    reasonCode,
    reasonText,
    originalProductId: isCatalog ? null : order.productId?._id,
    originalCatalogEntryId: isCatalog ? order.catalogEntryId?._id : null,
    productTitle,
    productCategory,
    orderTotal: order.totalPrice,
  });

  // Back-link the item to the return record
  await require('../items/item.model').findByIdAndUpdate(item._id, { returnId: returnRecord._id });

  // v3.44 — kick off the dynamic, product- & claim-specific Pass-1 form right away
  // and move the item into AWAITING_EVIDENCE. Fire-and-forget; never blocks intake.
  await itemService.requestEvidenceForm(item._id, actor, { clarifyingPhotos });

  return { itemId: item._id, returnId: returnRecord._id, status: 'AWAITING_EVIDENCE' };
};

/**
 * Attach evidence photos and trigger grading.
 * v3.44 — accepts an optional field→image mapping from the dynamic form.
 */
const submitEvidence = async (userId, itemId, photos, fieldImages, additionalNotes) => {
  const item = await require('../items/item.model').findById(itemId).lean();
  if (!item) throw new Error('Item not found');
  if (item.initiatorUserId.toString() !== userId.toString()) throw new Error('Forbidden');
  if (item.intakePath !== 'return') throw new Error('Item is not a return');

  // If already in GRADING (e.g. previous request partially succeeded), return success
  if (item.status === 'GRADING') {
    return item;
  }

  return itemService.attachEvidence(itemId, photos, { userId, role: 'buyer' }, { fieldImages, additionalNotes });
};

/**
 * Get all returns for a buyer, with item populated.
 */
const getReturnsByUser = async (userId) => {
  return Return.find({ userId })
    .populate('orderId', 'totalPrice createdAt')
    .populate('itemId')
    .sort({ createdAt: -1 })
    .lean();
};

/**
 * Get a single return with full item + lifecycle events.
 */
const getReturnById = async (returnId, userId) => {
  const returnRecord = await Return.findById(returnId)
    .populate('orderId', 'totalPrice createdAt')
    .populate('itemId')
    .lean();

  if (!returnRecord) return null;
  if (returnRecord.userId.toString() !== userId.toString()) throw new Error('Forbidden');

  const events = returnRecord.itemId
    ? await getEventsByItemId(returnRecord.itemId._id)
    : [];

  return { ...returnRecord, lifecycleEvents: events };
};

module.exports = { initiateReturn, submitEvidence, getReturnsByUser, getReturnById };
