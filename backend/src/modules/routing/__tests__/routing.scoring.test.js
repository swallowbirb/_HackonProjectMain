/**
 * Pure routing-scoring unit tests — no DB. Run with: node --test
 * Locks the disposition brain, hard gates, refund timing, and determinism.
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

const baseInputs = (o = {}) => ({
  grade: { grade: 'A', qualityScore: 90, estimatedResalePct: 0.7 },
  resaleValue: 1400,
  demandCount: 0,
  inboundCost: 100,
  category: 'Electronics',
  trust: { tier: 'verified', score: 90 },
  ...o,
});

test('haversine: Raipur→Bilaspur ≈ 95-115 km', () => {
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

test('Grade A + verified → resell wins', () => {
  const d = decide(baseInputs());
  assert.strictEqual(d.chosenPath, 'resell');
});

test('Grade A + nearby demand → peer-redistribute beats plain resell', () => {
  const d = decide(baseInputs({ demandCount: 8 }));
  assert.strictEqual(d.chosenPath, 'peer-redistribute');
});

test('Counterfeit hard gate → liquidate, overrides score', () => {
  const d = decide(baseInputs({ counterfeit: true }));
  assert.strictEqual(d.chosenPath, 'liquidate');
  assert.ok(d.hardGatesApplied.includes('COUNTERFEIT_DETECTED'));
});

test('Grade D + no demand → donate gate', () => {
  const d = decide(baseInputs({ grade: { grade: 'D', estimatedResalePct: 0.1 }, resaleValue: 50 }));
  assert.strictEqual(d.chosenPath, 'donate');
  assert.ok(d.hardGatesApplied.includes('GRADE_D_NO_DEMAND'));
});

test('Hygiene category → donate (grade A/B) gate', () => {
  const d = decide(baseInputs({ category: 'Health & Beauty' }));
  assert.strictEqual(d.chosenPath, 'donate');
  assert.ok(d.hardGatesApplied.includes('HYGIENE_SAFETY'));
});

test('Restricted user → return-to-seller + refund rejected', () => {
  const d = decide(baseInputs({ trust: { tier: 'restricted', score: 5 } }));
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
  const a = decide(baseInputs({ demandCount: 3 }));
  const b = decide(baseInputs({ demandCount: 3 }));
  assert.deepStrictEqual(a, b);
});

test('applyHardGates: clean grade A → no forced path', () => {
  const { forcedPath, gatesApplied } = applyHardGates(baseInputs());
  assert.strictEqual(forcedPath, null);
  assert.strictEqual(gatesApplied.length, 0);
});

test('ranked alternatives are sorted descending by score', () => {
  const d = decide(baseInputs({ demandCount: 5 }));
  for (let i = 1; i < d.rankedAlternatives.length; i++) {
    assert.ok(d.rankedAlternatives[i - 1].score >= d.rankedAlternatives[i].score);
  }
});
