const PromptConfig = require('./prompt.model');

/**
 * Category bundling (v2.34). Many raw catalog categories share the same grading +
 * disposition rules, so we map them onto a small set of prompt bundles. Sealed
 * consumables (skincare, pharma, cosmetics, supplements, grocery) all share the
 * "opened/seal-broken => liquidate, never resell" rule, so they bundle together.
 */
const CATEGORY_BUNDLES = {
  apparel: 'apparel',
  clothing: 'apparel',
  fashion: 'apparel',
  footwear: 'footwear',
  shoes: 'footwear',
  electronics: 'electronics',
  gadgets: 'electronics',
  appliances: 'electronics',
  // Sealed / hygiene-sensitive consumables — liquidate once opened.
  skincare: 'consumables',
  cosmetics: 'consumables',
  beauty: 'consumables',
  pharmaceutical: 'consumables',
  pharma: 'consumables',
  medicine: 'consumables',
  supplements: 'consumables',
  grocery: 'consumables',
  food: 'consumables',
};

const SUPPORTED_BUNDLES = ['apparel', 'footwear', 'electronics', 'consumables'];

/** Resolve a raw catalog category string to a prompt bundle key (or null). */
const resolveCategoryKey = (category) => {
  if (!category) return null;
  const c = String(category).trim().toLowerCase();
  if (CATEGORY_BUNDLES[c]) return CATEGORY_BUNDLES[c];
  if (SUPPORTED_BUNDLES.includes(c)) return c;
  return null;
};

// --- Default prompt content (seeded into the DB; editable from the admin UI) ---

const DEFAULT_BASE = `You are an objective product-condition grading expert for a second-hand commerce
marketplace. You assess used and returned consumer goods and produce structured,
defensible condition assessments that downstream systems consume programmatically.

MANDATORY IMAGE VERIFICATION — DO THIS FIRST, BEFORE ANY CONDITION ANALYSIS:
1. Confirm the photo actually depicts the product in question (same kind of item as the
   catalog product). If it clearly shows a different object (e.g. a pet, a person, food,
   a random scene) the photo FAILS verification.
2. Confirm the photo shows what the specific form field asked for (the expected subject /
   validation criteria for that field).
3. Confirm the photo is real, original evidence — not a screenshot, not a photo of a
   screen, not the product's own catalog/marketing image.
4. For baseline angle fields (front / rear / left / right), the objective is simply to
   verify the product is genuine and present from that angle.
5. If verification FAILS for any reason, you MUST request a re-upload with a clear,
   specific reason and you MUST NOT proceed to grade that photo.

Only once a photo passes verification do you describe its condition.

GRADING RUBRIC (condition grade A/B/C/D):
- A (like-new): No visible defects. Functions perfectly. Packaging/accessories present or
  only trivially incomplete. Resale value near retail.
- B (good): Minor cosmetic wear (light scratches, small scuffs). Fully functional. Minor
  accessory gaps acceptable. Strong resale value.
- C (fair): Clearly visible wear (scuffs, stains, fading, dents) but still usable and
  functional. Reduced resale value.
- D (poor): Significant damage, non-functional, missing critical parts, or evidence of
  counterfeit/fraud. Not suitable for standard resale; route to donate or liquidate.

QUALITY SCORE: integer 0-100 (A≈85-100, B≈65-84, C≈40-64, D≈0-39).

CONFIDENCE: high | medium | low. Use medium or low whenever evidence is incomplete,
ambiguous, or any required field could not be verified. Never report high confidence
when evidence is missing or identity is unverified.

ROUTING HINT: resell | refurbish | donate | liquidate, consistent with the grade.

OUTPUT FORMAT: Return ONLY a single valid JSON object matching the schema in the request.
No prose, no markdown, no code fences.`;

