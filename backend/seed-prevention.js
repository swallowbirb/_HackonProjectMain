/**
 * seed-prevention.js — ADDITIVE demo seed for Phase 7 (Prevention Layer).
 *
 * Uses mock_seller so the Return Insights tab is visible on the seller dashboard.
 * Idempotent: tags everything with [P7-DEMO] prefix and p7demo+ emails.
 *
 * Creates 6 SKUs across 4 categories with realistic return patterns:
 *   1. Footwear       — runs small  (~30% return, fit verdict: runs_small)
 *   2. Apparel        — runs large  (~28% return, fit verdict: runs_large)
 *   3. Electronics    — compat issues (~18% return, compat: issues_reported)
 *   4. Furniture/Home — too large   (~22% return, dim: too_large)
 *   5. Electronics    — healthy     (~5% return, all signals clean)
 *   6. Apparel        — improving   (rate was 40%, now 15% — shows "improved" badge)
 *
 * Run: node seed-prevention.js (from backend/)
 */

require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');

const User = require('./src/modules/users/user.model');
const Product = require('./src/modules/products/product.model');
const Order = require('./src/modules/orders/order.model');
const Return = require('./src/modules/returns/return.model');
const Review = require('./src/modules/reviews/review.model');
const ReturnInsight = require('./src/modules/prevention/returnInsight.model');
const NudgeEvent = require('./src/modules/prevention/nudgeEvent.model');
const TrustProfile = require('./src/modules/trust/trust.model');
const trustService = require('./src/modules/trust/trust.service');
const { recomputeReturnInsights } = require('./src/modules/prevention/prevention.job');

const DAY_MS = 86400000;
const daysAgo = (n) => new Date(Date.now() - n * DAY_MS);

// ── DB connection ───────────────────────────────────────────────────────────
async function connect() {
  try {
    console.log('Connecting to primary database...');
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    console.log('Connected.');
  } catch (err) {
    console.warn(`Primary failed: ${err.message}, trying local...`);
    await mongoose.connect('mongodb://127.0.0.1:27017/marketplace');
    console.log('Connected to local DB.');
  }
}

async function backdate(Model, id, date) {
  await Model.collection.updateOne({ _id: id }, { $set: { createdAt: date } });
}

// ── Cleanup (idempotent) ─────────────────────────────────────────────────────
async function clearPrevious() {
  const demoProducts = await Product.find({ title: /^\[P7-DEMO\]/ }).select('_id').lean();
  const demoUsers = await User.find({ email: /^p7demo\+/ }).select('_id').lean();
  const productIds = demoProducts.map((p) => p._id);
  const userIds = demoUsers.map((u) => u._id);

  await Order.deleteMany({ $or: [{ buyerId: { $in: userIds } }, { productId: { $in: productIds } }] });
  await Return.deleteMany({ $or: [{ userId: { $in: userIds } }, { originalProductId: { $in: productIds } }] });
  await Review.deleteMany({ productId: { $in: productIds } });
  await NudgeEvent.deleteMany({ $or: [{ userId: { $in: userIds } }, { productId: { $in: productIds } }] });
  await ReturnInsight.deleteMany({ productId: { $in: productIds } });
  await TrustProfile.deleteMany({ userId: { $in: userIds } });
  await Product.deleteMany({ _id: { $in: productIds } });
  await User.deleteMany({ _id: { $in: userIds } });
  console.log(`  Cleared ${productIds.length} products, ${userIds.length} demo users.`);
}

// ── Builders ─────────────────────────────────────────────────────────────────
async function makeUser(handle, extra = {}) {
  const u = await User.create({
    clerkId: `mock_p7_${handle}`,
    email: `p7demo+${handle}@example.com`,
    role: 'buyer',
    firstName: handle.charAt(0).toUpperCase() + handle.slice(1),
    ...extra,
  });
  if (extra.accountAgeDays) {
    await backdate(User, u._id, daysAgo(extra.accountAgeDays));
  }
  return u;
}

async function makeProduct(seller, { title, category, price, brandName, averageRating = 4.0, reviewCount = 0, images }) {
  return Product.create({
    title: `[P7-DEMO] ${title}`,
    description: `Phase 7 demo product — ${title}. This SKU has been seeded with realistic return history to power the Prevention Intelligence Layer.`,
    price,
    category,
    brandName: brandName || '',
    images: images || [`https://picsum.photos/seed/${encodeURIComponent(title)}/600/600`],
    sellerId: seller._id,
    averageRating,
    reviewCount,
    status: 'approved',
    condition: 'New',
  });
}

