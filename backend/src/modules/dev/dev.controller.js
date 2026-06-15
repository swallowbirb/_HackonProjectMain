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

// Erase ALL data except the demand-map demo data we generated and base dev users.
//
// Preserved on purpose (so the demand map keeps working without re-seeding):
//   • Warehouse    — the Chhattisgarh cities + their map coordinates
//   • DemandConfig — populator-generated per-tag demand peaks / custom tags
//   • Want         — seeded buyer "Looking for…" demand posts
//   • Users with clerkId mock_* (dev logins) and pademo_* (the demo buyers that
//     own the seeded Want posts — kept so those posts aren't orphaned).
//
// Everything else (products, orders, reviews, brands, the return/resale/grading
// pipeline, etc.) is wiped. We clear by enumerating the live collections rather
// than a hard-coded model list so newly-added collections are erased too.
const eraseData = async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ success: false, message: 'Not allowed in production' });
    }

    const mongoose = require('mongoose');
    const Warehouse = require('../demand/warehouse.model');
    const DemandConfig = require('../demand/demandConfig.model');
    const Want = require('../demand/demand.model');

    // Collection names to keep. Derived from the models so a custom collection
    // name on any of them stays correct.
    const preserved = new Set([
      Warehouse.collection.collectionName,
      DemandConfig.collection.collectionName,
      Want.collection.collectionName,
      User.collection.collectionName, // pruned (not fully wiped) below
    ]);

    const collections = await mongoose.connection.db.listCollections().toArray();
    await Promise.all(
      collections
        .filter((c) => !preserved.has(c.name))
        .map((c) => mongoose.connection.db.collection(c.name).deleteMany({}))
    );

    // Keep dev logins (mock_*) and the demand-map demo buyers (pademo_*); wipe
    // every other account.
    await User.deleteMany({ clerkId: { $not: /^(mock_|pademo_)/ } });

    res.status(200).json({
      success: true,
      message: 'Data erased. Demand map preserved: warehouses, generated demand, and buyer wants.',
    });
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

/**
 * DEV ONLY — Quick connectivity probe for the Gemini LLM.
 *
 * Proxies to the ML service's /gemini/ping, which sends a trivial prompt to
 * Gemini and reports success (model + reply) or the exact API error
 * (e.g. RESOURCE_EXHAUSTED, PERMISSION_DENIED). Lets a dev confirm in one click
 * whether the LLM API is reachable and within quota.
 */
const geminiPing = async (req, res, next) => {
  try {
    const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
    const resp = await axios.get(`${ML_SERVICE_URL}/gemini/ping`, { timeout: 30000 });
    return res.status(200).json({ success: true, ...resp.data });
  } catch (error) {
    // ML service unreachable, or it returned a non-2xx. Surface a useful reason.
    const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
    
    if (error.code === 'ECONNREFUSED') {
      return res.status(200).json({
        success: false,
        ok: false,
        error: `ML service connection failed:\n\n` +
               `• Target: ${ML_SERVICE_URL}\n` +
               `• Error: ECONNREFUSED (service not running or unreachable)\n\n` +
               `Possible causes:\n` +
               `1. ML service is not deployed/running on Render\n` +
               `2. ML_SERVICE_URL environment variable is incorrect\n` +
               `3. Network/firewall blocking the connection\n\n` +
               `Current ML_SERVICE_URL: ${ML_SERVICE_URL}`,
        mlServiceUrl: ML_SERVICE_URL,
      });
    }
    
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      return res.status(200).json({
        success: false,
        ok: false,
        error: `ML service timeout:\n\n` +
               `• Target: ${ML_SERVICE_URL}\n` +
               `• Error: ${error.code} (request timed out after 30s)\n\n` +
               `The ML service might be slow to respond or overloaded.`,
        mlServiceUrl: ML_SERVICE_URL,
      });
    }
    
    // If the ML service responded but Gemini failed, pass through its error
    if (error.response?.data) {
      return res.status(200).json({
        success: false,
        ...error.response.data, // This includes ok, model, error from ML service
        mlServiceUrl: ML_SERVICE_URL,
      });
    }
    
    return res.status(200).json({
      success: false,
      ok: false,
      error: `Unexpected error:\n\n${error.message || 'Gemini ping failed'}`,
      mlServiceUrl: ML_SERVICE_URL,
    });
  }
};
    });
  }
};

