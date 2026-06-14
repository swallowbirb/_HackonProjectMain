/**
 * Task 0.6 — Canonical Data Contracts
 * Item Lifecycle Event — shape used by HealthCard hash chain
 *
 * {
 *   itemId: ObjectId,
 *   sequence: Number,         // monotonically increasing per item
 *   eventType: String,        // see EVENT_TYPES below
 *   timestamp: Date,
 *   actor: { userId: ObjectId, role: String },
 *   data: Object,             // event-specific payload
 *   previousHash: String,     // SHA-256 of the previous event (null for first)
 *   hash: String              // SHA-256 of this event's canonical JSON
 * }
 */

const EVENT_TYPES = [
  'INITIATED',
  'AWAITING_EVIDENCE',
  'EVIDENCE_SUBMITTED',
  'GRADING',
  'GRADED',
  'ROUTED',
  'IN_TRANSIT',
  'LISTED',
  'SOLD',
  'DONATED',
  'LIQUIDATED',
  'CANCELLED',
  'REJECTED',
];

const ACTOR_ROLES = ['buyer', 'seller', 'system', 'admin', 'carrier', 'ngo'];

module.exports = { EVENT_TYPES, ACTOR_ROLES };
