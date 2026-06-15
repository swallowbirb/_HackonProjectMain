/**
 * Pure routing decision-tree unit tests — no DB. Run with: node --test
 * Locks the disposition tree, hard gates, refund timing, and determinism.
 */
const test = require('node:test');
const assert = require('node:assert');
const {
  haversine,
  reverseLogisticsCost,
  decide,
  applyHardGates,
  decideRefundTiming,
} = require('../routing.scoring');

const RAIPUR = { type: 'Point', coordinates: [81.6296, 21.2514] };
const BILASPUR = { type: 'Point', coordinates: [82.1409, 22.0797] };

// A profitable best-warehouse pick (as routing.warehouse.chooseWarehouse returns).
const viableWarehouse = (o = {}) => ({
  warehouseCode: 'RAIPUR-01',
  warehouse: { code: 'RAIPUR-01', city: 'Raipur', name: 'Raipur Central Hub' },
  score: 800,
  viable: true,
  breakdown: { distanceKm: 0, inbound: 100, demand: 60, sellThrough: 1, resaleValue: 1400, expectedRecovery: 800 },
  ...o,
});

const baseInputs = (o = {}) => ({
  grade: { grade: 'A', qualityScore: 90, estimatedResalePct: 0.7 },
  resaleValue: 1400,
  category: 'Electronics',
  trust: { tier: 'verified', score: 90 },
  peerCount: 0,
  warehouse: viableWarehouse(),
  inboundCost: 100,
  ...o,
});

test('haversine: Raipur→Bilaspur ≈ 90-120 km', () => {
  const d = haversine(RAIPUR.coordinates, BILASPUR.coordinates);
  assert.ok(d > 90 && d < 120, `distance=${d}`);
});

test('haversine: zero distance for same point', () => {
  assert.strictEqual(haversine(RAIPUR.coordinates, RAIPUR.coordinates), 0);
});

test('reverseLogisticsCost grows with distance', () => {
  const near = reverseLogisticsCost({ origin: RAIPUR, destination: RAIPUR, category: 'Books' });
  const far = reverseLogisticsCost({ origin: RAIPUR, destination: BILASPUR, category: 'Books' });
  assert.ok(far > near, `far=${far} near=${near}`);
});

test('Grade A + no peer + profitable warehouse → resell', () => {
  const d = decide(baseInputs());
  assert.strictEqual(d.chosenPath, 'resell');
});

test('Grade A + a nearby peer buyer → peer-redistribute (skips warehouse)', () => {
  const d = decide(baseInputs({ peerCount: 1 }));
  assert.strictEqual(d.chosenPath, 'peer-redistribute');
});

test('Even a single peer buyer triggers peer handoff', () => {
  const d = decide(baseInputs({ peerCount: 1, warehouse: viableWarehouse() }));
  assert.strictEqual(d.chosenPath, 'peer-redistribute');
});

test('No peer + no profitable warehouse + decent value → liquidate', () => {
  const d = decide(baseInputs({ peerCount: 0, warehouse: { viable: false, score: -120, breakdown: {} }, resaleValue: 1400 }));
  assert.strictEqual(d.chosenPath, 'liquidate');
});

test('No peer + no profitable warehouse + low value → donate', () => {
  const d = decide(baseInputs({ peerCount: 0, warehouse: { viable: false, score: -50, breakdown: {} }, resaleValue: 100 }));
  assert.strictEqual(d.chosenPath, 'donate');
});

test('Counterfeit hard gate → liquidate, overrides tree', () => {
  const d = decide(baseInputs({ counterfeit: true, peerCount: 5 }));
  assert.strictEqual(d.chosenPath, 'liquidate');
  assert.ok(d.hardGatesApplied.includes('COUNTERFEIT_DETECTED'));
});

test('Grade D → donate gate (not resellable)', () => {
  const d = decide(baseInputs({ grade: { grade: 'D', estimatedResalePct: 0.1 }, resaleValue: 50, peerCount: 4 }));
  assert.strictEqual(d.chosenPath, 'donate');
  assert.ok(d.hardGatesApplied.includes('GRADE_D_NOT_RESELLABLE'));
});

test('Hygiene category → donate (grade A/B) gate', () => {
  const d = decide(baseInputs({ category: 'Health & Beauty', peerCount: 3 }));
  assert.strictEqual(d.chosenPath, 'donate');
  assert.ok(d.hardGatesApplied.includes('HYGIENE_SAFETY'));
});

test('Restricted user → return-to-seller + refund rejected', () => {
  const d = decide(baseInputs({ trust: { tier: 'restricted', score: 5 }, peerCount: 9 }));
  assert.strictEqual(d.chosenPath, 'return-to-seller');
  assert.strictEqual(d.refundTiming, 'rejected');
  assert.strictEqual(d.refundHold, true);
});

test('Low-trust → refund held for inspection', () => {
  const r = decideRefundTiming({ tier: 'watch' }, 100);
  assert.strictEqual(r.refundHold, true);
  assert.strictEqual(r.refundTiming, 'on-inspection');
});

test('Trusted + cheap inbound → immediate refund', () => {
  const r = decideRefundTiming({ tier: 'verified' }, 50);
  assert.strictEqual(r.refundTiming, 'immediate');
  assert.strictEqual(r.refundHold, false);
});

test('Trusted + expensive inbound → on-resolution (not immediate)', () => {
  const r = decideRefundTiming({ tier: 'verified' }, 5000);
  assert.strictEqual(r.refundTiming, 'on-resolution');
});

test('determinism: same inputs → identical decision', () => {
  const a = decide(baseInputs({ peerCount: 2 }));
  const b = decide(baseInputs({ peerCount: 2 }));
  assert.deepStrictEqual(a, b);
});

test('applyHardGates: clean grade A → no forced path', () => {
  const { forcedPath, gatesApplied } = applyHardGates(baseInputs());
  assert.strictEqual(forcedPath, null);
  assert.strictEqual(gatesApplied.length, 0);
});

test('ranked alternatives are sorted descending by recovery', () => {
  const d = decide(baseInputs({ peerCount: 0 }));
  // (chosen path is bubbled to front; the rest must be sorted desc)
  const rest = d.rankedAlternatives.slice(1);
  for (let i = 1; i < rest.length; i++) {
    assert.ok(rest[i - 1].score >= rest[i].score);
  }
});
