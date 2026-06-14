/**
 * Pure scoring unit tests — no DB. Run with: node --test
 * Locks the 13 cases from the Phase 3 implementation guide (section 9).
 */
const test = require('node:test');
const assert = require('node:assert');
const { assembleProfile } = require('../trust.scoring');

const base = {
  accountAgeDays: 0,
  lifetimePurchases: 0,
  lifetimeReturns: 0,
  returnRate: 0,
  recentReturnRate90d: 0,
  bracketingFlag: false,
  wardrobingFlag: false,
  banned: false,
  hardFraudHits: 0,
  softFraudHits: 0,
};
const facts = (o) => ({ ...base, ...o });

test('1. power user (Priya) -> verified, score ~98', () => {
  const p = assembleProfile(facts({
    accountAgeDays: 730, lifetimePurchases: 40, lifetimeReturns: 1, returnRate: 1 / 40,
  }));
  assert.strictEqual(p.tier, 'verified');
  assert.ok(p.score >= 97 && p.score <= 99, `score=${p.score}`);
});

test('2. watch-rate user (45% returns) -> watch (return-rate cap)', () => {
  const p = assembleProfile(facts({
    accountAgeDays: 180, lifetimePurchases: 20, lifetimeReturns: 9,
    returnRate: 0.45, recentReturnRate90d: 0.45,
  }));
  assert.strictEqual(p.tier, 'watch');
});

test('3. restricted-rate user (73% returns) -> restricted (kill switch)', () => {
  const p = assembleProfile(facts({
    accountAgeDays: 200, lifetimePurchases: 15, lifetimeReturns: 11, returnRate: 0.73, recentReturnRate90d: 0.73,
  }));
  assert.strictEqual(p.tier, 'restricted');
});

test('4. 40 purchases, 1 return -> NEVER watch/restricted', () => {
  const p = assembleProfile(facts({
    accountAgeDays: 730, lifetimePurchases: 40, lifetimeReturns: 1, returnRate: 1 / 40,
  }));
  assert.ok(['verified', 'trusted'].includes(p.tier), `tier=${p.tier}`);
});

test('5. wardrobe flag + mid history -> watch', () => {
  const p = assembleProfile(facts({
    accountAgeDays: 200, lifetimePurchases: 12, lifetimeReturns: 4,
    returnRate: 0.30, recentReturnRate90d: 0.30, wardrobingFlag: true,
  }));
  assert.strictEqual(p.tier, 'watch');
});

test('6. bracketing + wardrobe both -> watch', () => {
  const p = assembleProfile(facts({
    accountAgeDays: 365, lifetimePurchases: 20, returnRate: 0.20, recentReturnRate90d: 0.10,
    bracketingFlag: true, wardrobingFlag: true,
  }));
  assert.strictEqual(p.tier, 'watch');
  assert.ok(p.appliedTripwires.includes('BRACKETING_AND_WARDROBE'));
});

test('7. sudden-shift (lifetime 10%, 90d 40%) -> watch', () => {
  const p = assembleProfile(facts({
    accountAgeDays: 400, lifetimePurchases: 30, lifetimeReturns: 3,
    returnRate: 0.10, recentReturnRate90d: 0.40,
  }));
  assert.strictEqual(p.tier, 'watch');
  assert.ok(p.appliedTripwires.includes('SUDDEN_SHIFT'));
});

test('8. new account, zero history -> not punished (score ~70, never watch/restricted)', () => {
  const p = assembleProfile(facts({ accountAgeDays: 5 }));
  assert.ok(p.score >= 65 && p.score <= 75, `score=${p.score}`);
  assert.ok(['trusted', 'standard'].includes(p.tier), `tier=${p.tier}`);
});

test('9. banned user with good score -> restricted', () => {
  const p = assembleProfile(facts({
    accountAgeDays: 365, lifetimePurchases: 20, returnRate: 0.02, banned: true,
  }));
  assert.strictEqual(p.tier, 'restricted');
});

test('10. hardFraudHits=1 with good score -> capped at watch', () => {
  const p = assembleProfile(facts({
    accountAgeDays: 730, lifetimePurchases: 40, lifetimeReturns: 1, returnRate: 1 / 40, hardFraudHits: 1,
  }));
  assert.strictEqual(p.tier, 'watch');
});

test('11. hardFraudHits=2 -> restricted', () => {
  const p = assembleProfile(facts({
    accountAgeDays: 730, lifetimePurchases: 40, returnRate: 0.02, hardFraudHits: 2,
  }));
  assert.strictEqual(p.tier, 'restricted');
});

test('12. softFraudHits=1 only -> score -15, no escalation tripwire', () => {
  const p = assembleProfile(facts({
    accountAgeDays: 730, lifetimePurchases: 40, lifetimeReturns: 1, returnRate: 1 / 40, softFraudHits: 1,
  }));
  // raw ~98.4 - 15 = ~83 -> trusted
  assert.ok(p.score >= 82 && p.score <= 85, `score=${p.score}`);
  assert.strictEqual(p.tier, 'trusted');
  assert.ok(!p.appliedTripwires.includes('SOFT_FRAUD_WITH_PATTERN'));
});

test('13. softFraudHits=1 + bracketing -> escalate one tier down (standard -> watch)', () => {
  const f = facts({
    accountAgeDays: 365, lifetimePurchases: 25, returnRate: 0.20, recentReturnRate90d: 0.10,
    bracketingFlag: true,
  });
  const without = assembleProfile({ ...f, softFraudHits: 0 });
  const withSoft = assembleProfile({ ...f, softFraudHits: 1 });
  assert.strictEqual(without.tier, 'standard');
  assert.strictEqual(withSoft.tier, 'watch');
  assert.ok(withSoft.appliedTripwires.includes('SOFT_FRAUD_WITH_PATTERN'));
});
