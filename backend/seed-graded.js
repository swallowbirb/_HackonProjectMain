/**
 * seed-graded.js — seeds items stuck at GRADED status so you can demo
 * the "Run routing engine" button on ItemStatusPage live.
 *
 * Additive + idempotent (tagged pgDemo+*). Does NOT run the routing engine —
 * that's the whole point. Visit /items/:id/status and click the button.
 *
 * Run: node seed-graded.js
 */
require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');

const User    = require('./src/modules/users/user.model');
const Product = require('./src/modules/products/product.model');
const Item    = require('./src/modules/items/item.model');
const Grade   = require('./src/modules/grading/grading.model');
const TrustProfile = require('./src/modules/trust/trust.model');

const IMG = (seed) => `https://picsum.photos/seed/${seed}/600/600`;

// Each persona stops at GRADED — different trust tiers so routing produces
// different outcomes when triggered from the UI.
const PERSONAS = [
  {
    key: 'priya_g',   name: 'Priya',  tier: 'verified',   score: 95,
    grade: 'A', resalePct: 0.75, category: 'Sports',
    product: 'Nike Air Zoom Pegasus Running Shoes', price: 8999,
    intakePath: 'return',
    rationale: 'Upper mesh clean, sole wear minimal. Photos consistent with light use under 50 km.',
    defects: [{ type: 'scuff', severity: 'minor', location: 'left toe cap', description: 'surface scuff, non-structural' }],
    ownerNotes: 'Bought 6 months ago, used only for morning runs. Comes with original box.',
  },
  {
    key: 'rahul_g',   name: 'Rahul',  tier: 'trusted',    score: 80,
    grade: 'B', resalePct: 0.6, category: 'Electronics',
    product: 'Sony WH-1000XM5 Headphones', price: 26990,
    intakePath: 'sell-used',
    rationale: 'Fully functional, ANC works, ear cushions show moderate creasing. All accessories present.',
    defects: [{ type: 'wear', severity: 'moderate', location: 'ear cushions', description: 'visible creasing on both cups' }],
    ownerNotes: 'Upgrading to newer model. Works perfectly.',
  },
  {
    key: 'lokesh_g',  name: 'Lokesh', tier: 'watch',       score: 35,
    grade: 'B', resalePct: 0.55, category: 'Clothing',
    product: 'H&M Slim Fit Winter Jacket', price: 3499,
    intakePath: 'return',
    rationale: 'Jacket functional, zip works, minor pilling on cuffs. Return reason inconsistent with observed condition.',
    defects: [{ type: 'pilling', severity: 'minor', location: 'cuffs', description: 'light pilling, normal wear' }],
    ownerNotes: '',
  },
  {
    key: 'raghav_g',  name: 'Raghav', tier: 'restricted',  score: 10,
    grade: 'C', resalePct: 0.3,  category: 'Books',
    product: 'NCERT Class 12 Physics Textbook Set', price: 850,
    intakePath: 'return',
    rationale: 'Books present but visibly annotated throughout. Condition worse than return claim stated.',
    defects: [{ type: 'annotation', severity: 'major', location: 'throughout', description: 'heavy pencil marks and highlighting on most pages' }],
    ownerNotes: '',
  },
];

async function connect() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    console.log('Connected to primary DB');
  } catch (err) {
    console.warn(`Primary failed: ${err.message}`);
    await mongoose.connect('mongodb://127.0.0.1:27017/marketplace');
    console.log('Connected to fallback DB');
  }
}

async function clearPrevious() {
  const users = await User.find({ email: /^pgDemo\+/ }).select('_id').lean();
  const ids = users.map((u) => u._id);
  if (!ids.length) return;
  const items = await Item.find({ initiatorUserId: { $in: ids } }).select('_id').lean();
  const itemIds = items.map((i) => i._id);
  await Grade.deleteMany({ itemId: { $in: itemIds } });
  await Item.deleteMany({ _id: { $in: itemIds } });
  await Product.deleteMany({ sellerId: { $in: ids } });
  await TrustProfile.deleteMany({ userId: { $in: ids } });
  await User.deleteMany({ _id: { $in: ids } });
}

