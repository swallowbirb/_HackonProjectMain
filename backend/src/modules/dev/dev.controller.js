const axios = require('axios');
const User = require('../users/user.model');
const Brand = require('../brands/brand.model');
const BrandCatalogEntry = require('../brandCatalog/brandCatalogEntry.model');
const SellerOffer = require('../offers/sellerOffer.model');
const Product = require('../products/product.model');
const Order = require('../orders/order.model');
const Review = require('../reviews/review.model');
const BrandEnrollment = require('../brands/brandEnrollment.model');
const Item = require('../items/item.model');
const ItemLog = require('../items/itemLog.model');
const Grade = require('../grading/grading.model');
const Return = require('../returns/return.model');
const LifecycleEvent = require('../lifecycle/lifecycle.model');
const RoutingDecision = require('../routing/routing.model');
const HealthCard = require('../healthCard/healthCard.model');
const TrustProfile = require('../trust/trust.model');

// Erase all data except base mock users
const eraseData = async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ success: false, message: 'Not allowed in production' });
    }

    // Erase content collections
    await Brand.deleteMany({});
    await BrandCatalogEntry.deleteMany({});
    await SellerOffer.deleteMany({});
    await Product.deleteMany({});
    await Order.deleteMany({});
    await Review.deleteMany({});
    await BrandEnrollment.deleteMany({});

    // Erase users that are not base dev users
    await User.deleteMany({ clerkId: { $not: /^mock_/ } });

    res.status(200).json({ success: true, message: 'All data erased except base dev users.' });
  } catch (error) {
    next(error);
  }
};

// Populate data from FakeStoreAPI
const populateData = async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ success: false, message: 'Not allowed in production' });
    }

    // Find the mock seller to assign products to
    const seller = await User.findOne({ clerkId: 'mock_seller' });
    if (!seller) {
      return res.status(404).json({ success: false, message: 'Mock seller not found. Cannot populate.' });
    }

    // Fetch from FakeStoreAPI
    const response = await axios.get('https://fakestoreapi.com/products');
    const fakeProducts = response.data;

    const productsToInsert = fakeProducts.map((p) => ({
      title: p.title,
      description: p.description,
      price: p.price,
      category: p.category,
      images: [p.image],
      brandName: '', // Unbranded
      sellerId: seller._id,
      status: 'approved',
      condition: 'New'
    }));

    await Product.insertMany(productsToInsert);

    res.status(200).json({ 
      success: true, 
      message: `Successfully populated ${productsToInsert.length} products from FakeStoreAPI.` 
    });
  } catch (error) {
    next(error);
  }
};

// Save a JSON snapshot of the DB
const saveData = async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ success: false, message: 'Not allowed in production' });
    }

    // Query all collections
    const [
      users, brands, brandCatalogEntries,
      sellerOffers, products, orders,
      reviews, brandEnrollments
    ] = await Promise.all([
      User.find({}).lean(),
      Brand.find({}).lean(),
      BrandCatalogEntry.find({}).lean(),
      SellerOffer.find({}).lean(),
      Product.find({}).lean(),
      Order.find({}).lean(),
      Review.find({}).lean(),
      BrandEnrollment.find({}).lean(),
    ]);

    const snapshot = {
      timestamp: new Date().toISOString(),
      data: {
        users,
        brands,
        brandCatalogEntries,
        sellerOffers,
        products,
        orders,
        reviews,
        brandEnrollments
      }
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=marketplace-snapshot.json');
    res.status(200).send(JSON.stringify(snapshot, null, 2));
  } catch (error) {
    next(error);
  }
};

/**
 * DEV ONLY — Reset all return/grading pipeline data so you can re-run the
 * return flow on the same product without hitting "already returned" guards.
 *
 * Clears: Items · Grades · LifecycleEvents · ItemLogs · Returns ·
 *         RoutingDecisions · HealthCards · TrustProfiles
 *
 * Optionally scoped to a single user via ?userId=<mongoId> or ?mockClerkId=<id>.
 * Without a scope param it wipes ALL pipeline data (full reset).
 *
 * Orders and Products are intentionally left untouched.
 */
const resetReturnData = async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ success: false, message: 'Not allowed in production' });
    }

    let userFilter = {};          // empty → match everything
    let scopeLabel = 'all users';

    // Optional per-user scope
    const { userId, mockClerkId } = req.query;
    if (userId || mockClerkId) {
      let user = null;
      if (userId) {
        user = await User.findById(userId).lean();
      } else if (mockClerkId) {
        const clerkId = mockClerkId.startsWith('mock_') ? mockClerkId : `mock_${mockClerkId}`;
        user = await User.findOne({ clerkId }).lean();
      }
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      userFilter = { initiatorUserId: user._id };
      scopeLabel = `user ${user._id} (${user.email || mockClerkId || userId})`;
    }

    // Find items matching the scope so we can cascade-delete related docs by itemId
    const items = await Item.find(userFilter).select('_id').lean();
    const itemIds = items.map((i) => i._id);

    const [
      itemsDeleted,
      gradesDeleted,
      eventsDeleted,
      logsDeleted,
      returnsDeleted,
      routingDeleted,
      healthCardsDeleted,
      trustDeleted,
    ] = await Promise.all([
      Item.deleteMany(userFilter),
      Grade.deleteMany({ itemId: { $in: itemIds } }),
      LifecycleEvent.deleteMany({ itemId: { $in: itemIds } }),
      ItemLog.deleteMany({ itemId: { $in: itemIds } }),
      // Returns are keyed by userId (ObjectId); delete all if no scope, or match by user
      userId || mockClerkId
        ? Return.deleteMany({ userId: userFilter.initiatorUserId })
        : Return.deleteMany({}),
      RoutingDecision.deleteMany({ itemId: { $in: itemIds } }),
      HealthCard.deleteMany({ itemId: { $in: itemIds } }),
      // TrustProfiles are per-user; only wipe if scoped
      userId || mockClerkId
        ? TrustProfile.deleteMany({ userId: userFilter.initiatorUserId })
        : TrustProfile.deleteMany({}),
    ]);

    res.status(200).json({
      success: true,
      message: `Return pipeline data reset for ${scopeLabel}.`,
      deleted: {
        items: itemsDeleted.deletedCount,
        grades: gradesDeleted.deletedCount,
        lifecycleEvents: eventsDeleted.deletedCount,
        itemLogs: logsDeleted.deletedCount,
        returns: returnsDeleted.deletedCount,
        routingDecisions: routingDeleted.deletedCount,
        healthCards: healthCardsDeleted.deletedCount,
        trustProfiles: trustDeleted.deletedCount,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  eraseData,
  populateData,
  saveData,
  resetReturnData,
};
