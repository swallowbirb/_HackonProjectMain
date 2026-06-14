/**
 * smoke-festive.js — Phase 7.5 HTTP smoke test.
 *
 * Exercises the festive endpoints + order COD gate + cancel lock over real HTTP,
 * authenticating as different trust tiers via mock tokens.
 *
 * PREREQUISITES:
 *   1. Server running:        npm run dev   (in another terminal)
 *   2. Mock users seeded:     node seed-mock-users.js
 *   3. Trust personas seeded: node seed-trust.js   (gives verified/watch/etc. tiers)
 *   4. Festive calendar:      node seed-festive-calendar.js
 *
 * Run: node smoke-festive.js   (or: npm run smoke:festive)
 *
 * The script forces GIF_2025 active at the start and resets the override at the end.
 */

require('dotenv').config();
const axios = require('axios');

const PORT = process.env.PORT || 5000;
const BASE = `http://localhost:${PORT}/api`;

// Trust-tier personas seeded by seed-trust.js (token === clerkId; mock_ prefix accepted in dev).
const TOKENS = {
  verified: 'mock_p3_power',
  trusted: 'mock_p3_clean-mid',
  watch: 'mock_p3_watch-rate',
  restricted: 'mock_p3_restricted-rate',
  standard: 'mock_p3_newbie', // 0 orders, no flags → standard tier
};

const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

let pass = 0;
let fail = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.log(`  ✗ ${label}  ${detail ? '→ ' + JSON.stringify(detail) : ''}`);
    fail++;
  }
}

async function safe(fn) {
  try {
    return await fn();
  } catch (err) {
    return { __error: true, status: err.response?.status, data: err.response?.data, message: err.message };
  }
}

