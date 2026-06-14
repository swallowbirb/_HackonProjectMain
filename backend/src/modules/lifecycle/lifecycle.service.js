const LifecycleEvent = require('./lifecycle.model');

/**
 * Append a lifecycle event to an item's audit log.
 * sequence auto-increments per item.
 * previousHash/hash are left null — Phase 5 will compute the hash chain.
 */
const appendEvent = async (itemId, eventType, actor, data = {}) => {
  const lastEvent = await LifecycleEvent.findOne({ itemId })
    .sort({ sequence: -1 })
    .lean();

  const sequence = lastEvent ? lastEvent.sequence + 1 : 0;

  const event = await LifecycleEvent.create({
    itemId,
    sequence,
    eventType,
    timestamp: new Date(),
    actor,
    data,
    previousHash: null,
    hash: null,
  });

  return event;
};

/**
 * Get all lifecycle events for an item, ordered by sequence.
 */
const getEventsByItemId = async (itemId) => {
  return LifecycleEvent.find({ itemId }).sort({ sequence: 1 }).lean();
};

module.exports = { appendEvent, getEventsByItemId };
