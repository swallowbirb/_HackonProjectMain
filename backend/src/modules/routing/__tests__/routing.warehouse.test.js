/**
 * Best-warehouse selection tests — no DB. Run with: node --test
 * Proves "best warehouse, not nearest": a farther high-demand warehouse can win.
 */
const test = require('node:test');
const assert = require('node:assert');
const { chooseWarehouse } = require('../routing.warehouse');

const SELLER = { type: 'Point', coordinates: [81.6296, 21.2514] }; // Raipur

// NEAR warehouse (Raipur, ~0 km) vs FAR warehouse (Bilaspur, ~100 km).
const warehouses = [
  { code: 'NEAR', name: 'Near DC', city: 'Raipur', location: { type: 'Point', coordinates: [81.6296, 21.2514] }, capacity: 100, categories: [] },
  { code: 'FAR', name: 'Far DC', city: 'Bilaspur', location: { type: 'Point', coordinates: [82.1409, 22.0797] }, capacity: 100, categories: [] },
];

test('with equal demand, the nearer warehouse wins', () => {
  const pick = chooseWarehouse({
    sellerLoc: SELLER, category: 'Electronics', resaleValue: 1000,
    demandByWarehouse: { NEAR: 0, FAR: 0 }, warehouses,
  });
  assert.strictEqual(pick.warehouseCode, 'NEAR');
});

test('a farther warehouse with much higher demand beats the nearer one', () => {
  const pick = chooseWarehouse({
    sellerLoc: SELLER, category: 'Electronics', resaleValue: 1000,
    demandByWarehouse: { NEAR: 0, FAR: 100 }, warehouses,
  });
  assert.strictEqual(pick.warehouseCode, 'FAR');
});

test('returns a breakdown with distance + inbound + demand', () => {
  const pick = chooseWarehouse({
    sellerLoc: SELLER, category: 'Electronics', resaleValue: 1000,
    demandByWarehouse: { NEAR: 10, FAR: 5 }, warehouses,
  });
  assert.ok(pick.breakdown);
  assert.ok(typeof pick.breakdown.distanceKm === 'number');
  assert.ok(typeof pick.breakdown.inbound === 'number');
});

test('null when no seller location', () => {
  assert.strictEqual(chooseWarehouse({ sellerLoc: null, warehouses }), null);
});

test('null when no warehouses', () => {
  assert.strictEqual(chooseWarehouse({ sellerLoc: SELLER, warehouses: [] }), null);
});
