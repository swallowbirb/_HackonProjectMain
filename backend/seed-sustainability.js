/**
 * seed-sustainability.js — ADDITIVE demo seed for Phase 8 (Sustainability).
 *
 * Seeds an NGO directory (with 2dsphere coordinates) across the demo cities so
 * the donation match + tax-receipt flow works on a fresh DB. Idempotent:
 * clears only NGOs it created (tagged via the `seedTag` field) before re-seeding.
 *
 * Run: node seed-sustainability.js   (or: npm run seed:sustainability)
 */
require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');

const Ngo = require('./src/modules/sustainability/ngo.model');

const SEED_TAG = 'p8demo';

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

// city centres (lng, lat)
const RAIPUR = { lng: 81.6296, lat: 21.2514 };
const BILASPUR = { lng: 82.1409, lat: 22.0797 };

// scatter a point a few km from a centre
const near = (c, dLng, dLat) => [c.lng + dLng, c.lat + dLat];

const NGOS = [
  {
    name: 'Goonj Raipur',
    categoriesAccepted: ['clothing', 'footwear'],
    coordinates: near(RAIPUR, 0.01, 0.01),
    pickupRadiusKm: 20,
    city: 'Raipur',
    contact: { phone: '+91-700-000-0001', email: 'raipur@goonj.example', address: 'Civil Lines, Raipur' },
  },
  {
    name: 'Smile Foundation Electronics Drive',
    categoriesAccepted: ['electronics', 'books'],
    coordinates: near(RAIPUR, -0.02, 0.015),
    pickupRadiusKm: 25,
    city: 'Raipur',
    contact: { phone: '+91-700-000-0002', email: 'raipur@smile.example', address: 'Shankar Nagar, Raipur' },
  },
  {
    name: 'Habitat ReStore Raipur',
    categoriesAccepted: ['furniture'],
    coordinates: near(RAIPUR, 0.03, -0.01),
    pickupRadiusKm: 30,
    city: 'Raipur',
    contact: { phone: '+91-700-000-0003', email: 'raipur@habitat.example', address: 'Telibandha, Raipur' },
  },
  {
    name: 'Robin Hood Army Raipur',
    categoriesAccepted: [], // accepts all
    coordinates: near(RAIPUR, -0.005, -0.02),
    pickupRadiusKm: 15,
    city: 'Raipur',
    contact: { phone: '+91-700-000-0004', email: 'raipur@rha.example', address: 'Pandri, Raipur' },
  },
  {
    name: 'Goonj Bilaspur',
    categoriesAccepted: ['clothing', 'footwear', 'books'],
    coordinates: near(BILASPUR, 0.01, 0.01),
    pickupRadiusKm: 20,
    city: 'Bilaspur',
    contact: { phone: '+91-700-000-0005', email: 'bilaspur@goonj.example', address: 'Vyapar Vihar, Bilaspur' },
  },
  {
    name: 'CRY Bilaspur Community Centre',
    categoriesAccepted: [], // accepts all
    coordinates: near(BILASPUR, -0.015, 0.02),
    pickupRadiusKm: 25,
    city: 'Bilaspur',
    contact: { phone: '+91-700-000-0006', email: 'bilaspur@cry.example', address: 'Nehru Nagar, Bilaspur' },
  },
];

async function run() {
  await connect();

  console.log('Clearing previous p8demo NGOs...');
  await Ngo.deleteMany({ seedTag: SEED_TAG });

  const docs = NGOS.map((n) => ({
    name: n.name,
    categoriesAccepted: n.categoriesAccepted,
    location: { type: 'Point', coordinates: n.coordinates },
    pickupRadiusKm: n.pickupRadiusKm,
    contact: n.contact,
    city: n.city,
    active: true,
    seedTag: SEED_TAG,
  }));

  await Ngo.insertMany(docs);

  console.log(`\nSeeded ${docs.length} NGOs:`);
  console.log('name                                  city       accepts');
  console.log('------------------------------------- ---------- --------------------------');
  for (const n of NGOS) {
    const accepts = n.categoriesAccepted.length ? n.categoriesAccepted.join(',') : 'ALL';
    console.log(`${n.name.padEnd(37)} ${n.city.padEnd(10)} ${accepts}`);
  }

  await mongoose.disconnect();
  console.log('\nDone. Disconnected.');
}

run().catch(async (e) => {
  console.error(e);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
