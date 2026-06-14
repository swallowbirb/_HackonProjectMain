const mongoose = require('mongoose');
const { EVENT_CODES, DEFAULT_RISK_MULTIPLIER } = require('../../contracts/festive.contract');

/**
 * Phase 7.5 — Festive Defense Layer
 * One document per festive/sale window. The single source of truth for every
 * festive lever (return-window shrink, COD gate, mid-transit cancel lock).
 * Bounded storage: a handful of docs, seeded once, edited rarely.
 */
const festiveCalendarSchema = new mongoose.Schema(
  {
    eventCode: {
      type: String,
      enum: Object.values(EVENT_CODES),
      required: true,
      index: true,
    },
    instanceKey: { type: String, required: true, unique: true },
    eventName: { type: String, required: true },

    startDate: { type: Date, required: true, index: true },
    endDate: { type: Date, required: true, index: true },

    riskMultiplier: { type: Number, default: DEFAULT_RISK_MULTIPLIER },
    affectedCategories: { type: [String], default: [] },

    policies: {
      codGate: { type: Boolean, default: true },
      returnWindowShrink: { type: Boolean, default: true },
      cancelLock: { type: Boolean, default: false },
    },

    active: { type: Boolean, default: true, index: true },
    forceActive: { type: Boolean, default: false },
  },
  { timestamps: true }
);

festiveCalendarSchema.index({ active: 1, startDate: 1, endDate: 1 });

module.exports = mongoose.model('FestiveCalendar', festiveCalendarSchema);
