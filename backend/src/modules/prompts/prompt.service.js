const fs = require('fs');
const path = require('path');
const PromptConfig = require('./prompt.model');

// Templates read/write directly to the ML service .txt files — the file IS the
// source of truth. No DB layer for templates; edits in the console are instant.
const ML_PROMPTS_DIR = path.resolve(__dirname, '../../../../ml-service/app/prompts');

function _readPromptFile(filename) {
  try {
    return fs.readFileSync(path.join(ML_PROMPTS_DIR, filename), 'utf8');
  } catch {
    return null;
  }
}

function _writePromptFile(filename, content) {
  fs.writeFileSync(path.join(ML_PROMPTS_DIR, filename), content, 'utf8');
}

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

// The four built-in bundles always show in the console (with a hardcoded default
// fallback). Admins can add MORE categories from the console — each is just another
// `.txt` file under categories/, discovered dynamically at list time.
const SUPPORTED_BUNDLES = ['apparel', 'footwear', 'electronics', 'consumables'];

// Each category is backed by a live `.txt` overlay file under
// ml-service/app/prompts/categories/ — the file IS the source of truth, exactly like
// the task templates below. The console reads and writes these files directly; no DB
// override layer sits in front of them.
const CATEGORIES_SUBDIR = 'categories';

/** Normalize a category name/key into a filesystem-safe slug (a-z0-9 + underscore). */
const slugifyCategoryKey = (name) =>
  String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/** Relative path of a category's overlay file (e.g. 'categories/electronics.txt'). */
const _categoryFile = (key) => `${CATEGORIES_SUBDIR}/${key}.txt`;

/** True if a category's overlay file exists on disk. */
const _categoryFileExists = (key) =>
  !!key && fs.existsSync(path.join(ML_PROMPTS_DIR, _categoryFile(key)));

/** Pretty, human-friendly label derived from a slug ('home_garden' -> 'Home Garden'). */
const _prettifyKey = (key) =>
  String(key || '')
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

const _categoryLabel = (key) => `${_prettifyKey(key)} Category Prompt`;

/**
 * Every category key the console should show: the built-in bundles (always) plus any
 * extra `.txt` files an admin added under categories/. Sorted, de-duplicated.
 */
const listCategoryKeys = () => {
  let discovered = [];
  try {
    discovered = fs
      .readdirSync(path.join(ML_PROMPTS_DIR, CATEGORIES_SUBDIR))
      .filter((f) => f.endsWith('.txt'))
      .map((f) => f.slice(0, -'.txt'.length));
  } catch {
    // categories dir missing/unreadable — fall back to built-ins only.
  }
  return [...new Set([...SUPPORTED_BUNDLES, ...discovered])].sort();
};

/**
 * Task templates (v3) — whole prompt bodies sent to the Grading_LLM that an admin can
 * edit from the console. These OVERRIDE the bundled `.txt` files shipped in the ML
 * service (ml-service/app/prompts/*.txt). When no DB override exists, the ML service
 * falls back to its bundled file; the defaults below are the backend's last-resort
 * fallback content surfaced in the admin console.
 */
const SUPPORTED_TEMPLATES = ['pass1_form', 'pass2_synthesis', 'evidence_inspection', 'montage'];

const TEMPLATE_LABELS = {
  pass1_form: 'Pass 1 — Form Generation Template',
  pass2_synthesis: 'Pass 2 — Grade Synthesis Template',
  evidence_inspection: 'Evidence Inspection Template',
  montage: 'Montage Triage Prompt',
};

/**
 * Resolve a raw catalog category string to a prompt bundle key (or null).
 * Order: known alias -> built-in bundle -> any admin-added category whose file exists.
 */
