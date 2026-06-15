const { clerkClient } = require('@clerk/clerk-sdk-node');
const userService = require('./user.service');

const syncUser = async (req, res, next) => {
  try {
    const clerkId = req.auth?.userId;
    if (!clerkId) {
      return res.status(401).json({ success: false, message: 'Unauthorized: No Clerk user ID found' });
    }

    let email, firstName, lastName, avatarUrl, role;

    if (process.env.NODE_ENV !== 'production' && clerkId.startsWith('mock_')) {
      const parts = clerkId.split('_');
      const identifier = parts[1] || 'buyer';
      email = `${identifier}@mock.com`;
      firstName = 'Mock';
      lastName = identifier.charAt(0).toUpperCase() + identifier.slice(1);
      avatarUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${firstName} ${lastName}`;
      if (['admin', 'seller', 'brand', 'buyer'].includes(identifier)) {
        role = identifier;
      }
    } else {
      // Fetch full user details from Clerk's SDK. Failures here are the most
      // common cause of "user never appears in Mongo" — surface them clearly.
      let clerkUser;
      try {
        clerkUser = await clerkClient.users.getUser(clerkId);
      } catch (err) {
        console.error('[syncUser] clerkClient.users.getUser failed', {
          clerkId,
          message: err?.message,
          status: err?.status,
        });
        return res.status(502).json({
          success: false,
          message: 'Failed to load user from Clerk. Check CLERK_SECRET_KEY on the backend.',
          detail: err?.message,
        });
      }

      // Prefer the primary email; fall back to first available; finally body.
      const primary = clerkUser.emailAddresses?.find(
        (e) => e.id === clerkUser.primaryEmailAddressId
      );
      email =
        primary?.emailAddress ||
        clerkUser.emailAddresses?.[0]?.emailAddress ||
        req.body.email;
      firstName = clerkUser.firstName || req.body.firstName;
      lastName = clerkUser.lastName || req.body.lastName;
      avatarUrl = clerkUser.imageUrl || req.body.avatarUrl;
    }

    const userData = {
      clerkId,
      email,
      firstName,
      lastName,
      avatarUrl,
      ...(role && { role }),
    };

    if (!userData.clerkId || !userData.email) {
      console.error('[syncUser] Missing required user data', { clerkId, email });
      return res.status(400).json({
        success: false,
        message: 'Missing required user data',
        detail: { hasClerkId: !!userData.clerkId, hasEmail: !!userData.email },
      });
    }

    let user;
    try {
      user = await userService.syncUser(userData);
    } catch (err) {
      // Most likely cause: duplicate email from a stale account (unique index).
      if (err?.code === 11000) {
        console.error('[syncUser] Duplicate key on user upsert', {
          clerkId,
          email,
          keyValue: err.keyValue,
        });
        return res.status(409).json({
          success: false,
          message: 'A different account with this email already exists in the database.',
          detail: err.keyValue,
        });
      }
      throw err;
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

const getMe = async (req, res, next) => {
  try {
    // The attachUser middleware ensures our DB user is attached to req.user
    res.status(200).json({
      success: true,
      data: req.user,
    });
  } catch (error) {
    next(error);
  }
};

const updateRole = async (req, res, next) => {
  try {
    const { role } = req.body;
    
    if (!['buyer', 'seller', 'brand', 'admin'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role' });
    }

    const user = req.user;
    
    // Using user model to update role
    const User = require('./user.model');
    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      { role },
      { new: true }
    ).lean();

    res.status(200).json({
      success: true,
      data: updatedUser,
    });
  } catch (error) {
    next(error);
  }
};

const getStore = async (req, res, next) => {
  try {
    const { id } = req.params;
    const User = require('./user.model');
    const Product = require('../products/product.model');

    const seller = await User.findById(id)
      .select('firstName lastName storeName storeDescription avatarUrl profileImageUrl averageRating totalReviewsReceived reviewCount createdAt role')
      .lean();

    if (!seller || (seller.role !== 'seller' && seller.role !== 'admin')) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }

    const products = await Product.find({
      sellerId: id,
      status: { $in: ['published', 'approved'] },
      banned: false,
      suspended: false,
    })
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      data: { seller, products },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  syncUser,
  getMe,
  updateRole,
  getStore,
};