/**
 * DEV ONLY — Skip the AI grading pipeline and assign a grade by hand.
 *
 * Lets a developer testing the return/resell flow jump straight from evidence
 * intake to routing without waiting on (or paying for) the ML pipeline. It:
 *   1. Upserts a clean, non-flagged Grade for the item (manual grade + reason).
 *   2. Transitions the Item to GRADED and links the grade (via markGraded).
 *   3. Runs the routing engine (computeRoutingDecision) so the item moves on.
 *
 * Body: {
 *   itemId            (required)  Mongo ObjectId of the item
 *   grade             (required)  'A' | 'B' | 'C' | 'D'
 *   rationale         (optional)  free-text reason for the grade
 *   confidence        (optional)  'high' | 'medium' | 'low' (default 'high')
 *   qualityScore      (optional)  0–100 (default derived from grade)
 *   estimatedResalePct(optional)  0–1   (default derived from grade)
 *   routingHint       (optional)  'resell'|'refurbish'|'donate'|'liquidate'
 *   route             (optional)  default true — also run routing after grading
 * }
 */
const GRADE_DEFAULTS = {
  A: { qualityScore: 95, estimatedResalePct: 0.85, routingHint: 'resell' },
  B: { qualityScore: 78, estimatedResalePct: 0.6, routingHint: 'resell' },
  C: { qualityScore: 52, estimatedResalePct: 0.35, routingHint: 'refurbish' },
  D: { qualityScore: 25, estimatedResalePct: 0.1, routingHint: 'donate' },
};

const manualGrade = async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ success: false, message: 'Not allowed in production' });
    }

    const mongoose = require('mongoose');
    const itemService = require('../items/item.service');
    const routingService = require('../routing/routing.service');

    const {
      itemId, grade, rationale, confidence, qualityScore,
      estimatedResalePct, routingHint, route = true,
    } = req.body || {};

    if (!itemId || !mongoose.isValidObjectId(itemId)) {
      return res.status(400).json({ success: false, message: 'A valid itemId is required' });
    }
    const gradeLetter = String(grade || '').toUpperCase();
    if (!['A', 'B', 'C', 'D'].includes(gradeLetter)) {
      return res.status(400).json({ success: false, message: "grade must be one of 'A','B','C','D'" });
    }

    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    const defaults = GRADE_DEFAULTS[gradeLetter];
    const allowedHints = ['resell', 'refurbish', 'donate', 'liquidate'];
    const allowedConfidence = ['high', 'medium', 'low'];

    const gradeDoc = {
      itemId: item._id,
      userId: mongoose.isValidObjectId(item.initiatorUserId) ? item.initiatorUserId : undefined,
      productId: mongoose.isValidObjectId(item.originalProductId) ? item.originalProductId : undefined,
      // Item enum is 'return'|'sell-used'; Grade enum is 'returns'|'sell-used'.
      intakePath: item.intakePath === 'return' ? 'returns' : 'sell-used',
      grade: gradeLetter,
      qualityScore: Number.isFinite(qualityScore) ? Math.max(0, Math.min(100, Math.round(qualityScore))) : defaults.qualityScore,
      confidence: allowedConfidence.includes(confidence) ? confidence : 'high',
      defects: [],
      missingEvidence: [],
      returnClaimVerified: true,
      estimatedResalePct: Number.isFinite(estimatedResalePct)
        ? Math.max(0, Math.min(1, estimatedResalePct))
        : defaults.estimatedResalePct,
      routingHint: allowedHints.includes(routingHint) ? routingHint : defaults.routingHint,
      rationale: (rationale && rationale.trim())
        ? `[Manual dev grade] ${rationale.trim()}`
        : `[Manual dev grade] Grade ${gradeLetter} assigned manually via DevTools (AI grading skipped).`,
      modelVersions: { pass2Model: 'manual-dev-override' },
      evidenceBundle: { imageUrls: item.evidencePhotos || [] },
      flaggedForReview: false,
      reviewReason: '',
      lifecycleEmission: 'skipped',
      status: 'ok',
    };

    const savedGrade = await Grade.findOneAndUpdate(
      { itemId: item._id },
      { $set: gradeDoc },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    await ItemLog.create?.({}).catch?.(() => {}); // no-op guard; logging handled below

    // Transition item → GRADED and link the grade (idempotent).
    await itemService.markGraded(String(item._id), savedGrade);

    // Optionally run routing so the item moves to the routing/disposition stage.
    let routing = null;
    if (route) {
      try {
        routing = await routingService.computeRoutingDecision(String(item._id));
      } catch (err) {
        // Surface but don't fail the whole request — the grade is already saved.
        return res.status(200).json({
          success: true,
          message: `Grade ${gradeLetter} assigned, but routing could not run: ${err.message}`,
          grade: savedGrade,
          routing: null,
          routingError: err.message,
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Grade ${gradeLetter} assigned manually${route ? ' and routed' : ''}.`,
      grade: savedGrade,
      routing,
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
  geminiPing,
  manualGrade,
};
