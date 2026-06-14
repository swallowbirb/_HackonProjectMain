const SecondhandItem = require('./secondhand.model');
const Order = require('../orders/order.model');
const itemService = require('../items/item.service');
const { getEventsByItemId } = require('../lifecycle/lifecycle.service');

/**
 * Create a sell-used listing from a past platform order.
 */
const initiateFromOrder = async (userId, { orderId, description, askingPrice, clarifyingPhotos }) => {
  // Verify order belongs to user and is completed
  const order = await Order.findOne({ _id: orderId, buyerId: userId, status: 'completed' })
    .populate('productId', 'title category')
    .populate('catalogEntryId', 'title category')
    .lean();

  if (!order) throw new Error('Order not found or not eligible');

  // Check no existing sell-used for this order
  const existing = await SecondhandItem.findOne({ orderId, userId });
  if (existing) throw new Error('A sell-used listing already exists for this order');

  // Block if a return already exists for this order
  const Return = require('../returns/return.model');
  const existingReturn = await Return.findOne({ orderId, userId });
  if (existingReturn) throw new Error('A return already exists for this order — you cannot also sell it');

  const isCatalog = !!order.catalogEntryId;
  const productTitle = isCatalog ? order.catalogEntryId?.title : order.productId?.title;
  const productCategory = isCatalog ? order.catalogEntryId?.category : order.productId?.category;

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

  // Create the shared Item
  const item = await itemService.createItem(
    {
      intakePath: 'sell-used',
      initiatorUserId: userId,
      originalOrderId: orderId,
      originalProductId: isCatalog ? null : order.productId?._id,
      category: productCategory,
      reasonCode: 'other',
      reasonText: description || '',
      description,
      trustTierAtSubmission,
    },
    actor
  );

  // Create SecondhandItem record
  const secondhandRecord = await SecondhandItem.create({
    userId,
    itemId: item._id,
    orderId,
    originalProductId: isCatalog ? null : order.productId?._id,
    originalCatalogEntryId: isCatalog ? order.catalogEntryId?._id : null,
    productTitle,
    productCategory,
    orderTotal: order.totalPrice,
    description,
    askingPrice,
  });

  // Back-link the item
  await require('../items/item.model').findByIdAndUpdate(item._id, { secondhandId: secondhandRecord._id });

  // v3.44 — kick off the dynamic Pass-1 form and move into AWAITING_EVIDENCE.
  await itemService.requestEvidenceForm(item._id, actor, { clarifyingPhotos });

  return { itemId: item._id, secondhandId: secondhandRecord._id, status: 'AWAITING_EVIDENCE' };
};

/**
 * Attach evidence photos and trigger grading.
 * v3.44 — accepts an optional field→image mapping from the dynamic form.
 */
const submitEvidence = async (userId, itemId, photos, fieldImages, additionalNotes) => {
  const item = await require('../items/item.model').findById(itemId).lean();
  if (!item) throw new Error('Item not found');
  if (item.initiatorUserId.toString() !== userId.toString()) throw new Error('Forbidden');
  if (item.intakePath !== 'sell-used') throw new Error('Item is not a sell-used listing');

  // If already in GRADING (e.g. previous request partially succeeded), return success
  if (item.status === 'GRADING') {
    return item;
  }

  return itemService.attachEvidence(itemId, photos, { userId, role: 'buyer' }, { fieldImages, additionalNotes });
};

/**
 * Get all sell-used listings for a user.
 */
const getListingsByUser = async (userId) => {
  return SecondhandItem.find({ userId })
    .populate('orderId', 'totalPrice createdAt')
    .populate('itemId')
    .sort({ createdAt: -1 })
    .lean();
};

/**
 * Get a single sell-used listing with full item + lifecycle events.
 */
const getListingById = async (secondhandId, userId) => {
  const record = await SecondhandItem.findById(secondhandId)
    .populate('orderId', 'totalPrice createdAt')
    .populate('itemId')
    .lean();

  if (!record) return null;
  if (record.userId.toString() !== userId.toString()) throw new Error('Forbidden');

  const events = record.itemId ? await getEventsByItemId(record.itemId._id) : [];
  return { ...record, lifecycleEvents: events };
};

module.exports = { initiateFromOrder, submitEvidence, getListingsByUser, getListingById };