async function getOrCreateSeller() {
  return User.findOneAndUpdate(
    { email: 'pgDemo+seller@example.com' },
    { email: 'pgDemo+seller@example.com', clerkId: 'pgdemo_seller', role: 'seller', firstName: 'GradedSeller' },
    { upsert: true, new: true }
  );
}

// Seed items under mock_buyer so the dev bypass (mock_buyer) can access them.
async function getMockBuyer() {
  return User.findOne({ clerkId: 'mock_buyer' }).lean();
}

async function buildPersona(p, seller, buyer) {
  // Each persona gets its own trust profile overriding mock_buyer's default —
  // we create a separate User per persona only for the TrustProfile, but the
  // Item initiator is mock_buyer so the status page is accessible.
  const demoUser = await User.findOneAndUpdate(
    { email: `pgDemo+${p.key}@example.com` },
    { email: `pgDemo+${p.key}@example.com`, clerkId: `pgdemo_${p.key}`, role: 'buyer', firstName: p.name },
    { upsert: true, new: true }
  );

  // Override mock_buyer's trust profile to this persona's tier for routing demo.
  await TrustProfile.findOneAndUpdate(
    { userId: buyer._id },
    { userId: buyer._id, tier: p.tier, score: p.score, lastComputed: new Date() },
    { upsert: true }
  );

  const product = await Product.create({
    title: p.product,
    description: `Original listing for ${p.product}.`,
    price: p.price,
    category: p.category,
    images: [IMG(p.key + '-orig')],
    condition: 'New',
    sellerId: seller._id,
    status: 'approved',
  });

  const item = await Item.create({
    intakePath: p.intakePath,
    initiatorUserId: buyer._id,   // mock_buyer owns the item — accessible from dev bypass
    originalProductId: product._id,
    category: p.category,
    reasonCode: p.intakePath === 'return' ? 'not_as_described' : 'other',
    description: p.product,
    evidencePhotos: [IMG(p.key + '-1'), IMG(p.key + '-2')],
    ownerNotes: p.ownerNotes,
    status: 'GRADED',
    trustTierAtSubmission: p.tier,
  });

  const grade = await Grade.create({
    itemId: item._id,
    userId: buyer._id,
    productId: product._id,
    intakePath: p.intakePath === 'return' ? 'returns' : 'sell-used',
    grade: p.grade,
    qualityScore: p.grade === 'A' ? 88 : p.grade === 'B' ? 72 : 50,
    confidence: 'high',
    estimatedResalePct: p.resalePct,
    routingHint: 'resell',
    rationale: p.rationale,
    defects: p.defects,
    evidenceBundle: { imageUrls: [IMG(p.key + '-1'), IMG(p.key + '-2')] },
    flaggedForReview: false,
    status: 'ok',
  });

  await Item.findByIdAndUpdate(item._id, { gradeId: grade._id });
  return { item };
}

(async () => {
  try {
    await connect();
    await clearPrevious();
    const seller = await getOrCreateSeller();
    const buyer = await getMockBuyer();

    if (!buyer) {
      console.error('mock_buyer not found. Run: node seed-mock-users.js first');
      process.exitCode = 1;
      return;
    }

    console.log('\nSeeding GRADED items under mock_buyer (routing engine NOT run):\n');
    for (const p of PERSONAS) {
      const { item } = await buildPersona(p, seller, buyer);
      console.log(
        `  [${p.grade}] ${p.name.padEnd(8)} trust:${p.tier.padEnd(10)} ` +
        `→ /items/${item._id}/status`
      );
    }
    // Leave mock_buyer with 'verified' trust (Priya's tier) as the default.
    await TrustProfile.findOneAndUpdate(
      { userId: buyer._id },
      { tier: 'verified', score: 95, lastComputed: new Date() },
      { upsert: true }
    );

    console.log('\n✅ Done. Sign in as mock_buyer via Dev Bypass, then visit each URL above.\n');
    console.log('   Each visit shows a different trust tier — just re-run this script between');
    console.log('   demos to reset, or use the "Run routing engine" button on each item.\n');
  } catch (err) {
    console.error('seed-graded failed:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