const resolveCategoryKey = (category) => {
  if (!category) return null;
  const c = String(category).trim().toLowerCase();
  if (CATEGORY_BUNDLES[c]) return CATEGORY_BUNDLES[c];
  if (SUPPORTED_BUNDLES.includes(c)) return c;
  // Admin-added category: matches its own slug when an overlay file exists.
  const slug = slugifyCategoryKey(c);
  if (slug && _categoryFileExists(slug)) return slug;
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

// Hardcoded last-resort fallbacks for the built-in category overlays — only used if a
// bundle's `.txt` file under ml-service/app/prompts/categories/ is unreadable. The file
// is the source of truth (see _categoryFile); these are NOT seeded into the DB. Admin-
// added categories have no hardcoded fallback — their file is always the source.
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

// Hardcoded last-resort fallbacks — only used if the .txt file is unreadable.
const _TEMPLATE_FALLBACK = {
  pass1_form: 'PASS 1 — EVIDENCE FORM GENERATION\n\n(ML service prompt file unavailable)',
  pass2_synthesis: 'PASS 2 — GRADE SYNTHESIS\n\n(ML service prompt file unavailable)',
  evidence_inspection: 'PER-FIELD EVIDENCE INSPECTION\n\n(ML service prompt file unavailable)',
  montage: 'MONTAGE TRIAGE\n\n(ML service prompt file unavailable)',
};

// Map each template key to the filename the ML service actually loads.
const TEMPLATE_FILES = {
  pass1_form: 'pass1_form_generation.txt',
  pass2_synthesis: 'pass2_grade_synthesis.txt',
  evidence_inspection: 'evidence_inspection.txt',
  montage: 'montage_overview.txt',
};

// Read the live .txt files once at module load; fall back to stubs if missing.
const DEFAULT_TEMPLATE = Object.fromEntries(
  Object.entries(TEMPLATE_FILES).map(([key, filename]) => [
    key,
    _readPromptFile(filename) ?? _TEMPLATE_FALLBACK[key],
  ])
);

/** Get the active base prompt (DB override or default). */
const getBasePrompt = async () => {
  const row = await PromptConfig.findOne({ scope: 'base', key: 'base', enabled: true }).lean();
  return (row && row.content) || DEFAULT_BASE;
};

/**
 * Get the category overlay for a raw category — reads directly from the bundle's
 * `.txt` file (the source of truth), falling back to the hardcoded default only if
 * the file is unreadable. Returns null for an unsupported category.
 */
const getCategoryPrompt = async (category) => {
  const key = resolveCategoryKey(category);
  if (!key) return null;
  return _readPromptFile(_categoryFile(key)) ?? DEFAULT_CATEGORY[key] ?? null;
};

/**
 * Get the effective content for a task template — reads directly from the .txt file.
 * Returns null for an unknown template key.
 */
const getTemplatePrompt = async (key) => {
  const normKey = String(key || '').trim().toLowerCase();
  if (!SUPPORTED_TEMPLATES.includes(normKey)) return null;
  return _readPromptFile(TEMPLATE_FILES[normKey]) ?? DEFAULT_TEMPLATE[normKey] ?? null;
};

/**
 * Get the current template content to thread as an override to the ML service.
 * Since the file IS the source of truth, always return the file content so the
 * ML service uses the admin-edited version rather than its own bundled copy.
 */
const getTemplateOverride = async (key) => {
  const normKey = String(key || '').trim().toLowerCase();
  if (!SUPPORTED_TEMPLATES.includes(normKey)) return null;
  return _readPromptFile(TEMPLATE_FILES[normKey]) ?? null;
};

/** List all prompt configs (admin dashboard), merging defaults for unseeded keys. */
const listPrompts = async () => {
  const rows = await PromptConfig.find().sort({ scope: 1, key: 1 }).lean();
  const byKey = new Map(rows.map((r) => [`${r.scope}:${r.key}`, r]));

  // The DB row content wins only when it is non-empty; otherwise fall back to the
  // shipped default so the console always shows the current EFFECTIVE content.
  const effective = (dbRow, fallback, base) => {
    if (dbRow && dbRow.content) return dbRow;
    return { ...base, content: fallback, version: dbRow ? dbRow.version : 0, seeded: false };
  };

  const result = [];
  // Base
  result.push(
    effective(byKey.get('base:base'), DEFAULT_BASE, {
      scope: 'base', key: 'base', label: 'Base Grading Prompt', enabled: true,
    })
  );
  // Categories — discovered dynamically from the `.txt` overlay files (built-ins +
  // admin-added). DB rows are ignored for categories (the file is the source of truth,
  // same as templates below). `builtin` marks the four shipped bundles so the console
  // can protect them from deletion.
  for (const key of listCategoryKeys()) {
    const fileContent = _readPromptFile(_categoryFile(key)) ?? DEFAULT_CATEGORY[key] ?? '';
    result.push({
      scope: 'category', key,
      label: _categoryLabel(key),
      content: fileContent, enabled: true, version: 0, seeded: false,
      builtin: SUPPORTED_BUNDLES.includes(key),
    });
  }
  // Templates — always read from the .txt file; DB rows are ignored for templates.
  for (const key of SUPPORTED_TEMPLATES) {
    const fileContent = _readPromptFile(TEMPLATE_FILES[key]) ?? DEFAULT_TEMPLATE[key] ?? '';
    result.push({
      scope: 'template', key, label: TEMPLATE_LABELS[key] || key,
      content: fileContent, enabled: true, version: 0, seeded: false,
    });
  }
  return result;
};

/** Upsert a prompt config (admin edit). Bumps version. */
const upsertPrompt = async ({ scope, key, content, label, enabled, userId }) => {
  // Categories accept any admin-supplied name (new or existing) — slugify it so the
  // filename is safe. Other scopes use the lowercased key as-is.
  const normKey = scope === 'category'
    ? slugifyCategoryKey(key)
    : String(key || '').trim().toLowerCase();
  if (scope === 'base' && normKey !== 'base') {
    const e = new Error("Base prompt must use key 'base'");
    e.statusCode = 400;
    throw e;
  }
  if (scope === 'category' && !normKey) {
    const e = new Error('Category name must contain at least one letter or number.');
    e.statusCode = 400;
    throw e;
  }
  if (scope === 'template' && !SUPPORTED_TEMPLATES.includes(normKey)) {
    const e = new Error(`Unknown template '${normKey}'. Allowed: ${SUPPORTED_TEMPLATES.join(', ')}`);
    e.statusCode = 400;
    throw e;
  }

  // Reject empty content — refuse the save, retain current content. (Req 14.5)
  if (typeof content !== 'string' || content.trim().length === 0) {
    const e = new Error('Prompt content must be a non-empty string; the previous content was retained.');
    e.statusCode = 400;
    throw e;
  }

  // Templates and categories write directly to their .txt file — no DB involved.
  if (scope === 'template') {
    _writePromptFile(TEMPLATE_FILES[normKey], content);
    return { scope, key: normKey, content, label: TEMPLATE_LABELS[normKey], enabled: true, version: 0 };
  }
  if (scope === 'category') {
    _writePromptFile(_categoryFile(normKey), content);
    return {
      scope, key: normKey, content, label: _categoryLabel(normKey),
      enabled: true, version: 0, builtin: SUPPORTED_BUNDLES.includes(normKey),
    };
  }

  const update = {
    $set: { content, updatedBy: userId || null },
    $inc: { version: 1 },
    $setOnInsert: { scope, key: normKey },
  };
  if (label !== undefined) update.$set.label = label;
  if (enabled !== undefined) update.$set.enabled = !!enabled;

  return PromptConfig.findOneAndUpdate({ scope, key: normKey }, update, {
    new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true,
  });
};

/** Reset a prompt to its last-committed version (file-backed scopes: git checkout the file). */
const resetPrompt = async ({ scope, key, userId }) => {
  const normKey = scope === 'category'
    ? slugifyCategoryKey(key)
    : String(key || '').trim().toLowerCase();

  // Templates and categories are file-backed — reset == restore the committed file.
  if (scope === 'template' || scope === 'category') {
    const { execSync } = require('child_process');
    const filename = scope === 'template' ? TEMPLATE_FILES[normKey] : _categoryFile(normKey);
    const filePath = path.join(ML_PROMPTS_DIR, filename);
    try {
      execSync(`git checkout HEAD -- "${filePath}"`, { stdio: 'pipe' });
    } catch {
      // git not available or file not tracked — no-op, keep current content
    }
    const fallback = scope === 'template' ? _TEMPLATE_FALLBACK[normKey] : DEFAULT_CATEGORY[normKey];
    const content = _readPromptFile(filename) ?? fallback ?? '';
    const label = scope === 'template' ? TEMPLATE_LABELS[normKey] : _categoryLabel(normKey);
    return { scope, key: normKey, content, label, enabled: true, version: 0 };
  }

  // Base remains DB-backed.
  return upsertPrompt({ scope, key: normKey, content: DEFAULT_BASE, userId });
};

/**
 * Delete an admin-added category overlay (its `.txt` file). The four built-in bundles
 * cannot be deleted — they ship with the platform and always appear in the console.
 */
const deleteCategory = async ({ key }) => {
  const normKey = slugifyCategoryKey(key);
  if (!normKey) {
    const e = new Error('Category name required.');
    e.statusCode = 400;
    throw e;
  }
  if (SUPPORTED_BUNDLES.includes(normKey)) {
    const e = new Error(`'${normKey}' is a built-in category and cannot be deleted. Use Reset to restore its default.`);
    e.statusCode = 400;
    throw e;
  }
  if (!_categoryFileExists(normKey)) {
    const e = new Error(`Category '${normKey}' does not exist.`);
    e.statusCode = 404;
    throw e;
  }
  fs.unlinkSync(path.join(ML_PROMPTS_DIR, _categoryFile(normKey)));
  // Drop any stale DB override row so it can't shadow a future same-named category.
  try { await PromptConfig.deleteOne({ scope: 'category', key: normKey }); } catch { /* best-effort */ }
  return { scope: 'category', key: normKey, deleted: true };
};

module.exports = {
  CATEGORY_BUNDLES,
  SUPPORTED_BUNDLES,
  SUPPORTED_TEMPLATES,
  TEMPLATE_LABELS,
  slugifyCategoryKey,
  listCategoryKeys,
  resolveCategoryKey,
  getBasePrompt,
  getCategoryPrompt,
  getTemplatePrompt,
  getTemplateOverride,
  listPrompts,
  upsertPrompt,
  resetPrompt,
  deleteCategory,
  DEFAULT_BASE,
  DEFAULT_CATEGORY,
  DEFAULT_TEMPLATE,
};
