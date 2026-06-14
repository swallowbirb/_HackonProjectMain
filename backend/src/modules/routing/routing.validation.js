const mongoose = require('mongoose');

const validateComputeRouting = (req, res, next) => {
  const { itemId } = req.body;
  if (!itemId || !mongoose.isValidObjectId(itemId)) {
    return res.status(400).json({ success: false, message: 'A valid itemId is required' });
  }
  next();
};

module.exports = { validateComputeRouting };
