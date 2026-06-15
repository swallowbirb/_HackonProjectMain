const mongoose = require('mongoose');

/**
 * Validates POST /api/routing/compute — requires a valid itemId.
 */
const validateComputeRouting = (req, res, next) => {
  const { itemId } = req.body;
  if (!itemId || !mongoose.Types.ObjectId.isValid(itemId)) {
    return res.status(400).json({ success: false, message: 'A valid itemId is required' });
  }
  next();
};

module.exports = { validateComputeRouting };
