require('dotenv').config({ path: '../../.env' });
const mongoose = require('mongoose');
const connectDB = require('./database');

/**
 * Task 0.3 — MongoDB Atlas Indexes
 * Run once: node src/config/createIndexes.js
 */
async function createIndexes() {
  await connectDB();
  const db = mongoose.connection.db;

  console.log('Creating indexes...');

  // wants — geospatial
  await db.collection('wants').createIndex({ location: '2dsphere' });
  await db.collection('wants').createIndex({ productCategory: 1, location: '2dsphere' });
  console.log('✓ wants indexes');

  // warehouses — geospatial (Phase A demand map + best-warehouse selection)
  await db.collection('warehouses').createIndex({ location: '2dsphere' });
  await db.collection('warehouses').createIndex({ code: 1 }, { unique: true });
  console.log('✓ warehouses indexes');

  // items — state machine queries
  await db.collection('items').createIndex({ status: 1, createdAt: -1 });
  await db.collection('items').createIndex({ userId: 1, status: 1 });
  console.log('✓ items indexes');

  // grades — one grade per item (Req 8.1)
  await db.collection('grades').createIndex({ itemId: 1 }, { unique: true });
  await db.collection('grades').createIndex({ flaggedForReview: 1, createdAt: -1 });
  console.log('✓ grades indexes');

  // lifecycleEvents — hash chain
  await db.collection('lifecycleevents').createIndex({ itemId: 1, sequence: 1 });
  console.log('✓ lifecycleEvents indexes');

  // trustProfiles — unique per user
  await db.collection('trustprofiles').createIndex({ userId: 1 }, { unique: true });
  console.log('✓ trustProfiles indexes');

  // listings — marketplace browse
  await db.collection('listings').createIndex({ conditionLane: 1, category: 1 });
  console.log('✓ listings indexes');

  console.log('\nAll indexes created successfully.');
  process.exit(0);
}

createIndexes().catch((err) => {
  console.error('Failed to create indexes:', err);
  process.exit(1);
});
