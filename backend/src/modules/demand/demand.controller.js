const demandService = require('./demand.service');

const createWant = async (req, res, next) => {
  try {
    res.status(501).json({ success: false, message: 'Not implemented' });
  } catch (error) {
    next(error);
  }
};

const getWantsByUser = async (req, res, next) => {
  try {
    res.status(501).json({ success: false, message: 'Not implemented' });
  } catch (error) {
    next(error);
  }
};

const matchDemand = async (req, res, next) => {
  try {
    res.status(501).json({ success: false, message: 'Not implemented' });
  } catch (error) {
    next(error);
  }
};

module.exports = { createWant, getWantsByUser, matchDemand };
