// TODO: Add validation schemas for want creation

const validateCreateWant = (req, res, next) => {
  // TODO: validate productCategory, location (lat/lng), radiusKm
  next();
};

module.exports = { validateCreateWant };
