/**
 * seed-routing.js — ADDITIVE demo seed for Phase A (Smart Routing).
 *
 * Builds graded personas (item + grade + trust profile + reference product),
 * runs the real routing engine on each, and prints the decision + chosen
 * warehouse table. Idempotent: everything is tagged (emails prDemo+*) and
 * re-seeded on run.
 *
 * Prereq for demand signal: run `node seed-demand.js` first so nearby buyer
 * posts + warehouses exist. seed-routing also upserts warehouses defensively.
 *
 * Run: node seed-routing.js  (or npm run seed:routing)
 */
require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');

const User = require('./src/modules/users/user.model');
const Product = require('./src/modules/products/product.model');
const Item = require('./src/modules/items/item.model');
const Grade = require('./src/modules/grading/grading.model');
const TrustProfile = require('./src/modules/trust/trust.model');
const RoutingDecision = require('./src/modules/routing/routing.model');
const Warehouse = require('./src/modules/demand/warehouse.model');
const { WAREHOUSES } = require('./src/modules/routing/routing.config');
const routingService = require('./src/modules/routing/routing.service');

const RAIPUR = { type: 'Point', coordinates: [81.6296, 21.2514] };

async function connect() {
  const primaryUri = process.env.MONGODB_URI;
  const fallbackUri = 'mongodb://127.0.0.1:27017/marketplace';
  try {
    await mongoose.connect(primaryUri, { serverSelectionTimeoutMS: 5000 });
    console.log('Connected to primary DB');
  } catch (err) {
    console.warn(`Primary DB connection failed: ${err.message}`);
    await mongoose.connect(fallbackUri);
    console.log('Connected to fallback DB');
  }
}

// persona: { key, name, tier, score, grade, resalePct, category, price, fraud }
const PERSONAS = [
  { key: 'priya', name: 'Priya', tier: 'verified', score: 95, grade: 'A', resalePct: 0.75, category: 'Sports', price: 3000 },
  { key: 'rahul', name: 'Rahul', tier: 'trusted', score: 80, grade: 'B', resalePct: 0.6, category: 'Electronics', price: 12000 },
  { key: 'anjali', name: 'Anjali', tier: 'standard', score: 60, grade: 'A', resalePct: 0.7, category: 'Home & Garden', price: 5000 },
  { key: 'hygiene', name: 'Hema', tier: 'verified', score: 92, grade: 'A', resalePct: 0.7, category: 'Health & Beauty', price: 800 },
  { key: 'counterfeit', name: 'Karan', tier: 'standard', score: 55, grade: 'B', resalePct: 0.5, category: 'Electronics', price: 9000, fraud: true },
  { key: 'lowtrust', name: 'Lokesh', tier: 'watch', score: 35, grade: 'B', resalePct: 0.55, category: 'Clothing', price: 1500 },
  { key: 'restricted', name: 'Raghav', tier: 'restricted', score: 10, grade: 'C', resalePct: 0.3, category: 'Books', price: 600 },
];

async function clearPrevious() {
  const demoUsers = await User.find({ email: /^prDemo\+/ }).select('_id').lean();
  const ids = demoUsers.map((u) => u._id);
  if (ids.length) {
    const items = await Item.find({ initiatorUserId: { $in: ids } }).select('_id').lean();
    const itemIds = items.map((i) => i._id);
    await Grade.deleteMany({ itemId: { $in: itemIds } });
    await RoutingDecision.deleteMany({ itemId: { $in: itemIds } });
    await Item.deleteMany({ _id: { $in: itemIds } });
    await Product.deleteMany({ sellerId: { $in: ids } });
    await TrustProfile.deleteMany({ userId: { $in: ids } });
  }
}

async function seedWarehouses() {
  for (const wh of WAREHOUSES) {
    await Warehouse.findOneAndUpdate({ code: wh.code }, wh, { upsert: true, setDefaultsOnInsert: true });
  }
}

async function buildPersona(p, idx) {
  const email = `prDemo+${p.key}@example.com`;
  const user = await User.findOneAndUpdate(
    { email },
    { email, clerkId: `prdemo_${p.key}`, role: 'buyer', firstName: p.name },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const seller = await User.findOneAndUpdate(
    { email: 'prDemo+seller@example.com' },
    { email: 'prDemo+seller@example.com', clerkId: 'prdemo_seller', role: 'seller', firstName: 'DemoSeller' },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Fix the trust profile to the desired tier (overwrite lastComputed=now so it's not recomputed).
  await TrustProfile.findOneAndUpdate(
    { userId: user._id },
    { userId: user._id, tier: p.tier, score: p.score, lastComputed: new Date() },
    { upsert: true, setDefaultsOnInsert: true }
  );

  const product = await Product.create({
    title: `${p.name}'s ${p.category} item`,
    description: 'Demo reference product for routing seed.',
    price: p.price,
    category: p.category,
    sellerId: seller._id,
    condition: 'Used',
    status: 'approved',
  });

  const item = await Item.create({
    intakePath: 'return',
    initiatorUserId: user._id,
    originalProductId: product._id,
    category: p.category,
    reasonCode: 'changed_mind',
    description: `${p.category} item from ${p.name}`,
    status: 'GRADED',
    trustTierAtSubmission: p.tier,
  });

  await Grade.create({
    itemId: item._id,
    userId: user._id,
    productId: product._id,
    intakePath: 'returns',
    grade: p.grade,
    qualityScore: p.grade === 'A' ? 90 : p.grade === 'B' ? 75 : p.grade === 'C' ? 55 : 30,
    confidence: 'high',
    estimatedResalePct: p.resalePct,
    routingHint: 'resell',
    rationale: `Seeded ${p.grade}-grade ${p.category} item.`,
    defects: [],
    evidenceBundle: p.fraud ? { fraud: { classification: 'hard_fraud' } } : {},
    flaggedForReview: false,
    status: 'ok',
  });

  return { user, item, persona: p };
}

(async () => {
  const rows = [];
  try {
    await connect();
    await clearPrevious();
    await seedWarehouses();

    let idx = 0;
    for (const p of PERSONAS) {
      const { item, persona } = await buildPersona(p, idx++);
      try {
        const decision = await routingService.computeRoutingDecision(item._id, {
          sellerLocation: RAIPUR,
          counterfeit: persona.fraud,
        });
        rows.push({
          persona: persona.name,
          tier: persona.tier,
          grade: persona.grade,
          path: decision.chosenPath,
          warehouse: decision.chosenWarehouse?.code || (decision.matchWindow?.active ? 'PEER-HOLD' : '—'),
          demand: decision.demandSignal.count,
          refund: decision.refundTiming,
          gates: decision.hardGatesApplied.join(',') || '—',
        });
      } catch (err) {
        rows.push({ persona: persona.name, tier: persona.tier, grade: persona.grade, path: `ERROR: ${err.message}`, warehouse: '—', demand: '—', refund: '—', gates: '—' });
      }
    }

    console.log('\n── Routing decisions ─────────────────────────────────────────');
    console.table(rows);
    console.log('✅ seed-routing complete.');
  } catch (err) {
    console.error('seed-routing failed:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
