// TODO: Add validation schemas for routing decision trigger

const validateComputeRouting = (req, res, next) => {
  // TODO: validate itemId, gradeId
  next();
};

module.exports = { validateComputeRouting };
