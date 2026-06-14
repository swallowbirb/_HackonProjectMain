const validateCreateFromOrder = (req, res, next) => {
  const { orderId } = req.body;
  if (!orderId) {
    return res.status(400).json({ success: false, message: 'orderId is required' });
  }
  next();
};

module.exports = { validateCreateFromOrder };
