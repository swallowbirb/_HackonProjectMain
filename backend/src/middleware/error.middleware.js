const errorHandler = (err, req, res, next) => {
  console.error("=== Error Details ===");
  console.error(err);
  console.error(err.stack);
  console.error("=====================");

  let statusCode = err.statusCode || err.status || 500;

  if (err.message === "Unauthenticated" && statusCode === 500) {
    statusCode = 401;
  }

  res.status(statusCode).json({
    success: false,
    message: err.message || "Server Error",
    details: err, // Sending full details back to Postman/Frontend
  });
};

module.exports = { errorHandler };
