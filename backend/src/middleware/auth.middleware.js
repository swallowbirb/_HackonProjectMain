const { ClerkExpressRequireAuth } = require("@clerk/clerk-sdk-node");
const User = require("../modules/users/user.model");

const clerkAuthMiddleware = ClerkExpressRequireAuth({
  // Optionally, you can add behavior for unauthorized requests
});

const requireAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (process.env.NODE_ENV !== 'production' && token && token.startsWith('mock_')) {
    req.auth = { userId: token };
    return next();
  }
  clerkAuthMiddleware(req, res, next);
};

// Middleware to attach our DB user to the request
const attachUser = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!req.auth || !req.auth.userId) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized from attached user!" });
    }

    const user = await User.findOne({ clerkId: req.auth.userId }).lean();

    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "User not synced in database" });
    }

    // Block banned sellers from accessing any protected routes, except for profile and sync endpoints
    if (user.role === 'seller' && user.banned) {
      const isProfileOrSync = 
        req.path === '/me' || 
        req.path === '/sync' || 
        req.originalUrl.endsWith('/api/users/me') || 
        req.originalUrl.endsWith('/api/users/sync');
      
      if (!isProfileOrSync) {
        return res
          .status(403)
          .json({ success: false, message: "Your account has been banned. Please contact support." });
      }
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

// Role-based authorization middleware
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized from requireRole" });
    }

    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({
          success: false,
          message: "Forbidden: Insufficient permissions",
        });
    }

    next();
  };
};

module.exports = {
  requireAuth,
  attachUser,
  requireRole,
};