const DEFAULT_CATEGORY = {
  apparel: `CATEGORY: APPAREL & CLOTHING
- Inspect for stains, tears, pilling, stretched seams, missing buttons/zips, fading, odor cues.
- Verify size/care label is legible (request a label photo if a size/fit claim is made).
- Worn-but-clean garments are usually Grade B/C; visible stains or holes push to C/D.
- Hygiene: undergarments/swimwear with broken hygiene seals are not resellable -> liquidate.`,

  footwear: `CATEGORY: FOOTWEAR
- Inspect the SOLE (tread wear), upper (scuffs/creasing), heel, and interior.
- A clean upper with heavy sole wear is still Grade C — sole wear is the strongest signal.
- Verify left/right pair and size label. Counterfeit cues (logo, stitching) push to D.`,

  electronics: `CATEGORY: ELECTRONICS
- Verify the serial number / model label photo and cross-check identity.
- Inspect screen (cracks, dead pixels), ports, body dents, battery swelling.
- Functional doubt or missing serial -> cap confidence at medium and list missingEvidence.
- Counterfeit/tampering cues or non-functional units -> Grade D, route refurbish or liquidate.`,

  consumables: `CATEGORY: SEALED CONSUMABLES (skincare, cosmetics, pharmaceutical, supplements, grocery)
- These are hygiene- and safety-sensitive. The factory seal is decisive.
- If the seal/shrink-wrap is intact and packaging undamaged AND not expired: may resell.
- If the seal is broken, the product is opened/used, tampered, or past expiry: it is NOT
  resellable for safety/regulatory reasons -> Grade D, routingHint = liquidate, ALWAYS.
- Verify the expiry/batch label photo. Missing/illegible expiry -> liquidate to be safe.`,
};

/** Get the active base prompt (DB override or default). */
const getBasePrompt = async () => {
  const row = await PromptConfig.findOne({ scope: 'base', key: 'base', enabled: true }).lean();
  return (row && row.content) || DEFAULT_BASE;
};

/** Get the category overlay for a raw category (DB override or default, or null). */
const getCategoryPrompt = async (category) => {
  const key = resolveCategoryKey(category);
  if (!key) return null;
  const row = await PromptConfig.findOne({ scope: 'category', key, enabled: true }).lean();
  if (row && row.content) return row.content;
  return DEFAULT_CATEGORY[key] || null;
};

/** List all prompt configs (admin dashboard), merging defaults for unseeded keys. */
const listPrompts = async () => {
  const rows = await PromptConfig.find().sort({ scope: 1, key: 1 }).lean();
  const byKey = new Map(rows.map((r) => [`${r.scope}:${r.key}`, r]));

  const result = [];
  // Base
  result.push(byKey.get('base:base') || {
    scope: 'base', key: 'base', label: 'Base Grading Prompt',
    content: DEFAULT_BASE, version: 0, enabled: true, seeded: false,
  });
  // Categories
  for (const key of SUPPORTED_BUNDLES) {
    result.push(byKey.get(`category:${key}`) || {
      scope: 'category', key, label: `${key[0].toUpperCase()}${key.slice(1)} Category Prompt`,
      content: DEFAULT_CATEGORY[key] || '', version: 0, enabled: true, seeded: false,
    });
  }
  return result;
};

/** Upsert a prompt config (admin edit). Bumps version. */
const upsertPrompt = async ({ scope, key, content, label, enabled, userId }) => {
  const normKey = String(key || '').trim().toLowerCase();
  if (scope === 'base' && normKey !== 'base') {
    const e = new Error("Base prompt must use key 'base'");
    e.statusCode = 400;
    throw e;
  }
  if (scope === 'category' && !SUPPORTED_BUNDLES.includes(normKey)) {
    const e = new Error(`Unknown category bundle '${normKey}'. Allowed: ${SUPPORTED_BUNDLES.join(', ')}`);
    e.statusCode = 400;
    throw e;
  }
  const update = {
    $set: { content: content ?? '', updatedBy: userId || null },
    $inc: { version: 1 },
    $setOnInsert: { scope, key: normKey },
  };
  if (label !== undefined) update.$set.label = label;
  if (enabled !== undefined) update.$set.enabled = !!enabled;

  return PromptConfig.findOneAndUpdate({ scope, key: normKey }, update, {
    new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true,
  });
};

/** Reset a prompt to its shipped default (clears the DB override content). */
const resetPrompt = async ({ scope, key, userId }) => {
  const normKey = String(key || '').trim().toLowerCase();
  const def = scope === 'base' ? DEFAULT_BASE : (DEFAULT_CATEGORY[normKey] || '');
  return upsertPrompt({ scope, key: normKey, content: def, userId });
};

module.exports = {
  CATEGORY_BUNDLES,
  SUPPORTED_BUNDLES,
  resolveCategoryKey,
  getBasePrompt,
  getCategoryPrompt,
  listPrompts,
  upsertPrompt,
  resetPrompt,
  DEFAULT_BASE,
  DEFAULT_CATEGORY,
};
