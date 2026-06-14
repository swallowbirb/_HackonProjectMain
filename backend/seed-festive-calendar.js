/**
 * seed-festive-calendar.js — Phase 7.5 Festive Defense Layer
 *
 * Additive seed. Populates the FestiveCalendar collection with real, publicly
 * known Indian festive/sale windows for 2025–2026.
 *
 * NOTE ON DATES: Festival dates that follow the Hindu lunar calendar (Diwali,
 * Raksha Bandhan) shift each year and are taken from published dates — treat them
 * as approximate windows, not audited. Marketplace sale events (BBD/GIF/EOSS) are
 * the platforms' announced/typical windows. Adjust freely.
 *
 * Demo safety net (Option C): pass --force <INSTANCE_KEY> to force one event active
 * regardless of today's date, e.g.:
 *     node seed-festive-calendar.js --force BBD_2025
 *
 * Usage:
 *     npm run seed:festive
 *     node seed-festive-calendar.js --force GIF_2025
 */

require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
const FestiveCalendar = require('./src/modules/festive/festiveCalendar.model');
const { EVENT_CODES } = require('./src/contracts/festive.contract');

// ── The seed rows ─────────────────────────────────────────────────────────────
// cancelLock is true ONLY for BBD and GIF (the two highest-volume sale events).
const EVENTS = [
  {
    eventCode: EVENT_CODES.GIF,
    instanceKey: 'GIF_2025',
    eventName: 'Amazon Great Indian Festival 2025',
    startDate: new Date('2025-09-23T00:00:00.000Z'),
    endDate: new Date('2025-10-12T23:59:59.000Z'),
    riskMultiplier: 1.6,
    affectedCategories: ['apparel', 'footwear', 'electronics', 'home', 'jewelry'],
    policies: { codGate: true, returnWindowShrink: true, cancelLock: true },
  },
  {
    eventCode: EVENT_CODES.BBD,
    instanceKey: 'BBD_2025',
    eventName: 'Flipkart Big Billion Days 2025',
    startDate: new Date('2025-09-23T00:00:00.000Z'),
    endDate: new Date('2025-10-08T23:59:59.000Z'),
    riskMultiplier: 1.6,
    affectedCategories: ['apparel', 'footwear', 'electronics', 'home', 'mobile'],
    policies: { codGate: true, returnWindowShrink: true, cancelLock: true },
  },
  {
    eventCode: EVENT_CODES.DIWALI,
    instanceKey: 'DIWALI_2025',
    eventName: 'Diwali 2025',
    startDate: new Date('2025-10-18T00:00:00.000Z'),
    endDate: new Date('2025-10-23T23:59:59.000Z'),
    riskMultiplier: 1.5,
    affectedCategories: ['apparel', 'footwear', 'home', 'decor', 'jewelry', 'electronics'],
    policies: { codGate: true, returnWindowShrink: true, cancelLock: false },
  },
  {
    eventCode: EVENT_CODES.EOSS,
    instanceKey: 'EOSS_JAN_2026',
    eventName: 'End of Season Sale (January 2026)',
    startDate: new Date('2026-01-02T00:00:00.000Z'),
    endDate: new Date('2026-01-15T23:59:59.000Z'),
    riskMultiplier: 1.4,
    affectedCategories: ['apparel', 'footwear'],
    policies: { codGate: true, returnWindowShrink: true, cancelLock: false },
  },
  {
    eventCode: EVENT_CODES.REPUBLIC_DAY,
    instanceKey: 'REPUBLIC_DAY_2026',
    eventName: 'Republic Day Sale 2026',
    startDate: new Date('2026-01-20T00:00:00.000Z'),
    endDate: new Date('2026-01-26T23:59:59.000Z'),
    riskMultiplier: 1.3,
    affectedCategories: ['electronics', 'apparel', 'home'],
    policies: { codGate: true, returnWindowShrink: true, cancelLock: false },
  },
  {
    eventCode: EVENT_CODES.RAKHI,
    instanceKey: 'RAKHI_2025',
    eventName: 'Raksha Bandhan 2025',
    startDate: new Date('2025-08-05T00:00:00.000Z'),
    endDate: new Date('2025-08-09T23:59:59.000Z'),
    riskMultiplier: 1.3,
    affectedCategories: ['apparel', 'jewelry', 'gifts', 'home'],
    policies: { codGate: true, returnWindowShrink: true, cancelLock: false },
  },
  {
    eventCode: EVENT_CODES.WEDDING,
    instanceKey: 'WEDDING_2025_26',
    eventName: 'Wedding Season 2025–26',
    startDate: new Date('2025-10-01T00:00:00.000Z'),
    endDate: new Date('2026-02-28T23:59:59.000Z'),
    riskMultiplier: 1.2,
    affectedCategories: ['apparel', 'footwear', 'jewelry'],
    policies: { codGate: true, returnWindowShrink: true, cancelLock: false },
  },
];

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set. Aborting.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Connected. Seeding festive calendar...');

  // Idempotent upsert by instanceKey.
  let upserts = 0;
  for (const ev of EVENTS) {
    await FestiveCalendar.findOneAndUpdate(
      { instanceKey: ev.instanceKey },
      { $set: { ...ev, active: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    upserts++;
  }
  console.log(`Upserted ${upserts} festive events.`);

  // Option C — optional demo override.
  const forceIdx = process.argv.indexOf('--force');
  if (forceIdx !== -1 && process.argv[forceIdx + 1]) {
    const key = process.argv[forceIdx + 1];
    await FestiveCalendar.updateMany({}, { $set: { forceActive: false } });
    const forced = await FestiveCalendar.findOneAndUpdate(
      { instanceKey: key },
      { $set: { forceActive: true, active: true } },
      { new: true }
    );
    if (forced) {
      console.log(`✓ Forced active for demo: ${forced.instanceKey} (${forced.eventName})`);
    } else {
      console.warn(`⚠ --force key "${key}" not found among seeded events.`);
    }
  }

  const all = await FestiveCalendar.find({}).sort({ startDate: 1 }).lean();
  console.log('\nFestive calendar now contains:');
  for (const e of all) {
    const flags = [
      e.policies.cancelLock ? 'cancelLock' : null,
      e.forceActive ? 'FORCED' : null,
    ].filter(Boolean).join(', ');
    console.log(
      `  • ${e.instanceKey.padEnd(18)} ${e.startDate.toISOString().slice(0, 10)} → ${e.endDate
        .toISOString()
        .slice(0, 10)}${flags ? `  [${flags}]` : ''}`
    );
  }

  await mongoose.disconnect();
  console.log('\nDone.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