async function makeOrder(buyer, seller, product, daysOld = 30) {
  const o = await Order.create({
    buyerId: buyer._id,
    sellerId: seller._id,
    productId: product._id,
    quantity: 1,
    totalPrice: product.price,
    status: 'completed',
    paymentDetails: { mockCreditCard: '4242424242424242' },
  });
  await backdate(Order, o._id, daysAgo(daysOld));
  return o;
}

async function makeReturn(buyer, order, product, { reasonCode, reasonText, daysOld = 10 }) {
  const r = await Return.create({
    orderId: order._id,
    userId: buyer._id,
    itemId: new mongoose.Types.ObjectId(),
    reasonCode,
    reasonText,
    originalProductId: product._id,
    productTitle: product.title,
    productCategory: product.category,
    orderTotal: product.price,
  });
  await backdate(Return, r._id, daysAgo(daysOld));
  return r;
}

async function makeReview(buyer, seller, product, { rating, text, daysOld = 20 }) {
  const r = await Review.create({
    productId: product._id,
    buyerId: buyer._id,
    sellerId: seller._id,
    rating,
    text,
    isVerifiedPurchase: true,
  });
  await backdate(Review, r._id, daysAgo(daysOld));
  return r;
}

async function makeBuyers(prefix, count) {
  const buyers = [];
  for (let i = 0; i < count; i++) {
    buyers.push(await makeUser(`${prefix}-${i}`, { accountAgeDays: 60 + i * 7 }));
  }
  return buyers;
}

