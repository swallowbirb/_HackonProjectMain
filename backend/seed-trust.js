/**
 * seed-trust.js — ADDITIVE demo seed for Phase 3 (Trust Score).
 *
 * Never edits seed.js. Idempotent: tags everything it creates (emails p3demo+*)
 * and deletes only those on re-run. Creates 9 personas, computes each trust profile,
 * and prints the resulting tier table.
 *
 * Run: node seed-trust.js
 */
require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');

const User = require('./src/modules/users/user.model');
const Order = require('./src/modules/orders/order.model');
const Return = require('./src/modules/returns/return.model');
const TrustProfile = require('./src/modules/trust/trust.model');
const trustService = require('./src/modules/trust/trust.service');

const DAY_MS = 86400000;
const daysAgo = (n) => new Date(Date.now() - n * DAY_MS);

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

async function clearPrevious() {
  const demoUsers = await User.find({ email: /^p3demo\+/ }).select('_id').lean();
  const ids = demoUsers.map((u) => u._id);
  await Order.deleteMany({ buyerId: { $in: ids } });
  await Order.deleteMany({ sellerId: { $in: ids } });
  await Return.deleteMany({ userId: { $in: ids } });
  await TrustProfile.deleteMany({ userId: { $in: ids } });
  await User.deleteMany({ _id: { $in: ids } });
}

// Force a createdAt. Mongoose marks createdAt immutable under timestamps:true, so we
// write through the native driver collection to bypass ODM casting/immutability.
async function backdate(Model, id, date) {
  await Model.collection.updateOne({ _id: id }, { $set: { createdAt: date } });
}

async function makeUser(handle, extra = {}) {
  const u = await User.create({
    clerkId: `mock_p3_${handle}`,
    email: `p3demo+${handle}@example.com`,
    role: 'buyer',
    firstName: handle,
    ...extra,
  });
  if (extra.accountAgeDays) {
    await backdate(User, u._id, daysAgo(extra.accountAgeDays));
  }
  return u;
}

async function createOrder(buyer, seller, { productId = null, createdDaysAgo = 30 } = {}) {
  const o = await Order.create({
    buyerId: buyer._id,
    sellerId: seller._id,
    productId,
    quantity: 1,
    totalPrice: 50,
    status: 'completed',
    paymentDetails: { mockCreditCard: '4242' },
  });
  await backdate(Order, o._id, daysAgo(createdDaysAgo));
  return o;
}

async function createReturn(buyer, order, { createdDaysAgo = 10 } = {}) {
  const r = await Return.create({
    orderId: order._id,
    userId: buyer._id,
    itemId: new mongoose.Types.ObjectId(),
    reasonCode: 'changed_mind',
    reasonText: 'p3-trust-demo',
  });
  await backdate(Return, r._id, daysAgo(createdDaysAgo));
  return r;
}

// Create `count` orders spread across [minDays, maxDays] ago.
async function makeOrders(buyer, seller, count, { minDays = 5, maxDays = 365, productId = null } = {}) {
  const orders = [];
  for (let i = 0; i < count; i++) {
    const span = maxDays - minDays;
    const createdDaysAgo = count > 1 ? Math.round(minDays + (span * i) / (count - 1)) : minDays;
    orders.push(await createOrder(buyer, seller, { productId, createdDaysAgo }));
  }
  return orders;
}

