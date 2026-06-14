/**
 * seed-demand.js — ADDITIVE demo seed for Phase A (Demand Registry + Warehouses).
 *
 * Idempotent:
 *   • Warehouses are upserted by `code` from routing.config.WAREHOUSES.
 *   • Buyer "Looking for…" posts are tagged (emails paDemo+*) and re-seeded on run.
 *
 * Seeds ~40 geo-distributed wants clustered around two demo cities so the admin
 * demand map and $geoNear matching fire on real (small) data.
 *
 * Run: node seed-demand.js  (or npm run seed:demand)
 */
require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');

const User = require('./src/modules/users/user.model');
const Want = require('./src/modules/demand/demand.model');
const Warehouse = require('./src/modules/demand/warehouse.model');
const { WAREHOUSES } = require('./src/modules/routing/routing.config');
const demandService = require('./src/modules/demand/demand.service');

const DAY_MS = 86400000;

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

// Jitter a coordinate by up to ~±0.15° (~15 km) so posts spread around a city.
const jitter = (deg) => deg + (Math.random() - 0.5) * 0.3;

// Demo want templates: [text, category, maxPrice]
const TEMPLATES = [
  ['looking for red running shoes size 9 under 2000', 'Sports', 2000],
  ['want a used office chair good condition', 'Home & Garden', 3000],
  ['need a second hand smartphone under 12000', 'Electronics', 12000],
  ['looking for a washing machine front load', 'Home & Garden', 9000],
  ['want cricket bat english willow', 'Sports', 4000],
  ['need school textbooks class 10 cbse', 'Books', 800],
  ['looking for bluetooth headphones', 'Electronics', 1500],
  ['want a winter jacket size L', 'Clothing', 1200],
  ['need a study table for kids', 'Home & Garden', 2500],
  ['looking for a refurbished laptop i5', 'Electronics', 25000],
  ['want running shoes nike or adidas', 'Sports', 3500],
  ['need a microwave oven', 'Home & Garden', 4000],
];

async function clearPrevious() {
  const demoUsers = await User.find({ email: /^paDemo\+/ }).select('_id').lean();
  const ids = demoUsers.map((u) => u._id);
  if (ids.length) await Want.deleteMany({ userId: { $in: ids } });
}

async function seedWarehouses() {
  for (const wh of WAREHOUSES) {
    await Warehouse.findOneAndUpdate({ code: wh.code }, wh, { upsert: true, new: true, setDefaultsOnInsert: true });
  }
  console.log(`Upserted ${WAREHOUSES.length} warehouses.`);
}

async function ensureDemoUser(i) {
  const email = `paDemo+buyer${i}@example.com`;
  return User.findOneAndUpdate(
    { email },
    { email, clerkId: `pademo_buyer_${i}`, role: 'buyer', firstName: `DemoBuyer${i}` },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function seedWants() {
  // Cluster posts around Raipur and Bilaspur (two demo cities).
  const clusters = [
    { name: 'Raipur', lng: 81.6296, lat: 21.2514, count: 24 },
    { name: 'Bilaspur', lng: 82.1409, lat: 22.0797, count: 18 },
  ];

  let total = 0;
  let userIdx = 0;
  for (const cluster of clusters) {
    for (let i = 0; i < cluster.count; i++) {
      const [text, category, maxPrice] = TEMPLATES[(i + userIdx) % TEMPLATES.length];
      const user = await ensureDemoUser(userIdx++);
      await demandService.createWant(user._id, {
        text,
        productCategory: category,
        maxPrice,
        condition: 'any',
        lng: jitter(cluster.lng),
        lat: jitter(cluster.lat),
        radiusKm: 25,
      });
      total++;
    }
  }
  console.log(`Seeded ${total} buyer "Looking for…" posts across ${clusters.length} cities.`);
}

async function printDemandTable() {
  const terms = ['shoe', 'laptop', 'chair', 'washing machine', 'headphones'];
  console.log('\nDemand-by-warehouse (normalized 0-100):');
  for (const term of terms) {
    const rows = await demandService.demandByWarehouse(term);
    const top = rows.sort((a, b) => b.demand - a.demand).slice(0, 3)
      .map((r) => `${r.warehouseCode}:${r.demand}`).join('  ');
    console.log(`  "${term}" → ${top}`);
  }
}

(async () => {
  try {
    await connect();
    await clearPrevious();
    await seedWarehouses();
    await seedWants();
    await printDemandTable();
    console.log('\n✅ seed-demand complete.');
  } catch (err) {
    console.error('seed-demand failed:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
