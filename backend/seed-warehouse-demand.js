/**
 * seed-warehouse-demand.js — Phase 8, Part A: the warehouse-demand populator.
 *
 * Writes a tiny, hand-curated demand-per-product-type table onto each
 * Chhattisgarh warehouse so the "best warehouse, not nearest" routing maths runs
 * on real-looking signal WITHOUT storing thousands of buyer posts.
 *
 *   7 warehouses × ~10 product types ≈ 70 numbers. Negligible storage.
 *
 * Deterministic city archetypes → stable across demos (judges see the same map
 * every run). Idempotent upsert by warehouse `code`. Standalone — does NOT need
 * any Want posts to exist.
 *
 * Run: node seed-warehouse-demand.js   (or npm run seed:warehouse-demand)
 */
require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');

const Warehouse = require('./src/modules/demand/warehouse.model');
const { WAREHOUSES } = require('./src/modules/routing/routing.config');
const { TYPE_TO_CATEGORY } = require('./src/modules/demand/demand.service');

// ── Product-type → demand archetype per city (0-100) ──────────────────────────
// Each city's economic character drives which product types are in demand there.
// These are the per-type numbers the seller-facing / topSearches flavour uses.
const ARCHETYPES = {
  'RAIPUR-01': {
    // Capital metro — broad, electronics & fashion heavy.
    phone: 88, laptop: 80, headphones: 70, clothes: 72, jacket: 60, tshirt: 66,
    shoe: 74, sneakers: 68, textbook: 40, chair: 35, table: 30, 'washing machine': 45,
    toys: 38, 'cricket bat': 30,
  },
  'BHILAI-01': {
    // Steel / industrial — automotive, home & heavy goods.
    automotive: 85, 'washing machine': 78, chair: 70, table: 66, laptop: 50,
    phone: 55, clothes: 48, shoe: 44, headphones: 36, textbook: 30, toys: 28,
    sneakers: 32, 'cricket bat': 26,
  },
  'BILASPUR-01': {
    // Education + retail — books & apparel.
    textbook: 86, clothes: 74, shoe: 68, tshirt: 64, jacket: 56, phone: 52,
    laptop: 48, headphones: 40, chair: 34, table: 30, 'washing machine': 32,
    sneakers: 58, toys: 36, 'cricket bat': 30,
  },
  'KORBA-01': {
    // Power / industrial town — electronics & heavy appliances.
    laptop: 76, phone: 72, headphones: 64, 'washing machine': 70, automotive: 58,
    chair: 40, table: 36, clothes: 42, shoe: 38, textbook: 28, toys: 24,
    sneakers: 30, jacket: 30, 'cricket bat': 20,
  },
  'DURG-01': {
    // Twin-city, sports culture.
    shoe: 88, sneakers: 84, 'cricket bat': 80, toys: 70, clothes: 58, tshirt: 56,
    phone: 54, laptop: 46, headphones: 44, chair: 32, table: 28,
    'washing machine': 34, textbook: 38, jacket: 40,
  },
  'RAIGARH-01': {
    // Industrial fringe — home & garden, furniture.
    chair: 82, table: 78, 'washing machine': 72, automotive: 60, clothes: 40,
    shoe: 36, phone: 44, laptop: 38, headphones: 30, textbook: 26, toys: 28,
    sneakers: 28, jacket: 26, 'cricket bat': 22,
  },
  'JAGDALPUR-01': {
    // Smaller / regional — lower overall, basics first.
    clothes: 62, textbook: 58, shoe: 48, tshirt: 50, phone: 46, jacket: 38,
    laptop: 34, headphones: 26, chair: 30, table: 26, 'washing machine': 28,
    toys: 30, sneakers: 32, 'cricket bat': 24,
  },
};

/**
 * Roll the per-type numbers up to a per-category number (max of the types that
 * map into that category) so routing can read one number per category directly.
 */
const rollUpByCategory = (demandByType) => {
  const byCategory = {};
  for (const [type, score] of Object.entries(demandByType)) {
    const category = TYPE_TO_CATEGORY[type];
    if (!category) continue;
    byCategory[category] = Math.max(byCategory[category] || 0, Number(score) || 0);
  }
  return byCategory;
};

/** topSearches = the per-type table sorted desc, capped to the top 8. */
const buildTopSearches = (demandByType) =>
  Object.entries(demandByType)
    .map(([term, score]) => ({ term, score: Number(score) || 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

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

(async () => {
  const rows = [];
  try {
    await connect();

    for (const wh of WAREHOUSES) {
      const demandByType = ARCHETYPES[wh.code] || {};
      const demandByCategory = rollUpByCategory(demandByType);
      const topSearches = buildTopSearches(demandByType);

      // Upsert the warehouse (create it if seed-demand never ran) AND write demand.
      await Warehouse.findOneAndUpdate(
        { code: wh.code },
        {
          // Base fields (defensive — keeps standalone runnable without seed-demand).
          code: wh.code, name: wh.name, city: wh.city,
          location: wh.location, capacity: wh.capacity, categories: wh.categories,
          // Populator fields.
          demandByType, demandByCategory, topSearches,
          demandUpdatedAt: new Date(),
        },
        { upsert: true, setDefaultsOnInsert: true, new: true }
      );

      rows.push({
        warehouse: wh.code,
        city: wh.city,
        top1: topSearches[0] ? `${topSearches[0].term} (${topSearches[0].score})` : '—',
        top2: topSearches[1] ? `${topSearches[1].term} (${topSearches[1].score})` : '—',
        top3: topSearches[2] ? `${topSearches[2].term} (${topSearches[2].score})` : '—',
        categories: Object.keys(demandByCategory).length,
      });
    }

    console.log('\n── Warehouse demand populated ─────────────────────────────────');
    console.table(rows);
    console.log('✅ seed-warehouse-demand complete.');
  } catch (err) {
    console.error('seed-warehouse-demand failed:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
