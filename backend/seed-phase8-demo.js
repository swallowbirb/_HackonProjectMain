/**
 * seed-phase8-demo.js — ADDITIVE demo seed to test Phase 8 (Sustainability) in the UI.
 *
 * Attaches everything to the `mock_buyer` user (click "Buyer" in the Dev Bypass panel):
 *   • Ensures NGOs exist (Raipur/Bilaspur) for the donation flow.
 *   • Creates GRADED items owned by mock_buyer  → donatable from the item status page.
 *   • Creates PUBLISHED resale listings (+ mirror products) → buyable on /resale (+10 credits).
 *   • Seeds a small starting green-credit balance so the redeem toggle shows immediately.
 *
 * Idempotent: clears only what it created (tagged) before re-seeding.
 *
 * Run: node seed-phase8-demo.js   (or: npm run seed:phase8)
 */
require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');

const User = require('./src/modules/users/user.model');
const Item = require('./src/modules/items/item.model');
const Grade = require('./src/modules/grading/grading.model');
const Product = require('./src/modules/products/product.model');
const ResaleListing = require('./src/modules/resale/resale.model');
const Ngo = require('./src/modules/sustainability/ngo.model');
const SustainabilityImpact = require('./src/modules/sustainability/sustainability.model');
const GreenCreditLedger = require('./src/modules/sustainability/greenCredit.model');
const LifecycleEvent = require('./src/modules/lifecycle/lifecycle.model');

const TAG = 'p8demo-seed';
const PROD_TAG = '[P8]';
const { GRADE_TO_CONDITION_LANE } = require('./src/contracts/resaleListing.contract');

async function connect() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    console.log('Connected to primary DB');
  } catch (e) {
    await mongoose.connect('mongodb://127.0.0.1:27017/marketplace');
    console.log('Connected to fallback DB');
  }
}

async function ensureUser(clerkId, role, fields = {}) {
  let u = await User.findOne({ clerkId });
  if (!u) {
    u = await User.create({ clerkId, email: `${clerkId}@example.com`, role, firstName: fields.firstName || role, ...fields });
  }
  return u;
}

async function ensureNgos() {
  const count = await Ngo.countDocuments({ active: true });
  if (count > 0) return;
  const RAIPUR = { lng: 81.6296, lat: 21.2514 };
  await Ngo.insertMany([
    { name: 'Goonj Raipur', categoriesAccepted: ['clothing', 'footwear'], location: { type: 'Point', coordinates: [RAIPUR.lng + 0.01, RAIPUR.lat + 0.01] }, pickupRadiusKm: 20, city: 'Raipur', active: true, seedTag: 'p8demo' },
    { name: 'Robin Hood Army Raipur', categoriesAccepted: [], location: { type: 'Point', coordinates: [RAIPUR.lng - 0.01, RAIPUR.lat - 0.02] }, pickupRadiusKm: 25, city: 'Raipur', active: true, seedTag: 'p8demo' },
    { name: 'Smile Foundation Electronics Drive', categoriesAccepted: ['electronics', 'books'], location: { type: 'Point', coordinates: [RAIPUR.lng - 0.02, RAIPUR.lat + 0.015] }, pickupRadiusKm: 25, city: 'Raipur', active: true, seedTag: 'p8demo' },
  ]);
  console.log('Seeded 3 fallback NGOs.');
}

async function clearPrevious(buyer, seller) {
  // Items + their grades/events created by this seed.
  const items = await Item.find({ description: TAG }).select('_id').lean();
  const itemIds = items.map((i) => i._id);
  if (itemIds.length) {
    await Grade.deleteMany({ itemId: { $in: itemIds } });
    await LifecycleEvent.deleteMany({ itemId: { $in: itemIds } });
    await SustainabilityImpact.deleteMany({ itemId: { $in: itemIds } });
    await Item.deleteMany({ _id: { $in: itemIds } });
  }
  // Resale listings + mirror products created by this seed.
  const listings = await ResaleListing.find({ title: new RegExp(`^\\${PROD_TAG}`) }).select('_id marketplaceProductId').lean();
  const productIds = listings.map((l) => l.marketplaceProductId).filter(Boolean);
  await ResaleListing.deleteMany({ title: new RegExp(`^\\${PROD_TAG}`) });
  await Product.deleteMany({ title: new RegExp(`^\\${PROD_TAG}`) });
  if (productIds.length) await SustainabilityImpact.deleteMany({ itemId: { $in: productIds } });
  // Reset the demo buyer's credit ledger so the starting balance is deterministic.
  if (buyer) await GreenCreditLedger.deleteMany({ userId: buyer._id });
}