async function run() {
  await connect();
  console.log('Clearing previous p3-trust-demo data...');
  await clearPrevious();

  const seller = await makeUser('seller', { role: 'seller', storeName: 'p3-trust-demo store' });
  const created = [];

  // 1. power — 40 orders over 2y, 1 (old) return -> verified
  const power = await makeUser('power', { accountAgeDays: 730 });
  {
    const orders = await makeOrders(power, seller, 40, { minDays: 5, maxDays: 700 });
    await createReturn(power, orders[0], { createdDaysAgo: 690 });
    created.push(power);
  }

  // 2. clean-mid — 12 orders, 1 old return, 200d old -> trusted
  const cleanMid = await makeUser('clean-mid', { accountAgeDays: 200 });
  {
    const orders = await makeOrders(cleanMid, seller, 12, { minDays: 95, maxDays: 195 });
    await createReturn(cleanMid, orders[0], { createdDaysAgo: 150 });
    created.push(cleanMid);
  }

  // 3. watch-rate — 20 orders, 9 returns (45%) -> watch
  const watchRate = await makeUser('watch-rate', { accountAgeDays: 180 });
  {
    const orders = await makeOrders(watchRate, seller, 20, { minDays: 5, maxDays: 175 });
    for (let i = 0; i < 9; i++) await createReturn(watchRate, orders[i], { createdDaysAgo: 5 + i * 3 });
    created.push(watchRate);
  }

  // 4. restricted-rate — 15 orders, 11 returns (73%) -> restricted
  const restrictedRate = await makeUser('restricted-rate', { accountAgeDays: 200 });
  {
    const orders = await makeOrders(restrictedRate, seller, 15, { minDays: 5, maxDays: 190 });
    for (let i = 0; i < 11; i++) await createReturn(restrictedRate, orders[i], { createdDaysAgo: 5 + i * 3 });
    created.push(restrictedRate);
  }

  // 5. wardrobe — 12 orders, 3 returns held ~28d -> watch (wardrobing flag fires)
  const wardrobe = await makeUser('wardrobe', { accountAgeDays: 120 });
  {
    const orders = await makeOrders(wardrobe, seller, 12, { minDays: 30, maxDays: 110 });
    // Each returned ~28 days after its order -> wardrobing pattern.
    for (let i = 0; i < 3; i++) {
      const heldOrderDaysAgo = 30 + i * 25;
      await backdate(Order, orders[i]._id, daysAgo(heldOrderDaysAgo));
      await createReturn(wardrobe, orders[i], { createdDaysAgo: heldOrderDaysAgo - 28 });
    }
    created.push(wardrobe);
  }

  // 6. bracketing — same productId bought 4x, 3 returned (+8 clean) -> watch
  const bracketing = await makeUser('bracketing', { accountAgeDays: 150 });
  {
    const productId = new mongoose.Types.ObjectId();
    const sameProduct = await makeOrders(bracketing, seller, 4, { minDays: 10, maxDays: 60, productId });
    await makeOrders(bracketing, seller, 8, { minDays: 10, maxDays: 80 }); // clean, null product
    for (let i = 0; i < 3; i++) await createReturn(bracketing, sameProduct[i], { createdDaysAgo: 5 + i });
    created.push(bracketing);
  }

  // 7. sudden-shift — 30 orders/lifetime rate low, but recent 90d spikes -> watch
  const suddenShift = await makeUser('sudden-shift', { accountAgeDays: 400 });
  {
    const oldOrders = await makeOrders(suddenShift, seller, 25, { minDays: 100, maxDays: 390 });
    const recentOrders = await makeOrders(suddenShift, seller, 5, { minDays: 5, maxDays: 80 });
    void oldOrders;
    for (let i = 0; i < 4; i++) await createReturn(suddenShift, recentOrders[i], { createdDaysAgo: 5 + i * 3 });
    created.push(suddenShift);
  }

  // 8. newbie — 0 orders, 3d old -> trusted/standard (not punished)
  const newbie = await makeUser('newbie', { accountAgeDays: 3 });
  created.push(newbie);

  // 9. banned — 10 orders, banned -> restricted
  const banned = await makeUser('banned', { accountAgeDays: 365, banned: true });
  {
    await makeOrders(banned, seller, 10, { minDays: 5, maxDays: 360 });
    created.push(banned);
  }

  console.log('\nComputing trust profiles...\n');
  console.log('handle            score  tier        flags');
  console.log('----------------- -----  ----------  -----------------------');
  for (const u of created) {
    const p = await trustService.computeTrustProfile(u._id);
    const flags = [
      p.bracketingFlag ? 'bracketing' : null,
      p.wardrobingFlag ? 'wardrobing' : null,
    ].filter(Boolean).join(',') || '-';
    console.log(
      `${u.firstName.padEnd(17)} ${String(p.score).padStart(3)}    ${p.tier.padEnd(10)}  ${flags}`
    );
  }

  await mongoose.disconnect();
  console.log('\nDone. Disconnected.');
}

run().catch(async (e) => {
  console.error(e);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
