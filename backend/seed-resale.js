/**
 * seed-resale.js — ADDITIVE demo seed for Phase B (Resale Marketplace).
 *
 * Self-contained: does NOT depend on Phase A (routing/demand). It fabricates a
 * few graded + routed items, drives them through the real resale seam
 * (createDraftFromRouting) and publishes them, so the storefront is demoable on
 * a fresh DB. Idempotent: tags everything (emails pBdemo+*) and removes only
 * those on re-run.
 *
 * Run: node seed-resale.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

const User = require('./src/modules/users/user.model');
const Item = require('./src/modules/items/item.model');
const Grade = require('./src/modules/grading/grading.model');
const Product = require('./src/modules/products/product.model');
const ResaleListing = require('./src/modules/resale/resale.model');
const resaleService = require('./src/modules/resale/resale.service');

async function connect() {
  const primaryUri = process.env.MONGODB_URI;
  const fallbackUri = 'mongodb://127.0.0.1:27017/marketplace';
  try {
    console.log('Connecting to primary database...');
    await mongoose.connect(primaryUri, { serverSelectionTimeoutMS: 5000 });
    console.log('Connected to primary DB');
  } catch (err) {
    console.warn(`Primary DB connection failed: ${err.message}`);
    console.log(`Connecting to fallback local DB: ${fallbackUri}`);
    await mongoose.connect(fallbackUri);
    console.log('Connected to fallback DB');
  }
}

const IMG = (seed) => `https://picsum.photos/seed/${seed}/600/600`;

// Demo personas → routed resell-class items.
const PERSONAS = [
  {
    handle: 'rahul',
    intakePath: 'sell-used',
    category: 'Footwear',
    productTitle: 'Nike Pegasus 40 Running Shoes',
    originalPrice: 9999,
    chosenPath: 'resell',
    demandCount: 7,
    grade: { grade: 'A', qualityScore: 92, confidence: 'high', estimatedResalePct: 0.7,
      rationale: 'Minimal sole wear, uppers clean, no structural damage. Photos consistent with light use.',
      defects: [{ type: 'scuff', severity: 'minor', location: 'left toe', description: 'faint surface scuff' }] },
  },
  {
    handle: 'anjali',
    intakePath: 'return',
    category: 'Electronics',
    productTitle: 'Sony WH-1000XM4 Headphones',
    originalPrice: 24990,
    chosenPath: 'resell',
    demandCount: 4,
    grade: { grade: 'B', qualityScore: 78, confidence: 'high', estimatedResalePct: 0.55,
      rationale: 'Fully functional, mild ear-cup wear, all accessories present.',
      defects: [{ type: 'wear', severity: 'moderate', location: 'ear cushions', description: 'visible creasing' }] },
  },
  {
    handle: 'meera',
    intakePath: 'sell-used',
    category: 'Furniture',
    productTitle: 'Ergonomic Mesh Office Chair',
    originalPrice: 12999,
    chosenPath: 'refurbish',
    demandCount: 2,
    grade: { grade: 'C', qualityScore: 61, confidence: 'medium', estimatedResalePct: 0.4,
      rationale: 'Mechanism sound, fabric stained, needs cleaning. Suitable for resale after refurb.',
      defects: [{ type: 'stain', severity: 'moderate', location: 'seat', description: 'coffee stain' }] },
  },
  {
    handle: 'vikram',
    intakePath: 'return',
    category: 'Electronics',
    productTitle: 'Samsung Galaxy Tab S6 Lite',
    originalPrice: 18999,
    chosenPath: 'peer-redistribute',
    demandCount: 9,
    grade: { grade: 'A', qualityScore: 95, confidence: 'high', estimatedResalePct: 0.72,
      rationale: 'Like-new, screen pristine, battery health excellent. High nearby demand.',
      defects: [] },
  },
];

async function clearPrevious() {
  const demoUsers = await User.find({ email: /^pBdemo\+/ }).select('_id').lean();
  const ids = demoUsers.map((u) => u._id);
  const items = await Item.find({ initiatorUserId: { $in: ids } }).select('_id').lean();
  const itemIds = items.map((i) => i._id);

  const listings = await ResaleListing.find({ itemId: { $in: itemIds } }).select('marketplaceProductId').lean();
  const productIds = listings.map((l) => l.marketplaceProductId).filter(Boolean);

  await Product.deleteMany({ _id: { $in: productIds } });
  await ResaleListing.deleteMany({ itemId: { $in: itemIds } });
  await Grade.deleteMany({ itemId: { $in: itemIds } });
  await Item.deleteMany({ _id: { $in: itemIds } });
  await User.deleteMany({ _id: { $in: ids } });
}

async function makeSeller() {
  return User.create({
    clerkId: 'mock_pB_seller',
    email: 'pBdemo+seller@example.com',
    role: 'seller',
    firstName: 'Resale',
    lastName: 'Depot',
    storeName: 'Second-Life Depot',
  });
}

async function buildPersona(persona, seller, idx) {
  const initiator = await User.create({
    clerkId: `mock_pB_${persona.handle}`,
    email: `pBdemo+${persona.handle}@example.com`,
    role: 'buyer',
    firstName: persona.handle,
  });

  // For returns we attach an original product owned by the demo seller so the
  // seller-resolution + originalPrice paths are exercised.
  let originalProductId = null;
  if (persona.intakePath === 'return') {
    const product = await Product.create({
      title: persona.productTitle,
      description: `Original listing for ${persona.productTitle}.`,
      price: persona.originalPrice,
      category: persona.category,
      images: [IMG(`${persona.handle}-orig`)],
      condition: 'New',
      sellerId: seller._id,
      status: 'approved',
    });
    originalProductId = product._id;
  }

  // Item is created already in ROUTED state (Phase A would have done this).
  const item = await Item.create({
    intakePath: persona.intakePath,
    initiatorUserId: initiator._id,
    originalProductId,
    category: persona.category,
    reasonCode: 'other',
    description: persona.productTitle,
    status: 'ROUTED',
    evidencePhotos: [IMG(`${persona.handle}-1`), IMG(`${persona.handle}-2`)],
    ownerNotes: idx % 2 === 0 ? 'Bought this last year, barely used. Selling because I upgraded.' : '',
  });

  const grade = await Grade.create({
    itemId: item._id,
    userId: initiator._id,
    intakePath: persona.intakePath === 'return' ? 'returns' : 'sell-used',
    ...persona.grade,
    routingHint: persona.chosenPath === 'refurbish' ? 'refurbish' : 'resell',
    evidenceBundle: { imageUrls: item.evidencePhotos },
    lifecycleEmission: 'emitted',
    status: 'ok',
  });

  await Item.findByIdAndUpdate(item._id, { gradeId: grade._id });

  // Drive the real seam, then publish.
  const routingDecision = {
    _id: new mongoose.Types.ObjectId(),
    chosenPath: persona.chosenPath,
    demandSignal: { count: persona.demandCount, radiusKm: 25 },
  };

  const draft = await resaleService.createDraftFromRouting({ itemId: item._id, routingDecision, grade });
  if (!draft) {
    console.warn(`  ! draft not created for ${persona.handle} (path: ${persona.chosenPath})`);
    return null;
  }
  // Publish as the listing's resolved owner (sell-used → initiator; return → original seller).
  const actingUser = { _id: draft.sellerId, role: 'seller' };
  const published = await resaleService.publish(draft._id, actingUser);
  return { persona, listing: published };
}

async function main() {
  await connect();
  console.log('\nClearing previous pBdemo data...');
  await clearPrevious();

  const seller = await makeSeller();
  console.log(`Created demo seller: ${seller.storeName} (${seller._id})\n`);

  const results = [];
  for (let i = 0; i < PERSONAS.length; i++) {
    const r = await buildPersona(PERSONAS[i], seller, i);
    if (r) results.push(r);
  }

  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('Resale storefront seeded:');
  console.log('─────────────────────────────────────────────────────────────');
  for (const { persona, listing } of results) {
    console.log(
      `  [${listing.grade}] ${listing.title}\n` +
        `      path=${persona.chosenPath}  lane=${listing.conditionLane}  ` +
        `orig=₹${listing.originalPrice}  suggested=₹${listing.suggestedPrice}  ` +
        `demand=${listing.demandCount}  status=${listing.status}`
    );
  }
  console.log('─────────────────────────────────────────────────────────────');
  console.log(`\n✅ ${results.length} published resale listings. Visit /resale to view.\n`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('seed-resale failed:', err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