async function seedOrdersAndReturns(buyers, seller, product, returnCount, { returnTexts, returnReason = 'not_as_described' }) {
  const orders = [];
  for (let i = 0; i < buyers.length; i++) {
    orders.push(await makeOrder(buyers[i], seller, product, 20 + (i % 100)));
  }
  for (let i = 0; i < Math.min(returnCount, buyers.length); i++) {
    await makeReturn(buyers[i], orders[i], product, {
      reasonCode: returnReason,
      reasonText: returnTexts[i % returnTexts.length],
      daysOld: 5 + i * 3,
    });
  }
  return orders;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  await connect();
  console.log('\nClearing previous demo data...');
  await clearPrevious();

  // Use the existing mock_seller so the dashboard works
  const seller = await User.findOne({ clerkId: 'mock_seller' });
  if (!seller) {
    console.error('mock_seller not found — run node seed-mock-users.js first.');
    process.exit(1);
  }
  console.log(`Using seller: ${seller.storeName || seller.firstName} (${seller._id})`);

  // ── SKU 1: Footwear — runs_small (~30% return rate) ──────────────────────
  console.log('\n[SKU 1] Seeding footwear (runs small)...');
  const shoes = await makeProduct(seller, {
    title: 'CloudRun Marathon Shoes',
    category: 'footwear',
    price: 89.99,
    brandName: 'PaceRunner',
    averageRating: 3.9,
    reviewCount: 42,
    images: ['https://picsum.photos/seed/shoes-clourun/600/600'],
  });
  const shoeBuyers = await makeBuyers('shoe', 40);
  await seedOrdersAndReturns(shoeBuyers, seller, shoes, 12, {
    returnTexts: [
      'Too tight in the toe box — had to size up',
      'Runs small. Sized up half a size and it fit perfectly.',
      'Very narrow, my feet feel cramped. Get one size bigger.',
      'Snug across the forefoot — too tight for me',
      'Tight fit, returned for a larger size',
      'Smaller than expected — definitely size up',
      'Toe box too narrow, pinches my little toe',
      'Runs small. Get one size up.',
      'Much tighter than my usual size in this brand',
      'Sizing is off — very tight across the top of foot',
    ],
    returnReason: 'not_as_described',
  });
  for (const [i, text] of [
    'Comfortable but runs small. Size up!',
    'Great shoe but tight on the sides — order larger.',
    'Runs small for sure. Half size up worked.',
    'Love it but get a size bigger — pinches otherwise',
  ].entries()) {
    await makeReview(shoeBuyers[20 + i], seller, shoes, { rating: 4, text, daysOld: 15 + i * 4 });
  }

  // ── SKU 2: Apparel — runs_large (~28% return rate) ───────────────────────
  console.log('[SKU 2] Seeding apparel (runs large)...');
  const tshirt = await makeProduct(seller, {
    title: 'Premium Slim Fit Tee',
    category: 'apparel',
    price: 29.99,
    brandName: 'TrendKnits',
    averageRating: 3.7,
    reviewCount: 55,
    images: ['https://picsum.photos/seed/tshirt-slim/600/600'],
  });
  const teeBuyers = await makeBuyers('tee', 50);
  await seedOrdersAndReturns(teeBuyers, seller, tshirt, 14, {
    returnTexts: [
      'Way too baggy for a "slim fit" — runs large',
      'Oversized, does not fit as described',
      'Runs large, loose and boxy',
      'Much bigger than expected. Size down.',
      'Huge! Nothing slim about this fit',
      'Fits like a medium when I ordered small',
      'Too large. Sizing down next time.',
      'Completely loose — returning for a smaller size',
      'Fits 2 sizes too big honestly',
    ],
    returnReason: 'not_as_described',
  });
  for (const [i, text] of [
    'Not slim fit at all — runs at least one size large',
    'Size down! Very generous sizing.',
    'Oversized. Beautiful fabric but wrong size for me.',
  ].entries()) {
    await makeReview(teeBuyers[25 + i], seller, tshirt, { rating: 3, text, daysOld: 10 + i * 5 });
  }

  // ── SKU 3: Electronics — compat issues (~18% return rate) ────────────────
  console.log('[SKU 3] Seeding electronics (compat issues)...');
  const earbuds = await makeProduct(seller, {
    title: 'ProSound Wireless Earbuds X5',
    category: 'electronics',
    price: 59.99,
    brandName: 'ProSound',
    averageRating: 3.5,
    reviewCount: 90,
    images: ['https://picsum.photos/seed/earbuds-prosound/600/600'],
  });
  const earBuyers = await makeBuyers('ear', 60);
  await seedOrdersAndReturns(earBuyers, seller, earbuds, 11, {
    returnTexts: [
      'Does not pair with my Android phone properly',
      'Incompatible with Windows Bluetooth driver — cannot connect',
      'Cannot get it to pair with my Samsung Galaxy',
      'Setup issues — spent 2 hours and still can\'t connect to my PC',
      'Compatibility problems with my iPhone 12 — keeps disconnecting',
      'Doesn\'t work with my car\'s Bluetooth system',
      'Pairing fails every time after the first connection',
      'Not compatible with my tablet — returning',
      'Bluetooth keeps dropping on my older laptop',
      'Setup process is broken — never connected successfully',
    ],
    returnReason: 'not_as_described',
  });
  for (const [i, text] of [
    'Check compatibility before buying — issues with Android 13',
    'Pairing problems on Windows 11. Works fine on iPhone though.',
    'Mixed results. Works with iOS, not with my Android.',
  ].entries()) {
    await makeReview(earBuyers[30 + i], seller, earbuds, { rating: 2, text, daysOld: 8 + i * 6 });
  }

  // ── SKU 4: Home/Furniture — too_large (~22% return rate) ─────────────────
  console.log('[SKU 4] Seeding furniture/home (too large)...');
  const shelf = await makeProduct(seller, {
    title: 'ModernWave Floating Wall Shelf',
    category: 'home',
    price: 45.99,
    brandName: 'ModernWave',
    averageRating: 3.8,
    reviewCount: 35,
    images: ['https://picsum.photos/seed/shelf-modernwave/600/600'],
  });
  const shelfBuyers = await makeBuyers('shelf', 36);
  await seedOrdersAndReturns(shelfBuyers, seller, shelf, 8, {
    returnTexts: [
      'Much larger than photos suggest — doesn\'t fit my wall',
      'Too big for the space I had in mind. Check dimensions.',
      'Massive shelf. 3x bigger than it looks in the listing.',
      'Dimensions in listing are misleading — way too large',
      'Doesn\'t fit in my apartment, much bigger than expected',
      'The product is too large for a small room',
      'Expected a small decorative shelf. This is enormous.',
      'Too large for my needs, photos are misleading',
    ],
    returnReason: 'not_as_described',
  });
  for (const [i, text] of [
    'Beautiful but huge. Check dimensions carefully.',
    'Larger than photos — measure your wall first.',
  ].entries()) {
    await makeReview(shelfBuyers[20 + i], seller, shelf, { rating: 4, text, daysOld: 12 + i * 7 });
  }

  // ── SKU 5: Electronics — healthy (~5% return rate) ───────────────────────
  console.log('[SKU 5] Seeding electronics (healthy, low returns)...');
  const monitor = await makeProduct(seller, {
    title: 'BabyView Smart Baby Monitor',
    category: 'electronics',
    price: 129.99,
    brandName: 'BabyView',
    averageRating: 4.7,
    reviewCount: 120,
    images: ['https://picsum.photos/seed/monitor-babyview/600/600'],
  });
  const monBuyers = await makeBuyers('mon', 80);
  await seedOrdersAndReturns(monBuyers, seller, monitor, 4, {
    returnTexts: [
      'Stopped working after 2 weeks — defective unit',
      'Bought a different model, returning unused',
      'Gift duplicate — already have one',
      'Defective — screen flickering from day 1',
    ],
    returnReason: 'defective',
  });
  for (const [i, text] of [
    'Absolutely love it. Crystal clear video, easy setup.',
    'Works perfectly with all our devices. Highly recommend.',
    'Best baby monitor we\'ve used. Zero issues.',
  ].entries()) {
    await makeReview(monBuyers[40 + i], seller, monitor, { rating: 5, text, daysOld: 20 + i * 8 });
  }

  // ── SKU 6: Apparel — improving (rate dropped from ~40% → ~12%) ────────────
  console.log('[SKU 6] Seeding apparel (improving — rate dropped after fix)...');
  const hoodie = await makeProduct(seller, {
    title: 'Urban Fleece Pullover Hoodie',
    category: 'apparel',
    price: 49.99,
    brandName: 'UrbanBasics',
    averageRating: 4.2,
    reviewCount: 68,
    images: ['https://picsum.photos/seed/hoodie-urban/600/600'],
  });
  const hoodieBuyers = await makeBuyers('hoodie', 60);
  // Old returns (60–120 days ago) — high rate when sizing was wrong
  const oldReturnTexts = [
    'Wrong color — nothing like the photo', 'Color completely off', 'Photo color is misleading',
    'Arrived in a different shade', 'The green is actually grey?', 'Nothing like shown online',
    'Misleading photos', 'Wrong shade entirely', 'Photo must be heavily edited',
    'Color totally different in person', 'Shade mismatch', 'Not the colour I expected',
  ];
  for (let i = 0; i < 12; i++) {
    const o = await makeOrder(hoodieBuyers[i], seller, hoodie, 80 + i * 3);
    await makeReturn(hoodieBuyers[i], o, hoodie, {
      reasonCode: 'not_as_described',
      reasonText: oldReturnTexts[i % oldReturnTexts.length],
      daysOld: 60 + i * 2,
    });
  }
  // Recent orders (0–30 days) — only 2 returns → rate dropped dramatically
  for (let i = 12; i < 30; i++) {
    await makeOrder(hoodieBuyers[i], seller, hoodie, 5 + (i % 28));
  }
  const o1 = await makeOrder(hoodieBuyers[30], seller, hoodie, 10);
  const o2 = await makeOrder(hoodieBuyers[31], seller, hoodie, 14);
  await makeReturn(hoodieBuyers[30], o1, hoodie, { reasonCode: 'changed_mind', reasonText: 'Changed my mind', daysOld: 8 });
  await makeReturn(hoodieBuyers[31], o2, hoodie, { reasonCode: 'changed_mind', reasonText: 'Bought another one', daysOld: 6 });

  // ── Trust profiles for demo buyers ───────────────────────────────────────
  console.log('\nSeeding buyer trust profiles...');
  const priya = await makeUser('priya', { accountAgeDays: 730 });
  const rahul = await makeUser('rahul', { accountAgeDays: 250 });
  const riskyBuyer = await makeUser('risky-buyer', { accountAgeDays: 90 });

  // Priya: 40 orders, 1 very old return → verified
  for (let i = 0; i < 40; i++) {
    await makeOrder(priya, seller, monitor, 5 + i * 18);
  }
  const priyaFirstOrder = await Order.findOne({ buyerId: priya._id }).sort({ createdAt: 1 });
  await makeReturn(priya, priyaFirstOrder, monitor, {
    reasonCode: 'changed_mind',
    reasonText: 'Bought a different model',
    daysOld: 700,
  });

  // Rahul: 12 orders, 1 fresh return → trusted
  for (let i = 0; i < 12; i++) {
    await makeOrder(rahul, seller, monitor, 15 + i * 20);
  }
  const rahulRecentOrder = await Order.findOne({ buyerId: rahul._id }).sort({ createdAt: -1 });
  await makeReturn(rahul, rahulRecentOrder, monitor, {
    reasonCode: 'defective',
    reasonText: 'Faulty unit',
    daysOld: 5,
  });

  // Risky buyer: 8 orders, 6 returns in last 60 days → watch tier
  for (let i = 0; i < 8; i++) {
    const o = await makeOrder(riskyBuyer, seller, tshirt, 5 + i * 8);
    if (i < 6) {
      await makeReturn(riskyBuyer, o, tshirt, {
        reasonCode: 'changed_mind',
        reasonText: 'Just wanted to try it',
        daysOld: 3 + i,
      });
    }
  }

  console.log('Computing trust profiles...');
  await trustService.computeTrustProfile(priya._id);
  await trustService.computeTrustProfile(rahul._id);
  await trustService.computeTrustProfile(riskyBuyer._id);

  // ── Run the RIKB recompute ────────────────────────────────────────────────
  console.log('\nRunning recomputeReturnInsights()...');
  const result = await recomputeReturnInsights();
  console.log('Recompute result:', result);

  // ── Print summary table ───────────────────────────────────────────────────
  const skus = [shoes, tshirt, earbuds, shelf, monitor, hoodie];
  const insights = await ReturnInsight.find({ productId: { $in: skus.map((s) => s._id) } }).lean();

  console.log('\n╔══════════════════════════════════════╦══════╦════════╦════════╦══════════════════╦══════════════════╗');
  console.log('║ SKU                                  ║ Sold ║ Return ║  Rate  ║  Fit/Compat/Dim  ║ Dominant Reason  ║');
  console.log('╠══════════════════════════════════════╬══════╬════════╬════════╬══════════════════╬══════════════════╣');
  for (const ins of insights) {
    const product = skus.find((s) => String(s._id) === String(ins.productId));
    const name = (product?.title?.replace('[P7-DEMO] ', '') || '').substring(0, 36).padEnd(36);
    const sold = String(ins.unitsSold || 0).padStart(4);
    const ret = String(ins.unitsReturned || 0).padStart(6);
    const rate = `${((ins.returnRate || 0) * 100).toFixed(0)}%`.padStart(6);
    const signal =
      (ins.fitSignal?.verdict !== 'unknown' && ins.fitSignal?.verdict ? ins.fitSignal.verdict :
       ins.compatSignal?.verdict !== 'unknown' && ins.compatSignal?.verdict ? ins.compatSignal.verdict :
       ins.dimensionSignal?.verdict !== 'unknown' && ins.dimensionSignal?.verdict ? ins.dimensionSignal.verdict :
       'clean').substring(0, 16).padEnd(16);
    const reason = (ins.dominantReason || 'none').substring(0, 16).padEnd(16);
    console.log(`║ ${name} ║${sold}  ║${ret}  ║${rate}  ║ ${signal} ║ ${reason} ║`);
  }
  console.log('╚══════════════════════════════════════╩══════╩════════╩════════╩══════════════════╩══════════════════╝');

  console.log('\nTrust tiers:');
  for (const u of [priya, rahul, riskyBuyer]) {
    const profile = await TrustProfile.findOne({ userId: u._id }).lean();
    if (profile) {
      console.log(`  ${u.firstName.padEnd(14)}  tier=${profile.tier.padEnd(10)}  score=${profile.score}`);
    }
  }

  console.log('\n✅ Done! Now log in as mock_seller → Seller Dashboard → Return Insights tab.');
  await mongoose.disconnect();
}

run().catch(async (e) => {
  console.error(e);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
