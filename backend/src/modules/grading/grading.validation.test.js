/**
 * Standalone tests for grading trigger validation (Property 7).
 * Dependency-free — run with: node src/modules/grading/grading.validation.test.js
 *
 * Verifies the Grading_Request_Contract validation rejects malformed payloads
 * with HTTP 400 and accepts well-formed ones (Req 1.1, 1.2, 1.3).
 */
const assert = require('assert');
const { validateTriggerGrading } = require('./grading.validation');

// Minimal Express req/res/next test doubles.
const run = (body) => {
  let statusCode = null;
  let payload = null;
  let nextCalled = false;
  const req = { body };
  const res = {
    status(code) { statusCode = code; return this; },
    json(obj) { payload = obj; return this; },
  };
  const next = () => { nextCalled = true; };
  validateTriggerGrading(req, res, next);
  return { statusCode, payload, nextCalled };
};

const validBody = () => ({
  itemId: '507f1f77bcf86cd799439011',
  userId: '507f1f77bcf86cd799439012',
  productId: '507f1f77bcf86cd799439013',
  reason: 'screen cracked',
  imageUrls: ['https://bucket.s3.ap-south-1.amazonaws.com/a.jpg'],
  intakePath: 'returns',
  category: 'electronics',
});

const tests = {
  accepts_valid_payload() {
    const { nextCalled, statusCode } = run(validBody());
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(statusCode, null);
  },

  rejects_missing_itemId() {
    const b = validBody(); delete b.itemId;
    const { statusCode, payload, nextCalled } = run(b);
    assert.strictEqual(statusCode, 400);
    assert.strictEqual(payload.success, false);
    assert.strictEqual(nextCalled, false);
  },

  rejects_empty_imageUrls() {
    const b = validBody(); b.imageUrls = [];
    const { statusCode } = run(b);
    assert.strictEqual(statusCode, 400);
  },

  rejects_too_many_imageUrls() {
    const b = validBody();
    b.imageUrls = Array.from({ length: 11 }, (_, i) => `https://x.s3.amazonaws.com/${i}.jpg`);
    const { statusCode } = run(b);
    assert.strictEqual(statusCode, 400);
  },

  rejects_non_https_url() {
    const b = validBody(); b.imageUrls = ['http://insecure.example.com/a.jpg'];
    const { statusCode } = run(b);
    assert.strictEqual(statusCode, 400);
  },

  rejects_bad_intakePath() {
    const b = validBody(); b.intakePath = 'auction';
    const { statusCode } = run(b);
    assert.strictEqual(statusCode, 400);
  },

  rejects_non_array_imageUrls() {
    const b = validBody(); b.imageUrls = 'https://x.s3.amazonaws.com/a.jpg';
    const { statusCode } = run(b);
    assert.strictEqual(statusCode, 400);
  },

  rejects_empty_reason() {
    const b = validBody(); b.reason = '   ';
    const { statusCode } = run(b);
    assert.strictEqual(statusCode, 400);
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}: ${err.message}`);
  }
}
console.log(`\n${Object.keys(tests).length - failed}/${Object.keys(tests).length} passed`);
process.exit(failed ? 1 : 0);