// Build a grade + item pair owned by the buyer, in GRADED state (donatable).
async function makeGradedItem(buyer, { category, grade, qualityScore, defects = [], rationale }) {
  const item = await Item.create({
    intakePath: 'sell-used',
    initiatorUserId: buyer._id,
    category,
    description: TAG,
    status: 'GRADED',
    reasonText: 'Phase 8 demo item',
  });
  const gradeDoc = await Grade.create({
    itemId: item._id,
    userId: buyer._id,
    intakePath: 'sell-used',
    grade,
    qualityScore,
    confidence: 'high',
    defects,
    returnClaimVerified: true,
    estimatedResalePct: grade === 'A' ? 0.7 : grade === 'B' ? 0.55 : 0.35,
    routingHint: 'resell',
    rationale,
  });
  await Item.findByIdAndUpdate(item._id, { gradeId: gradeDoc._id });
  await LifecycleEvent.create({ itemId: item._id, sequence: 0, eventType: 'GRADED', actor: { role: 'system' }, data: { grade } });
  return item;
}

// Build a PUBLISHED resale listing + mirror product (buyable, gives buyer +10).
async function makeResaleListing(seller, { category, grade, qualityScore, price, title, rationale }) {
  const lane = GRADE_TO_CONDITION_LANE[grade] || 'good';
  const images = [`https://picsum.photos/seed/${encodeURIComponent(title)}/600/600`];

  const product = await Product.create({
    title: `${PROD_TAG} ${title}`,
    description: `Certified pre-owned ${category}. AI-graded ${grade}.`,
    price,
    category,
    images,
    condition: 'Used',
    sellerId: seller._id,
    status: 'approved',
  });

  // A backing item so the listing has a valid itemId.
  const item = await Item.create({
    intakePath: 'sell-used',
    initiatorUserId: seller._id,
    category,
    description: TAG,
    status: 'LISTED',
  });

  await ResaleListing.create({
    itemId: item._id,
    sellerId: seller._id,
    intakePath: 'sell-used',
    title: `${PROD_TAG} ${title} — Certified Pre-Owned`,
    description: rationale,
    category,
    images,
    originalPrice: Math.round(price / (grade === 'A' ? 0.7 : 0.5)),
    suggestedPrice: price,
    price,
    conditionLane: lane,
    grade,
    qualityScore,
    gradeRationale: rationale,
    defects: [],
    status: 'PUBLISHED',
    marketplaceProductId: product._id,
  });
  return product;
}

async function run() {
  await connect();

  const buyer = await ensureUser('mock_buyer', 'buyer', { firstName: 'Demo', lastName: 'Buyer' });
  const seller = await ensureUser('mock_seller', 'seller', { firstName: 'Demo', storeName: 'Second-Life Store' });

  console.log('Clearing previous p8 demo data...');
  await clearPrevious(buyer, seller);
  await ensureNgos();

  // 1) Donatable graded items owned by the buyer.
  await makeGradedItem(buyer, { category: 'footwear', grade: 'C', qualityScore: 58, defects: [{ type: 'scuff', severity: 'moderate', location: 'toe', description: 'visible wear' }], rationale: 'Worn soles, usable but low resale value — a good donation candidate.' });
  await makeGradedItem(buyer, { category: 'clothing', grade: 'B', qualityScore: 76, rationale: 'Gently used jacket, minor fading. Resellable or donatable.' });
  await makeGradedItem(buyer, { category: 'electronics', grade: 'A', qualityScore: 91, rationale: 'Like-new headphones with original box.' });

  // 2) Buyable published resale listings (each purchase = +10 credits to buyer).
  await makeResaleListing(seller, { category: 'clothing', grade: 'A', qualityScore: 90, price: 899, title: 'Levi’s Denim Jacket', rationale: 'Barely worn, like-new denim jacket. Saves water vs buying new.' });
  await makeResaleListing(seller, { category: 'footwear', grade: 'B', qualityScore: 72, price: 1299, title: 'Nike Running Shoes', rationale: 'Good-condition running shoes, light tread wear.' });
  await makeResaleListing(seller, { category: 'electronics', grade: 'B', qualityScore: 80, price: 4499, title: 'Sony Wireless Headphones', rationale: 'Good condition, fully functional, includes case.' });

  // 3) Starting green-credit balance so redeem works right away.
  await GreenCreditLedger.create({ userId: buyer._id, delta: 30, reason: 'donation', itemId: null, balanceAfter: 30 });

  // Summary
  const items = await Item.find({ initiatorUserId: buyer._id, description: TAG }).lean();
  const listings = await ResaleListing.find({ status: 'PUBLISHED', title: new RegExp(`^\\${PROD_TAG}`) }).lean();

  console.log('\n=== Phase 8 demo seeded ===');
  console.log(`Login: open the app → "Dev Bypass" (bottom-right) → "Buyer"  (mock_buyer)`);
  console.log(`\nDonatable graded items (see /orders → Returns & Listings → open → "Donate instead"):`);
  items.forEach((i) => console.log(`  • ${i.category.padEnd(12)} ${i._id}`));
  console.log(`\nBuyable resale listings (see /resale → +10 credits on purchase):`);
  listings.forEach((l) => console.log(`  • ${l.title}  ₹${l.price}`));
  console.log(`\nStarting green-credit balance: 30  (redeem toggle works immediately in cart/resale checkout)`);

  await mongoose.disconnect();
  console.log('\nDone. Disconnected.');
}

run().catch(async (e) => {
  console.error(e);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
