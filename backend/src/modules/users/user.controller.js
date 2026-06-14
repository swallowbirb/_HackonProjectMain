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
      // Fetch full user details from Clerk's SDK
      const clerkUser = await clerkClient.users.getUser(clerkId);
      email = clerkUser.emailAddresses && clerkUser.emailAddresses.length > 0 
        ? clerkUser.emailAddresses[0].emailAddress 
        : req.body.email;
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
      return res.status(400).json({ success: false, message: 'Missing required user data' });
    }

    const user = await userService.syncUser(userData);

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
