// TODO: Add validation schemas for health card endpoints

const validateGetHealthCard = (req, res, next) => {
  // TODO: validate itemId param
  next();
};

module.exports = { validateGetHealthCard };
