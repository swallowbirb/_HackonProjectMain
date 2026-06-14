/**
 * festive.controller.js — Phase 7.5 Festive Defense Layer
 *
 * Thin HTTP layer over festive.service. Endpoints are query/decision oriented
 * (the frontend consults them at checkout) plus admin calendar visibility/override.
 */

const festiveService = require('./festive.service');

/**
 * GET /api/festive/active
 * Public. Returns the currently active festive event (or null) + its policies.
 */
const getActive = async (req, res, next) => {
  try {
    const event = await festiveService.getActiveEvent();
    res.status(200).json({
      success: true,
      data: {
        active: !!event,
        event: event
          ? {
              eventCode: event.eventCode,
              instanceKey: event.instanceKey,
              eventName: event.eventName,
              startDate: event.startDate,
              endDate: event.endDate,
              policies: event.policies,
              forceActive: event.forceActive,
            }
          : null,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/festive/payment-policy?cartTotal=2500
 * Optional auth — logged-in users get their tier-specific COD decision.
 * The frontend uses this to show/hide/cap the COD option at checkout.
 */
const getPaymentPolicy = async (req, res, next) => {
  try {
    const cartTotal = Number(req.query.cartTotal || 0);
    const userId = req.user ? req.user._id : null;
    const tier = userId ? await festiveService.resolveTier(userId) : 'standard';

    const codPolicy = await festiveService.getCodPolicy({ tier, cartTotal });

    res.status(200).json({
      success: true,
      data: {
        tier,
        cartTotal,
        codAllowed: codPolicy.codAllowed,
        cap: codPolicy.cap,
        capExceeded: codPolicy.capExceeded,
        partialPrepaidToken: codPolicy.partialPrepaidToken,
        festive: codPolicy.festive,
        eventCode: codPolicy.eventCode || null,
        reason: codPolicy.reason,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/festive/return-window?reasonCode=changed_mind
 * Optional auth. Returns the effective return-window days for a hypothetical
 * order placed now (used to render the "Festive sale: N-day returns" banner).
 */
const getReturnWindow = async (req, res, next) => {
  try {
    const userId = req.user ? req.user._id : null;
    const tier = userId ? await festiveService.resolveTier(userId) : 'standard';
    const { reasonCode } = req.query;

    const window = await festiveService.getReturnWindowDays({
      orderCreatedAt: new Date(),
      tier,
      reasonCode,
    });

    res.status(200).json({ success: true, data: { tier, ...window } });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/festive/calendar
 * Admin/dev. Full calendar listing for the admin festive panel.
 */
const listCalendar = async (req, res, next) => {
  try {
    const events = await festiveService.listEvents();
    res.status(200).json({ success: true, data: events });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/festive/override  { instanceKey, on }
 * Admin/dev demo toggle — force an event active regardless of date.
 */
const setOverride = async (req, res, next) => {
  try {
    const { instanceKey, on = true } = req.body;
    const updated = await festiveService.setForceActive(instanceKey, on);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }
    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getActive,
  getPaymentPolicy,
  getReturnWindow,
  listCalendar,
  setOverride,
};