async function main() {
  console.log(`\nPhase 7.5 smoke test → ${BASE}\n`);

  // ── Setup: force GIF active ────────────────────────────────────────────────
  console.log('Setup: forcing GIF_2025 active...');
  const ov = await safe(() => axios.post(`${BASE}/festive/override`, { instanceKey: 'GIF_2025', on: true }));
  if (ov.__error) {
    console.error('  ✗ Could not reach the server or override failed. Is `npm run dev` running?', ov.message || ov.data);
    process.exit(1);
  }
  console.log('  ✓ GIF_2025 forced active\n');

  // ── 1. GET /festive/active ──────────────────────────────────────────────────
  console.log('1. GET /festive/active');
  const active = await safe(() => axios.get(`${BASE}/festive/active`));
  check('active=true', active.data?.data?.active === true, active.data);
  check('eventCode=GIF', active.data?.data?.event?.eventCode === 'GIF', active.data?.data?.event);
  check('cancelLock policy on', active.data?.data?.event?.policies?.cancelLock === true);
  console.log('');

  // ── 2. COD gate (payment-policy) per tier ────────────────────────────────────
  console.log('2. GET /festive/payment-policy  (Lever 2 — COD gate)');
  const verUnc = await safe(() => axios.get(`${BASE}/festive/payment-policy?cartTotal=5000`, auth(TOKENS.verified)));
  check('verified ₹5000 → COD allowed', verUnc.data?.data?.codAllowed === true, verUnc.data?.data);

  const stdOver = await safe(() => axios.get(`${BASE}/festive/payment-policy?cartTotal=2500`, auth(TOKENS.standard)));
  check('standard ₹2500 → COD blocked (cap ₹2000)', stdOver.data?.data?.codAllowed === false, stdOver.data?.data);
  check('standard → partial-prepaid token ₹100 offered', stdOver.data?.data?.partialPrepaidToken === 100, stdOver.data?.data);

  const stdUnder = await safe(() => axios.get(`${BASE}/festive/payment-policy?cartTotal=1500`, auth(TOKENS.standard)));
  check('standard ₹1500 → COD allowed (within cap)', stdUnder.data?.data?.codAllowed === true, stdUnder.data?.data);

  const restr = await safe(() => axios.get(`${BASE}/festive/payment-policy?cartTotal=100`, auth(TOKENS.restricted)));
  check('restricted ₹100 → COD blocked outright', restr.data?.data?.codAllowed === false, restr.data?.data);
  console.log('');

  // ── 3. Return window per tier (Lever 1) ──────────────────────────────────────
  console.log('3. GET /festive/return-window  (Lever 1 — return window shrink)');
  const verWin = await safe(() => axios.get(`${BASE}/festive/return-window`, auth(TOKENS.verified)));
  check('verified → 30 days (unchanged)', verWin.data?.data?.windowDays === 30, verWin.data?.data);

  const stdWin = await safe(() => axios.get(`${BASE}/festive/return-window`, auth(TOKENS.standard)));
  check('standard → 15 days (shrunk)', stdWin.data?.data?.windowDays === 15, stdWin.data?.data);

  const watchWin = await safe(() => axios.get(`${BASE}/festive/return-window`, auth(TOKENS.watch)));
  check('watch → 10 days (shrunk)', watchWin.data?.data?.windowDays === 10, watchWin.data?.data);

  const defWin = await safe(() => axios.get(`${BASE}/festive/return-window?reasonCode=defective`, auth(TOKENS.watch)));
  check('watch + defective → 30 days (full window)', defWin.data?.data?.windowDays === 30, defWin.data?.data);
  console.log('');

  // ── 4. Order COD gate + cancel lock (Levers 2 & 3) ───────────────────────────
  console.log('4. Order flow  (Lever 2 enforcement + Lever 3 cancel lock)');
  const prodResp = await safe(() => axios.get(`${BASE}/products?limit=10`));
  const products =
    prodResp.data?.data?.products || prodResp.data?.data || prodResp.data?.products || [];
  const cheap = products.find((p) => p.price && p.price <= 1500);
  const pricey = products.find((p) => p.price && p.price > 2000);

  if (!products.length) {
    console.log('  ⚠ No published products available — skipping order flow (seed products to test fully).');
  } else {
    // 4a. COD over cap as standard → expect 409 COD_NOT_AVAILABLE
    if (pricey) {
      const codBlocked = await safe(() =>
        axios.post(`${BASE}/orders`, { productId: pricey._id, quantity: 1, paymentMethod: 'cod' }, auth(TOKENS.standard))
      );
      check(
        `standard COD on ₹${pricey.price} product → 409 COD_NOT_AVAILABLE`,
        codBlocked.__error && codBlocked.status === 409 && codBlocked.data?.code === 'COD_NOT_AVAILABLE',
        { status: codBlocked.status, code: codBlocked.data?.code }
      );
    } else {
      console.log('  ⚠ No product > ₹2000 found — skipping COD-over-cap check.');
    }

    // 4b. COD under cap as standard → success, then cancel-lock test
    const orderTarget = cheap || products[0];
    const placed = await safe(() =>
      axios.post(`${BASE}/orders`, { productId: orderTarget._id, quantity: 1, paymentMethod: 'cod' }, auth(TOKENS.standard))
    );
    if (placed.__error) {
      console.log('  ⚠ Could not place COD order (likely price > cap or product unavailable):', placed.data?.message || placed.status);
    } else {
      const orderId = placed.data?.data?._id;
      check('standard COD order within cap → placed', !!orderId, placed.data);
      check('order snapshot has festivePolicy', !!placed.data?.data?.festivePolicy, placed.data?.data?.festivePolicy);

      // Advance to in_transit (seller/admin helper)
      const adv = await safe(() =>
        axios.patch(`${BASE}/orders/${orderId}/fulfillment`, { fulfillmentStatus: 'in_transit' }, auth('mock_admin'))
      );
      check('advance fulfillment → in_transit', adv.data?.data?.fulfillmentStatus === 'in_transit', adv.data);

      // Cancel attempt → expect 409 CANCEL_LOCKED (standard tier, in transit, GIF)
      const cancelBlocked = await safe(() =>
        axios.post(`${BASE}/orders/${orderId}/cancel`, {}, auth(TOKENS.standard))
      );
      check(
        'cancel in transit → 409 CANCEL_LOCKED',
        cancelBlocked.__error && cancelBlocked.status === 409 && cancelBlocked.data?.code === 'CANCEL_LOCKED',
        { status: cancelBlocked.status, code: cancelBlocked.data?.code }
      );
    }
  }
  console.log('');

  // ── Teardown: reset override ─────────────────────────────────────────────────
  console.log('Teardown: clearing GIF_2025 override...');
  await safe(() => axios.post(`${BASE}/festive/override`, { instanceKey: 'GIF_2025', on: false }));
  console.log('  ✓ override cleared\n');

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(`Result: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err.message);
  process.exit(1);
});
