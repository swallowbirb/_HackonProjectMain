const axios = require('axios');
const mongoose = require('mongoose');

const Grade = require('./grading.model');
const { emitGraded } = require('./lifecycleEmitter');
const ItemLogger = require('../../utils/itemLogger');
const promptService = require('../prompts/prompt.service');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
const ML_TIMEOUT_MS = parseInt(process.env.ML_TIMEOUT_MS || '120000', 10); // analysis fanout alone can take 60s; keep well above internal budgets
const ML_GRADE_ENDPOINT = `${ML_SERVICE_URL}/grade/`;

// Configured Gemini models (mirrors ml-service config) — surfaced in logs so devs
// can see which model the pipeline is expected to call.
const GEMINI_PRIMARY = process.env.GEMINI_MODEL_PRIMARY || 'gemini-2.5-flash-lite';
const GEMINI_FALLBACK = process.env.GEMINI_MODEL_FALLBACK || 'gemini-2.5-flash';

/**
 * Emit detailed, technical logs reconstructed from an ML GradingResponse.
 * Surfaces fraud preflight, each parallel analysis (OpenCV / CLIP / Rekognition /
 * Textract), the Gemini model(s) used, and the synthesized grade fields.
 */
const logMlPipelineDetail = async (itemId, ml) => {
  // --- Fraud preflight ---
  const fraud = ml.fraud || (ml.analysis_summary && ml.analysis_summary.fraud) || {};
  if (fraud && Object.keys(fraud).length > 0) {
    const cls = fraud.classification || 'UNKNOWN';
    const icon = cls === 'HARD' ? 'FRAUD_DETECTED' : cls === 'SOFT' ? 'FRAUD_DETECTED' : 'FRAUD_PASS';
    await ItemLogger.log(itemId, icon === 'FRAUD_PASS' ? 'FRAUD_PASS' : 'FRAUD_RESULT',
      cls === 'CLEAN'
        ? '✅ Fraud preflight CLEAN — no signals'
        : `🛡️ Fraud preflight ${cls}${fraud.triggering_signal ? ` — ${fraud.triggering_signal}` : ''}`,
      {
        classification: cls,
        triggering_signal: fraud.triggering_signal,
        phash_match: fraud.phash_match,
        exif_has_camera_data: fraud.exif_has_camera_data,
        rekognition_web_match: fraud.rekognition_web_match,
        notes: fraud.notes,
      }
    );
  }

  const summary = ml.analysis_summary || {};
  const analyses = summary.analyses || {};

  // --- OpenCV color/histogram ---
  if (analyses.opencv_color) {
    const a = analyses.opencv_color;
    await ItemLogger.log(itemId, 'ANALYSIS_OPENCV',
      a.available
        ? `🎨 OpenCV color/histogram delta: ${a.color_histogram_delta}`
        : `🎨 OpenCV skipped (${a.reason || 'unavailable'})`,
      a
    );
  }

  // --- CLIP visual similarity ---
  if (analyses.clip_similarity) {
    const a = analyses.clip_similarity;
    const sim = a.similarity ?? a.max_similarity ?? a.score;
    await ItemLogger.log(itemId, 'ANALYSIS_CLIP',
      a.available === false
        ? `🧠 CLIP skipped (${a.reason || 'unavailable'})`
        : `🧠 CLIP visual similarity: ${sim != null ? `${(Number(sim) * 100).toFixed(1)}%` : 'n/a'}`,
      a
    );
  }

  // --- Rekognition labels ---
  if (analyses.rekognition) {
    const a = analyses.rekognition;
    const labelCount = (a.labels || []).length;
    const defectCount = (a.defect_candidates || []).length;
    const topLabels = (a.labels || []).slice(0, 5).map((l) => `${l.label}(${Math.round(l.confidence)}%)`);
    await ItemLogger.log(itemId, 'ANALYSIS_REKOGNITION',
      a.available
        ? `🏷️ Rekognition: ${labelCount} labels, ${defectCount} defect candidate(s). Top: ${topLabels.join(', ') || 'none'}`
        : `🏷️ Rekognition unavailable`,
      { labelCount, defectCount, topLabels, defect_candidates: a.defect_candidates }
    );
  }

  // --- Textract OCR ---
  if (analyses.textract) {
    const a = analyses.textract;
    const texts = a.extracted_text || [];
    await ItemLogger.log(itemId, 'ANALYSIS_TEXTRACT',
      a.available
        ? `🔤 Textract OCR: ${texts.length} line(s) extracted${texts.length ? ` — "${texts.slice(0, 3).join(' | ').slice(0, 80)}"` : ''}`
        : `🔤 Textract unavailable`,
      { lineCount: texts.length, sample: texts.slice(0, 10) }
    );
  }

  // --- Analysis warnings ---
  if (Array.isArray(summary.warnings) && summary.warnings.length > 0) {
    await ItemLogger.log(itemId, 'ANALYSIS_WARNING',
      `⚠️ Analysis warnings: ${summary.warnings.join(', ')}`,
      { warnings: summary.warnings }
    );
  }

  // --- Gemini model(s) used in Pass 2 ---
  const mv = ml.model_versions || {};
  if (mv.pass2Model || mv.pass1Model) {
    await ItemLogger.log(itemId, 'MODEL_INVOKE',
      `🤖 Gemini Pass 2 synthesized grade using ${mv.pass2Model || 'unknown model'}`,
      {
        pass1Model: mv.pass1Model,
        pass2Model: mv.pass2Model,
        rekognitionVersion: mv.rekognitionVersion,
      }
    );
  }
};

/**
 * Call the ML_Service grading pipeline.
 * @returns {Promise<object>} parsed GradingResponse
 * @throws on timeout / unreachable / non-2xx
 */

/**
 * Map an ML_Service GradingResponse (snake_case) into our Grade document shape.
 */
const mapMlResponseToGrade = (ml) => ({
  grade: ml.grade,
  qualityScore: typeof ml.quality_score === 'number' ? Math.round(ml.quality_score) : ml.quality_score,
  confidence: ml.confidence,
  defects: (ml.defects || []).map((d) => ({
    type: d.type,
    severity: d.severity,
    location: d.location || '',
    description: d.description || '',
  })),
  missingEvidence: ml.missing_evidence || [],
  returnClaimVerified: !!ml.return_claim_verified,
  estimatedResalePct: typeof ml.estimated_resale_pct === 'number' ? ml.estimated_resale_pct : 0,
  routingHint: ml.routing_hint,
  rationale: ml.rationale,
  modelVersions: ml.model_versions || {},
});

/**
 * Basic shape check that the ML response matches the GradingResponse contract (Req 14.4).
 */
const isValidMlResponse = (ml) => {
  if (!ml || typeof ml !== 'object') return false;
  const grades = ['A', 'B', 'C', 'D'];
  const confidences = ['high', 'medium', 'low'];
  const routes = ['resell', 'refurbish', 'donate', 'liquidate'];
  return (
    grades.includes(ml.grade) &&
    confidences.includes(ml.confidence) &&
    routes.includes(ml.routing_hint) &&
    typeof ml.rationale === 'string'
  );
};

/**
 * Build a fallback grade when the ML service is unreachable or returns garbage.
 * The item still completes the flow — it's flagged for human review with full
 * context so no work is lost.
 *
 * @param {object} payload - the grading payload (itemId, imageUrls, reason, category)
 * @param {string} failureReason - plain-English explanation of what failed
 */
const buildFallbackGrade = (payload, failureReason) => ({
  grade: 'C',
  quality_score: 50,
  confidence: 'low',
  defects: [],
  missing_evidence: ['AI grading unavailable — manual review required'],
  return_claim_verified: false,
  estimated_resale_pct: 0.3,
  routing_hint: 'refurbish',
  rationale: `Automated grading could not complete. Reason: ${failureReason}. ` +
    `This item has been flagged for human review. Evidence photos are preserved for manual inspection.`,
  model_versions: { fallback: 'manual-review-required' },
  analysis_summary: { fallback: true, failureReason },
  form_schema: {},
  prompts: {},
  fraud: {},
  status: 'ok',
});

/**
 * Resolve the prompt overlays for a grading call (v2.34): admin base + admin category
 * (DB-editable, with file/default fallback) + the seller's per-product instructions.
 * Never throws — returns whatever resolves, so a prompt-store hiccup can't break grading.
 */
const _resolvePrompts = async (category, sellerPrompt) => {
  const out = { base_prompt: undefined, category_prompt: undefined, seller_prompt: sellerPrompt || undefined };
  try {
    out.base_prompt = await promptService.getBasePrompt();
    const cat = await promptService.getCategoryPrompt(category);
    if (cat) out.category_prompt = cat;
  } catch (err) {
    console.warn(`[grading] prompt resolution failed (using ML defaults): ${err.message}`);
  }
  return out;
};

/**
 * Call the ML_Service grading pipeline. Returns { data, ms } where ms is the
 * round-trip latency. Throws on timeout / unreachable / non-2xx.
 */
const callMlGrade = async (payload) => {
  const prompts = await _resolvePrompts(payload.category, payload.sellerPrompt);
  const body = {
    item_id: payload.itemId,
    photos: payload.imageUrls,
    category: payload.category,
    return_claim_description: payload.reason,
    original_product_id: payload.productId,
    listing_image_urls: payload.listingImageUrls || [],
    catalog_hashes: payload.catalogHashes || [],
    field_images: payload.fieldImages || {},
    fragments: payload.fragments || [],
    base_prompt: prompts.base_prompt,
    category_prompt: prompts.category_prompt,
    seller_prompt: prompts.seller_prompt,
  };

  const startedAt = Date.now();
  const resp = await axios.post(ML_GRADE_ENDPOINT, body, {
    timeout: ML_TIMEOUT_MS,
    validateStatus: (s) => s >= 200 && s < 300,
  });
  return { data: resp.data, ms: Date.now() - startedAt };
};

/**
 * Persist a Grade + Evidence_Bundle and compute review/lifecycle state.
 * Replaces any existing grade for the same itemId (Req 8.6) — upsert.
 */
const persistGrade = async ({ payload, ml }) => {
  const mapped = mapMlResponseToGrade(ml);

  // Human-review escalation (Req 9.1 / 9.2).
  const flaggedForReview = mapped.confidence === 'low' || (mapped.missingEvidence || []).length > 0;
  let reviewReason = '';
  if (flaggedForReview) {
    reviewReason = mapped.confidence === 'low' ? 'low_confidence' : 'missing_evidence';
  }

  const doc = {
    itemId: payload.itemId,
    userId: mongoose.isValidObjectId(payload.userId) ? payload.userId : undefined,
    productId: mongoose.isValidObjectId(payload.productId) ? payload.productId : undefined,
    intakePath: payload.intakePath,
    ...mapped,
    evidenceBundle: {
      prompts: {
        pass1: (ml.prompts && ml.prompts.pass1) || '',
        pass2: (ml.prompts && ml.prompts.pass2) || '',
      },
      imageUrls: payload.imageUrls,
      analysisSummary: ml.analysis_summary || {},
      formSchema: ml.form_schema || {},
      fraud: ml.fraud || {},
    },
    flaggedForReview,
    reviewReason,
    lifecycleEmission: 'pending',
    status: ml.status === 'fraud_rejected' ? 'fraud_rejected' : 'ok',
  };

  // Upsert keyed by itemId so exactly one grade exists per item (Req 8.1 / 8.6).
  const saved = await Grade.findOneAndUpdate(
    { itemId: payload.itemId },
    { $set: doc },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );

  return saved;
};

/**
 * Trigger AI grading for an item.
 *
 * Service_Call_Contract (Phase 1 → Phase 2):
 *   triggerGrading(itemId, { evidencePhotos, category, originalProductId })
 *
 * Also accepts the full Grading_Request_Contract via the REST controller, which
 * passes a normalized payload object as the second argument.
 *
 * @param {string} itemId
 * @param {object} options
 * @returns {Promise<object>} the persisted Grade document
 */
const triggerGrading = async (itemId, options = {}) => {
  // Normalize both calling conventions into one payload.
  const productId = options.originalProductId || options.productId;
  const payload = {
    itemId,
    userId: options.userId,
    productId,
    reason: options.reason || options.returnClaimDescription || 'used item submission',
    imageUrls: options.evidencePhotos || options.imageUrls || [],
    fieldImages: options.fieldImages || {},
    intakePath: options.intakePath || 'sell-used',
    category: options.category,
    listingImageUrls: options.listingImageUrls || [],
    catalogHashes: options.catalogHashes || [],
  };

  // Backfill listing reference photos + the seller's per-product grading instructions
  // from the catalog. attachEvidence only passes originalProductId, so we resolve the
  // product's catalog images (visual reference) and gradingInstructions (seller prompt)
  // here.
  if (payload.productId && mongoose.Types.ObjectId.isValid(payload.productId)) {
    try {
      const Product = require('../products/product.model');
      const product = await Product.findById(payload.productId)
        .select('images gradingInstructions').lean();
      if (product) {
        if (payload.listingImageUrls.length === 0 &&
            Array.isArray(product.images) && product.images.length > 0) {
          payload.listingImageUrls = product.images;
          await ItemLogger.log(itemId, 'ANALYSIS_REFERENCE',
            `🖼️ Loaded ${product.images.length} listing reference photo(s) from the catalog ` +
            `for visual comparison.`,
            { phase: 'request', level: 'info', referenceCount: product.images.length,
              productId: String(payload.productId) }
          );
        }
        if (product.gradingInstructions && product.gradingInstructions.trim()) {
          payload.sellerPrompt = product.gradingInstructions.trim();
        }
      }
    } catch (err) {
      await ItemLogger.log(itemId, 'ANALYSIS_REFERENCE',
        `⚠️ Could not load catalog reference photos — ${err.message || err}`,
        { phase: 'request', level: 'warn', productId: String(payload.productId) }
      );
    }
  }

  // --- Gather stored Evidence Inspector fragments (v2.34) ---
  // These were written at upload time. Pass 2 synthesizes from them (no raw-image
  // re-analysis). If none exist (legacy/standalone path), the ML service inspects
  // the flat photo list inline so the contract still works.
  if ((!payload.fragments || payload.fragments.length === 0) &&
      mongoose.isValidObjectId(itemId)) {
    try {
      const item = await Item.findById(itemId).select('evidenceFragments').lean();
      const stored = (item && item.evidenceFragments) || [];
      payload.fragments = stored
        .filter((f) => f.accepted !== false)
        .map((f) => ({
          field_id: f.fieldId,
          field_label: f.fieldLabel,
          // v2.34 single-photo shape
          image_url: f.imageUrl,
          // v2.35 multi-photo shape (only present on field-level fragments)
          image_urls: Array.isArray(f.imageUrls) ? f.imageUrls : undefined,
          per_photo: Array.isArray(f.perPhoto) ? f.perPhoto : undefined,
          missing_views: Array.isArray(f.missingViews) ? f.missingViews : undefined,
          ocr_text_per_photo: f.ocrTextPerPhoto || undefined,
          preflight_per_photo: f.preflightPerPhoto || undefined,
          // Common evidence fields
          clarity: f.clarity,
          subject_match: f.subjectMatch,
          identity_match: f.identityMatch,
          observations: f.observations || [],
          ocr_text: f.ocrText,
          condition_signals: f.conditionSignals || [],
          preflight: f.preflight || {},
          inspector_status: f.inspectorStatus,
        }));
      if (payload.fragments.length > 0) {
        await ItemLogger.log(itemId, 'GRADING_REQUEST',
          `🧩 Loaded ${payload.fragments.length} pre-computed evidence fragment(s) for synthesis.`,
          { phase: 'request', fragmentCount: payload.fragments.length });
      }
    } catch (err) {
      console.warn(`[grading] could not load fragments for ${itemId}: ${err.message}`);
    }
  }

  // --- Log the outgoing request (Req 1.4, 14) ---
  await ItemLogger.log(itemId, 'GRADING_REQUEST',
    `📡 POST ${ML_GRADE_ENDPOINT} — ${payload.imageUrls.length} evidence photo(s), ` +
    `${payload.listingImageUrls.length} listing reference photo(s)`,
    {
      endpoint: ML_GRADE_ENDPOINT,
      timeout_ms: ML_TIMEOUT_MS,
      category: payload.category || '(none)',
      reason: payload.reason,
      evidencePhotoCount: payload.imageUrls.length,
      listingReferenceCount: payload.listingImageUrls.length,
      hasCatalogHashes: payload.catalogHashes.length > 0,
      expectedPrimaryModel: GEMINI_PRIMARY,
      expectedFallbackModel: GEMINI_FALLBACK,
    }
  );

  if (payload.listingImageUrls.length === 0) {
    await ItemLogger.log(itemId, 'ANALYSIS_WARNING',
      '⚠️ No listing reference photos available for this product — visual comparison ' +
      '(OpenCV color delta, CLIP similarity) will be skipped. Grading proceeds on evidence photos alone.',
      { phase: 'request', level: 'warn', reason: 'no_reference_images' }
    );
  }

  // --- Call ML service ---
  let ml;
  let usedFallback = false;
  let ingestedTrace = false;

  try {
    await ItemLogger.log(itemId, 'FRAUD_CHECK',
      '🛡️ ML pipeline started: fraud preflight → parallel analysis → Gemini Pass 2...',
      { phase: 'request' });
    const { data, ms } = await callMlGrade(payload);
    ml = data;

    // Replay the ML service's internal step-by-step trace into the dev-log stream
    // BEFORE validation, so even a degraded/invalid response surfaces its detail.
    if (Array.isArray(ml.trace) && ml.trace.length > 0) {
      await ItemLogger.ingestTrace(itemId, ml.trace, { source: 'ml' });
      ingestedTrace = true;
    }

    await ItemLogger.log(itemId, 'GRADING_REQUEST',
      `📡 ML service responded in ${ms}ms (HTTP 200, status="${ml.status}")`,
      { phase: 'request', level: ml.status === 'ok' ? 'success' : 'warn', durationMs: ms, latency_ms: ms, status: ml.status });
  } catch (err) {
    // Build a human-readable reason for the specific failure mode.
    let reason;
    if (err.code === 'ECONNREFUSED') {
      reason = `ML service is not running at ${ML_SERVICE_URL} (ECONNREFUSED). Start it with: cd ml-service && uvicorn app.main:app --reload --port 8000`;
    } else if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      reason = `ML service timed out after ${ML_TIMEOUT_MS / 1000}s (${err.code}). Gemini or a downstream AWS service may be slow.`;
    } else if (err.response) {
      const body = err.response.data;
      const inner = body?.detail?.error || (typeof body?.detail === 'string' ? body.detail : null) || body?.message;
      reason = `ML service returned HTTP ${err.response.status}${inner ? `: ${inner}` : `: ${JSON.stringify(body)}`}`;
    } else {
      reason = `ML service unreachable — ${err.message} (${err.code || 'no code'})`;
    }

    // The ML service attaches its full internal trace to the error detail when a
    // stage fails (e.g. Gemini PERMISSION_DENIED in Pass 2). Replay it so the REAL
    // cause is visible in the sidebar — not just "HTTP 502".
    const errTrace = err.response?.data?.detail?.trace || err.response?.data?.trace;
    if (Array.isArray(errTrace) && errTrace.length > 0) {
      await ItemLogger.ingestTrace(itemId, errTrace, { source: 'ml' });
      ingestedTrace = true;
    }

    await ItemLogger.log(itemId, 'ML_UNAVAILABLE',
      `🔌 ML pipeline did not complete. Falling back to manual-review grade. ${reason}`,
      {
        phase: 'request',
        level: 'error',
        errorCode: err.code,
        errorMessage: err.message,
        httpStatus: err.response?.status,
        responseBody: err.response?.data,
        mlServiceUrl: ML_SERVICE_URL,
      }
    );

    ml = buildFallbackGrade(payload, reason);
    usedFallback = true;
  }

  // --- Validate ML response shape (Req 14.4) ---
  if (!isValidMlResponse(ml)) {
    const detail = `grade="${ml?.grade}", confidence="${ml?.confidence}", routing_hint="${ml?.routing_hint}", has_rationale=${typeof ml?.rationale === 'string'}`;
    await ItemLogger.log(itemId, 'ML_INVALID_RESPONSE',
      `⚠️ ML response failed shape validation (${detail}). Using fallback grade.`,
      { phase: 'request', level: 'warn', received: ml }
    );
    ml = buildFallbackGrade(payload, `Invalid response shape from ML service — ${detail}`);
    usedFallback = true;
  }

  // --- Detailed per-stage logging reconstructed from the response ---
  // Only needed when the ML service did not supply a structured trace (older ML
  // build); otherwise ingestTrace already covered every internal step.
  if (!usedFallback && !ingestedTrace) {
    await logMlPipelineDetail(itemId, ml);
  }

  // --- Persist grade + evidence bundle (Req 8) ---
  await ItemLogger.log(itemId, 'PERSIST_GRADE',
    `💾 Persisting grade to MongoDB (grade=${ml.grade}, score=${Math.round(ml.quality_score)}, ` +
    `confidence=${ml.confidence}, routing=${ml.routing_hint})`,
    {
      phase: 'persist',
      grade: ml.grade,
      qualityScore: Math.round(ml.quality_score),
      confidence: ml.confidence,
      routingHint: ml.routing_hint,
      returnClaimVerified: ml.return_claim_verified,
      estimatedResalePct: ml.estimated_resale_pct,
      defectCount: (ml.defects || []).length,
      missingEvidence: ml.missing_evidence,
      usedFallback,
    }
  );

  let saved;
  try {
    saved = await persistGrade({ payload, ml });
  } catch (err) {
    const detail = err.message || String(err);
    await ItemLogger.log(itemId, 'ERROR',
      `❌ PERSIST_GRADE: Failed to save grade to MongoDB — ${detail}`,
      { error: err.stack, itemId }
    );
    const e = new Error(`Failed to persist grade: ${detail}`);
    e.statusCode = 500;
    e.cause = err;
    throw e;
  }

  // --- Lifecycle emission (Req 10) ---
  // Emit GRADED only when not flagged and not a fraud rejection.
  if (!saved.flaggedForReview && saved.status === 'ok') {
    const emission = await emitGraded(String(saved.itemId), {
      gradeId: String(saved._id),
      grade: saved.grade,
      confidence: saved.confidence,
      routingHint: saved.routingHint,
    });
    if (emission.status !== saved.lifecycleEmission) {
      saved.lifecycleEmission = emission.status;
      await saved.save();
    }
    await ItemLogger.log(itemId, 'LIFECYCLE_EMIT',
      `⛓️ Lifecycle GRADED emission: ${emission.status}${emission.reason ? ` (${emission.reason})` : ''}`,
      { emission });
  } else {
    // Flagged grades withhold auto-routing; emission stays pending (skipped path).
    saved.lifecycleEmission = 'skipped';
    await saved.save();
    await ItemLogger.log(itemId, 'LIFECYCLE_EMIT',
      `⛓️ Lifecycle auto-emit skipped — grade ${saved.status === 'fraud_rejected' ? 'fraud-rejected' : 'flagged for human review'} (${saved.reviewReason || saved.status})`,
      { flaggedForReview: saved.flaggedForReview, reviewReason: saved.reviewReason, status: saved.status });
  }

  return saved;
};

const getGradeByItemId = async (itemId) => {
  if (!mongoose.isValidObjectId(itemId)) return null;
  return Grade.findOne({ itemId }).lean();
};

const getGradeById = async (gradeId) => {
  if (!mongoose.isValidObjectId(gradeId)) return null;
  return Grade.findById(gradeId).lean();
};

/**
 * Flagged-grade query for the seller/admin dashboard (Req 9.4).
 * Admin sees all flagged grades; a seller sees only grades they own (by userId).
 */
const getFlaggedGrades = async ({ role, userId }) => {
  const query = { flaggedForReview: true };
  if (role !== 'admin') {
    query.userId = userId;
  }
  return Grade.find(query).sort({ createdAt: -1 }).lean();
};

// --- Progressive / dynamic form rendering (v3.44, Requirement 4) ---
//
// Source of truth is the Item document's `evidenceForm` sub-doc (survives restart
// and multiple instances). The in-memory map is only a fast cache so polling reads
// don't hit Mongo every 1.5s. The generic fallback schema is sourced from the ML
// service's response (status=generic_default) — no duplicated copy lives here
// anymore (improvement #6).

const Item = require('../items/item.model');

// In-memory readiness cache: itemId -> { status, schema, source, schemaVersion }.
const _formState = new Map();

/**
 * Minimal generic schema used ONLY if the ML service is unreachable before it can
 * even return its own generic_default (network down at form time). Kept tiny and
 * marked so it is visibly a last-resort, not the canonical generic form.
 */
const LAST_RESORT_FORM = {
  title: 'Item Condition Evidence',
  fields: [
    { id: 'front_photo', label: 'Front view', type: 'photo', required: true,
      guidance: 'Clear, well-lit photo of the front of the item.',
      expected_subject: 'the front of the item' },
    { id: 'back_photo', label: 'Back view', type: 'photo', required: true,
      guidance: 'Clear photo of the back of the item.',
      expected_subject: 'the back of the item' },
    { id: 'defect_photo', label: 'Close-up of any damage', type: 'photo', required: false,
      guidance: 'Close-up of any defect, wear, or damage.',
      expected_subject: 'a close-up of damage or wear' },
    { id: 'condition_notes', label: 'Condition notes', type: 'text', required: false,
      guidance: 'Describe the condition or reason in your own words.' },
  ],
  photo_guidance: ['Use good lighting and a plain background.', 'Hold the camera steady to avoid blur.'],
  schemaVersion: 0,
  generated: false,
};

/**
 * Persist the resolved form to the Item so it is the durable source of truth.
 * Never throws — a persistence failure must not break the (already-served) form.
 */
const _persistFormToItem = async (itemId, { status, schema, source }) => {
  try {
    if (!mongoose.isValidObjectId(itemId)) return;
    await Item.findByIdAndUpdate(itemId, {
      $set: {
        'evidenceForm.status': status,
        'evidenceForm.schema': schema || null,
        'evidenceForm.schemaVersion': (schema && schema.schemaVersion) || null,
        'evidenceForm.source': source || null,
        'evidenceForm.provider': 'gemini',
        'evidenceForm.generatedAt': new Date(),
      },
    });
  } catch (err) {
    console.warn(`[grading] could not persist form to item ${itemId}: ${err.message}`);
  }
};

/**
 * Kick off Pass 1 form generation for an item (fire-and-forget).
 * Stores readiness state (cache + Item) so the frontend can poll getForm.
 */
const startFormGeneration = async (itemId, { productId, reason, category, initialPhotos }) => {
  _formState.set(itemId, { status: 'pending', schema: null });

  // Load the catalog product so Pass 1 can tailor the form to THIS specific product
  // — its real title/brand/description AND its catalog photos (what it looks like
  // new) — instead of generic category-level reasoning. Without this the LLM only
  // ever saw `Product listing data: {}` and 0 images.
  let listingData = {};
  let listingImageUrls = [];
  let sellerPrompt;
  if (productId && mongoose.Types.ObjectId.isValid(productId)) {
    try {
      const Product = require('../products/product.model');
      const product = await Product.findById(productId)
        .select('title description category brandName condition price images gradingInstructions imageHints')
        .lean();
      if (product) {
        listingData = {
          title: product.title,
          description: product.description,
          category: product.category,
          brandName: product.brandName,
          condition: product.condition,
          price: product.price,
        };
        listingImageUrls = Array.isArray(product.images) ? product.images.slice(0, 4) : [];
        if (product.gradingInstructions && product.gradingInstructions.trim()) {
          sellerPrompt = product.gradingInstructions.trim();
        }
        // Pass seller-defined per-image hints to Pass-1 so it generates dedicated fields.
        if (Array.isArray(product.imageHints) && product.imageHints.length > 0) {
          listingData.imageHints = product.imageHints;
        }
      }
    } catch (err) {
      console.warn(`[grading] could not load product ${productId} for Pass 1: ${err.message}`);
    }
  }

  const prompts = await _resolvePrompts(category, sellerPrompt);

  await ItemLogger.log(itemId, 'PASS1_START',
    `📝 Pass 1 form generation requested (category=${category || 'unknown'}, ` +
    `${(initialPhotos || []).length} clarifying photo(s), ` +
    `${listingImageUrls.length} catalog reference photo(s), ` +
    `listing data ${Object.keys(listingData).length ? 'loaded' : 'unavailable'})`,
    { phase: 'pass1', endpoint: `${ML_SERVICE_URL}/grade/form`,
      catalogReferenceCount: listingImageUrls.length,
      hasListingData: Object.keys(listingData).length > 0 });
  try {
    const startedAt = Date.now();
    const resp = await axios.post(`${ML_SERVICE_URL}/grade/form`, {
      product_id: productId,
      reason,
      category,
      initial_photos: initialPhotos || [],
      listing_image_urls: listingImageUrls,
      listing_data: listingData,
      image_hints: listingData.imageHints || [],
      base_prompt: prompts.base_prompt,
      category_prompt: prompts.category_prompt,
      seller_prompt: prompts.seller_prompt,
    }, { timeout: ML_TIMEOUT_MS });
    const ms = Date.now() - startedAt;

    // Replay the ML service's Pass 1 internal trace (image fetches, Gemini call).
    if (Array.isArray(resp.data?.trace) && resp.data.trace.length > 0) {
      await ItemLogger.ingestTrace(itemId, resp.data.trace, { source: 'ml' });
    }

    const schema = resp.data.schema || resp.data.form_schema || resp.data;
    const mlStatus = resp.data?.status || 'ready';
    const fieldCount = Array.isArray(schema?.fields) ? schema.fields.length : 0;
    // A generated/cached schema is 'ready'; a generic_default is 'fallback'.
    const readiness = mlStatus === 'generic_default' || mlStatus === 'cache_degraded' ? 'fallback' : 'ready';
    _formState.set(itemId, { status: readiness, schema, source: mlStatus });
    await _persistFormToItem(itemId, { status: readiness, schema, source: mlStatus });
    await ItemLogger.log(itemId, 'PASS1_COMPLETE',
      `✅ Pass 1 form ready in ${ms}ms (status=${mlStatus}, ${fieldCount} field(s))`,
      { phase: 'pass1', level: 'success', durationMs: ms, status: mlStatus, fieldCount });
  } catch (err) {
    // Pass 1 failed irrecoverably -> serve last-resort default as ready (Req 4.5).
    const errTrace = err.response?.data?.detail?.trace || err.response?.data?.trace;
    if (Array.isArray(errTrace) && errTrace.length > 0) {
      await ItemLogger.ingestTrace(itemId, errTrace, { source: 'ml' });
    }
    _formState.set(itemId, { status: 'fallback', schema: LAST_RESORT_FORM, source: 'last_resort' });
    await _persistFormToItem(itemId, { status: 'fallback', schema: LAST_RESORT_FORM, source: 'last_resort' });
    await ItemLogger.log(itemId, 'PASS1_FALLBACK',
      `⚠️ Pass 1 form generation failed (${err.code || err.response?.status || err.message}). ` +
      'Serving the generic default form so the user is never blocked.',
      { phase: 'pass1', level: 'warn', errorMessage: err.message, httpStatus: err.response?.status });
  }
};

/**
 * Return the current form for an item.
 * Reads the in-memory cache first; falls back to the persisted Item form so the
 * schema survives restarts (improvement #4). Before Pass 1 completes -> last-resort
 * generic + status 'pending'.
 */
const getForm = async (itemId) => {
  // Fast path: in-memory cache.
  const state = _formState.get(itemId);
  if (state && state.status !== 'pending') {
    return { readiness: state.status, schema: state.schema || LAST_RESORT_FORM, source: state.source };
  }

  // Durable path: read from the Item (survives restarts / other instances).
  try {
    if (mongoose.isValidObjectId(itemId)) {
      const item = await Item.findById(itemId).select('evidenceForm').lean();
      const ef = item && item.evidenceForm;
      if (ef && ef.status && ef.status !== 'none' && ef.status !== 'pending' && ef.schema) {
        // Warm the cache for subsequent polls.
        _formState.set(itemId, { status: ef.status, schema: ef.schema, source: ef.source });
        return { readiness: ef.status, schema: ef.schema, source: ef.source };
      }
      if (ef && ef.status === 'pending') {
        return { readiness: 'pending', schema: LAST_RESORT_FORM };
      }
    }
  } catch (err) {
    console.warn(`[grading] getForm read failed for ${itemId}: ${err.message}`);
  }

  return { readiness: (state && state.status) || 'pending', schema: LAST_RESORT_FORM };
};

/**
 * Proxy a single-photo validation to the ML service (v3.44, improvement #2).
 * Used by the evidence form to give inline "right part? in focus?" feedback,
 * passing the form field's expected_subject through to CLIP subject match.
 *
 * Logs the start/result and replays the ML service's per-step trace (image
 * fetch, OpenCV scores, CLIP confidence) into ItemLogger so the Developer
 * Logs sidebar shows EVERY AI tool call — not just the final pass/fail badge.
 *
 * Never throws — returns a permissive result if the ML service is unreachable.
 */
const validatePhoto = async ({ photoUrl, itemId, expectedSubject }) => {
  const startedAt = Date.now();

  if (itemId) {
    await ItemLogger.log(
      itemId,
      'PHOTO_VALIDATION_START',
      `🔍 Validating photo${expectedSubject ? ` (expected: ${expectedSubject})` : ''}…`,
      { phase: 'evidence', photoUrl, expectedSubject }
    );
  }

  try {
    const resp = await axios.post(`${ML_SERVICE_URL}/vision/validate-photo`, {
      photo_url: photoUrl,
      item_id: itemId,
      expected_subject: expectedSubject || undefined,
    }, {
      // First call after a cold start pays a one-time CLIP model-load tax
      // (~10-15s on CPU). Steady-state calls are ~100ms. 30s is a safe
      // ceiling that avoids false "Looks good" badges from a premature abort.
      timeout: 30000,
    });

    // Replay the ML service's internal step-by-step trace into the dev-log
    // stream — image fetch, OpenCV scores, CLIP subject match — same shape
    // as /grade so the sidebar is uniform.
    if (itemId && Array.isArray(resp.data?.trace) && resp.data.trace.length > 0) {
      await ItemLogger.ingestTrace(itemId, resp.data.trace, { source: 'ml' });
    }

    if (itemId) {
      const issues = Array.isArray(resp.data?.issues) ? resp.data.issues : [];
      const isValid = !!resp.data?.is_valid;
      await ItemLogger.log(
        itemId,
        'PHOTO_VALIDATION_RESULT',
        isValid
          ? '✅ Photo passed all checks.'
          : `⚠️ Photo flagged: ${issues.join(', ') || 'unknown issue'}`,
        {
          phase: 'evidence',
          level: isValid ? 'success' : 'warn',
          durationMs: Date.now() - startedAt,
          isValid,
          issues,
          blurScore: resp.data?.blur_score,
          brightnessScore: resp.data?.brightness_score,
          expectedSubject,
        }
      );
    }

    // Strip the trace from the client response — the frontend doesn't render
    // it, and shipping it twice (once via socket, once via REST) is wasteful.
    const { trace: _drop, ...payload } = resp.data || {};
    return payload;
  } catch (err) {
    if (itemId) {
      // ML may attach its trace to the error detail; replay it before logging
      // the failure so the sidebar shows the exact internal cause.
      const errTrace = err.response?.data?.detail?.trace || err.response?.data?.trace;
      if (Array.isArray(errTrace) && errTrace.length > 0) {
        await ItemLogger.ingestTrace(itemId, errTrace, { source: 'ml' });
      }
      await ItemLogger.log(
        itemId,
        'PHOTO_VALIDATION_UNAVAILABLE',
        `🔌 Photo validation skipped — ML service unreachable (${err.code || err.message}). Accepting the photo.`,
        {
          phase: 'evidence',
          level: 'warn',
          durationMs: Date.now() - startedAt,
          errorCode: err.code,
          errorMessage: err.message,
          httpStatus: err.response?.status,
        }
      );
    }
    // Don't block the user on a validation outage — treat as "couldn't check".
    return {
      photo_url: photoUrl,
      is_valid: true,
      issues: [],
      validation_unavailable: true,
      reason: err.code || err.message,
    };
  }
};

/**
 * Load catalog context for a product: listing_data + reference images. When the
 * product's images are angle-tagged, return the reference image(s) matching the
 * requested angle so the per-upload phash is a same-angle duplicate check; else
 * return all catalog images. (Seller angle-tagging is additive — falls back cleanly.)
 */
const _loadCatalogContext = async (productId, angle) => {
  const ctx = { listingData: {}, catalogImageUrls: [], sellerPrompt: undefined };
  if (!productId || !mongoose.Types.ObjectId.isValid(productId)) return ctx;
  try {
    const Product = require('../products/product.model');
    const product = await Product.findById(productId)
      .select('title description category brandName condition price images imageAngles gradingInstructions')
      .lean();
    if (!product) return ctx;
    ctx.listingData = {
      title: product.title,
      description: product.description,
      category: product.category,
      brandName: product.brandName,
      condition: product.condition,
      price: product.price,
    };
    if (product.gradingInstructions && product.gradingInstructions.trim()) {
      ctx.sellerPrompt = product.gradingInstructions.trim();
    }
    const allImages = Array.isArray(product.images) ? product.images : [];
    // imageAngles (optional): { front: url, side_left: url, ... } set by the seller.
    const angles = product.imageAngles && typeof product.imageAngles === 'object'
      ? product.imageAngles : null;
    if (angle && angles && angles[angle]) {
      ctx.catalogImageUrls = [angles[angle]];
    } else {
      ctx.catalogImageUrls = allImages.slice(0, 4);
    }
  } catch (err) {
    console.warn(`[grading] could not load product ${productId} for inspection: ${err.message}`);
  }
  return ctx;
};

/** Stable key for a photo independent of presigned-URL query params. */
const _imageHash = (url) => {
  try {
    return String(url).split('?', 1)[0];
  } catch (_e) {
    return String(url);
  }
};

/** Map a fieldId like "front_photo"/"side_left_photo" to a catalog angle, if any. */
const _angleFromFieldId = (fieldId) => {
  if (!fieldId) return null;
  const id = String(fieldId).toLowerCase();
  if (id.includes('front')) return 'front';
  if (id.includes('side_left') || id.includes('left')) return 'side_left';
  if (id.includes('side_right') || id.includes('right')) return 'side_right';
  if (id.includes('rear') || id.includes('back')) return 'rear';
  return null;
};

/**
 * Persist (upsert) one Evidence_Fragment onto the Item, keyed by (fieldId, imageHash)
 * so re-uploading the same field/photo supersedes the prior fragment (v2.34).
 * Never throws.
 */
const _persistFragment = async (itemId, fragment) => {
  if (!mongoose.isValidObjectId(itemId)) return;
  try {
    // Remove any prior fragment for the same (fieldId, imageHash), then push.
    await Item.updateOne(
      { _id: itemId },
      { $pull: { evidenceFragments: { fieldId: fragment.fieldId, imageHash: fragment.imageHash } } }
    );
    await Item.updateOne(
      { _id: itemId },
      { $push: { evidenceFragments: fragment } }
    );
  } catch (err) {
    console.warn(`[grading] could not persist fragment for ${itemId}: ${err.message}`);
  }
};

/**
 * Persist ONE field-level Evidence_Fragment onto the Item (v2.35), atomically
 * replacing any prior fragments for the same fieldId (whether v2.34 per-photo
 * or v2.35 field-level). The synthesizer therefore never double-counts.
 * Never throws.
 */
const _persistFieldFragment = async (itemId, fragment) => {
  if (!mongoose.isValidObjectId(itemId)) return;
  try {
    await Item.updateOne(
      { _id: itemId },
      { $pull: { evidenceFragments: { fieldId: fragment.fieldId } } }
    );
    await Item.updateOne(
      { _id: itemId },
      { $push: { evidenceFragments: fragment } }
    );
  } catch (err) {
    console.warn(`[grading] could not persist field fragment for ${itemId}: ${err.message}`);
  }
};

/**
 * Per-field batched Evidence Inspection (Pass 1.5, v2.35).
 *
 * The user clicks "Submit Field" → the frontend sends every photo URL for that
 * field. We proxy to ML /vision/inspect-field, which runs ONE multimodal LLM call
 * over the whole set and returns a single field-level decision plus per-photo
 * notes. On accept, we upsert ONE field-level Evidence_Fragment (and remove any
 * prior fragments under this fieldId). On reject, no fragment is stored — the
 * frontend keeps the photos so the user can edit and re-submit.
 *
 * Resilience: an ML/LLM outage is treated as accept-with-warning so the user is
 * never hard-blocked; the synthesizer at submit can still flag the item.
 */
const verifyField = async ({ itemId, fieldId, fieldLabel, expectedSubject,
                              validationCriteria, photoUrls, reason, category, productId }) => {
  const startedAt = Date.now();
  photoUrls = Array.isArray(photoUrls) ? photoUrls.filter(Boolean) : [];

  if (photoUrls.length === 0) {
    return {
      accepted: false,
      reupload_reason: 'Please add at least one photo before submitting this field.',
      per_photo: [],
      missing_views: [],
      observations: [],
      condition_signals: [],
      inspector_status: 'no_photos',
    };
  }

  // Backfill product/category/reason from the Item when the caller didn't supply
  // them (the inspector needs catalog context for identity_match).
  if (itemId && mongoose.isValidObjectId(itemId) && (!productId || !category || !reason)) {
    try {
      const item = await Item.findById(itemId)
        .select('originalProductId category reasonText description')
        .lean();
      if (item) {
        productId = productId || (item.originalProductId ? String(item.originalProductId) : undefined);
        category = category || item.category;
        reason = reason || item.reasonText || item.description;
      }
    } catch (err) {
      console.warn(`[grading] verifyField could not load item ${itemId}: ${err.message}`);
    }
  }

  if (itemId) {
    await ItemLogger.log(itemId, 'FIELD_INSPECT_START',
      `🔎 Submitting field "${fieldId || 'unknown'}" for AI verification — ${photoUrls.length} photo(s)`,
      { phase: 'inspect', fieldId, expectedSubject, photoCount: photoUrls.length });
  }

  const angle = _angleFromFieldId(fieldId);
  const { listingData, catalogImageUrls, sellerPrompt } = await _loadCatalogContext(productId, angle);
  const prompts = await _resolvePrompts(category, sellerPrompt);

  try {
    const resp = await axios.post(`${ML_SERVICE_URL}/vision/inspect-field`, {
      photo_urls: photoUrls,
      item_id: itemId,
      field_id: fieldId,
      field_label: fieldLabel,
      expected_subject: expectedSubject || undefined,
      validation_criteria: validationCriteria || undefined,
      reason,
      category,
      listing_data: listingData,
      catalog_image_urls: catalogImageUrls,
      base_prompt: prompts.base_prompt,
      category_prompt: prompts.category_prompt,
      seller_prompt: prompts.seller_prompt,
    }, { timeout: 60000 });

    const data = resp.data || {};

    if (itemId && Array.isArray(data.trace) && data.trace.length > 0) {
      await ItemLogger.ingestTrace(itemId, data.trace, { source: 'ml' });
    }

    if (itemId) {
      const missing = (data.missing_views || []).join(', ');
      await ItemLogger.log(itemId, 'FIELD_INSPECT_RESULT',
        data.accepted
          ? `✅ Field "${fieldId}" accepted (${photoUrls.length} photo(s))`
          : `⚠️ Field "${fieldId}" needs re-upload: ${data.reupload_reason || 'unusable'}`
            + (missing ? ` (missing: ${missing})` : ''),
        { phase: 'inspect', level: data.accepted ? 'success' : 'warn',
          durationMs: Date.now() - startedAt, accepted: data.accepted,
          missingViews: data.missing_views || [],
          inspectorStatus: data.inspector_status });
    }

    // Persist a field-level fragment ONLY for accepted fields. On reject we keep
    // the photos in the UI and let the user edit; the prior verification (if any)
    // for this fieldId is dropped so the synthesizer doesn't see a stale accept.
    if (itemId) {
      if (data.accepted) {
        await _persistFieldFragment(itemId, {
          fieldId: fieldId || null,
          fieldLabel: fieldLabel || null,
          imageUrls: photoUrls,
          perPhoto: data.per_photo || [],
          missingViews: data.missing_views || [],
          ocrTextPerPhoto: data.ocr_text_per_photo || {},
          preflightPerPhoto: data.preflight_per_photo || {},
          accepted: true,
          reuploadReason: null,
          observations: data.observations || [],
          conditionSignals: data.condition_signals || [],
          inspectorModel: data.inspector_model || null,
          inspectorStatus: data.inspector_status || 'ok',
          createdAt: new Date(),
        });
      } else {
        // Drop any prior fragment for this fieldId so a subsequent submit-time
        // synthesis doesn't act on a stale accept.
        try {
          await Item.updateOne(
            { _id: itemId },
            { $pull: { evidenceFragments: { fieldId: fieldId || null } } }
          );
        } catch (err) {
          console.warn(`[grading] verifyField cleanup failed: ${err.message}`);
        }
      }
    }

    const { trace: _drop, ...payload } = data;
    return payload;
  } catch (err) {
    if (itemId) {
      const errTrace = err.response?.data?.detail?.trace || err.response?.data?.trace;
      if (Array.isArray(errTrace) && errTrace.length > 0) {
        await ItemLogger.ingestTrace(itemId, errTrace, { source: 'ml' });
      }
      await ItemLogger.log(itemId, 'FIELD_INSPECT_UNAVAILABLE',
        `🔌 Field verification skipped — ML service unreachable (${err.code || err.message}). Accepting the field.`,
        { phase: 'inspect', level: 'warn', durationMs: Date.now() - startedAt,
          errorCode: err.code, errorMessage: err.message, httpStatus: err.response?.status });

      // Accept-with-warning so an LLM/ML outage never blocks a user. Persist a
      // degraded fragment so the synthesizer knows this field wasn't inspected.
      await _persistFieldFragment(itemId, {
        fieldId: fieldId || null,
        fieldLabel: fieldLabel || null,
        imageUrls: photoUrls,
        perPhoto: photoUrls.map((u) => ({ image_url: u, role: null, usable: null, note: null })),
        missingViews: [],
        accepted: true,
        observations: [],
        conditionSignals: [],
        inspectorModel: null,
        inspectorStatus: 'unavailable',
        createdAt: new Date(),
      });
    }
    return {
      accepted: true,
      reupload_reason: null,
      per_photo: photoUrls.map((u) => ({ image_url: u, role: null, usable: null, note: null })),
      missing_views: [],
      observations: [],
      condition_signals: [],
      inspector_status: 'unavailable',
      reason: err.code || err.message,
    };
  }
};

/**
 * Evidence Inspector (Pass 1.5, v2.34) — inspect ONE uploaded photo against its form
 * field + the catalog product. Replaces validatePhoto's OpenCV/CLIP checks. On an
 * accepted photo, persists an Evidence_Fragment on the Item; on reject, returns the
 * re-upload reason and stores nothing usable. Never throws.
 *
 * v2.35 NOTE: this single-photo path is preserved as a back-compat shim. The
 * default flow now uses ``verifyField`` which judges a field's whole photo set
 * in one call.
 *
 * @param {object} opts { photoUrl, itemId, fieldId, fieldLabel, expectedSubject,
 *                        reason, category, productId }
 */
const inspectPhoto = async ({ photoUrl, itemId, fieldId, fieldLabel, expectedSubject,
                              validationCriteria, reason, category, productId }) => {
  const startedAt = Date.now();

  // Backfill product/category/reason from the Item when the caller didn't supply
  // them, so the inspector always has catalog context (identity check) without the
  // frontend needing to thread it.
  if (itemId && mongoose.isValidObjectId(itemId) && (!productId || !category || !reason)) {
    try {
      const item = await Item.findById(itemId)
        .select('originalProductId category reasonText description')
        .lean();
      if (item) {
        productId = productId || (item.originalProductId ? String(item.originalProductId) : undefined);
        category = category || item.category;
        reason = reason || item.reasonText || item.description;
      }
    } catch (err) {
      console.warn(`[grading] inspectPhoto could not load item ${itemId}: ${err.message}`);
    }
  }

  if (itemId) {
    await ItemLogger.log(itemId, 'PHOTO_INSPECT_START',
      `🔎 Inspecting photo for field "${fieldId || 'unknown'}"${expectedSubject ? ` (expected: ${expectedSubject})` : ''}…`,
      { phase: 'inspect', photoUrl, fieldId, expectedSubject });
  }

  const angle = _angleFromFieldId(fieldId);
  const { listingData, catalogImageUrls, sellerPrompt } = await _loadCatalogContext(productId, angle);
  const prompts = await _resolvePrompts(category, sellerPrompt);

  try {
    const resp = await axios.post(`${ML_SERVICE_URL}/vision/inspect-photo`, {
      photo_url: photoUrl,
      item_id: itemId,
      field_id: fieldId,
      field_label: fieldLabel,
      expected_subject: expectedSubject || undefined,
      validation_criteria: validationCriteria || undefined,
      reason,
      category,
      listing_data: listingData,
      catalog_image_urls: catalogImageUrls,
      base_prompt: prompts.base_prompt,
      category_prompt: prompts.category_prompt,
      seller_prompt: prompts.seller_prompt,
    }, { timeout: 45000 });

    const data = resp.data || {};

    if (itemId && Array.isArray(data.trace) && data.trace.length > 0) {
      await ItemLogger.ingestTrace(itemId, data.trace, { source: 'ml' });
    }

    if (itemId) {
      await ItemLogger.log(itemId, 'PHOTO_INSPECT_RESULT',
        data.accepted
          ? `✅ Photo accepted (clarity=${data.clarity}, identity=${data.identity_match})`
          : `⚠️ Re-upload requested: ${data.reupload_reason || 'unusable photo'}`,
        { phase: 'inspect', level: data.accepted ? 'success' : 'warn',
          durationMs: Date.now() - startedAt, accepted: data.accepted,
          clarity: data.clarity, identityMatch: data.identity_match,
          inspectorStatus: data.inspector_status });
    }

    // Persist a fragment only for accepted photos (the synthesizer reads these).
    if (data.accepted && itemId) {
      await _persistFragment(itemId, {
        fieldId: fieldId || null,
        fieldLabel: fieldLabel || null,
        imageUrl: photoUrl,
        imageHash: _imageHash(photoUrl),
        accepted: true,
        reuploadReason: null,
        clarity: data.clarity || null,
        subjectMatch: typeof data.subject_match === 'boolean' ? data.subject_match : null,
        identityMatch: data.identity_match || null,
        observations: data.observations || [],
        ocrText: data.ocr_text || null,
        conditionSignals: data.condition_signals || [],
        preflight: data.preflight || {},
        inspectorModel: data.inspector_model || null,
        inspectorStatus: data.inspector_status || null,
        createdAt: new Date(),
      });
    }

    const { trace: _drop, ...payload } = data;
    return payload;
  } catch (err) {
    if (itemId) {
      const errTrace = err.response?.data?.detail?.trace || err.response?.data?.trace;
      if (Array.isArray(errTrace) && errTrace.length > 0) {
        await ItemLogger.ingestTrace(itemId, errTrace, { source: 'ml' });
      }
      await ItemLogger.log(itemId, 'PHOTO_INSPECT_UNAVAILABLE',
        `🔌 Inspection skipped — ML service unreachable (${err.code || err.message}). Accepting the photo.`,
        { phase: 'inspect', level: 'warn', durationMs: Date.now() - startedAt,
          errorCode: err.code, errorMessage: err.message, httpStatus: err.response?.status });

      // Accept-with-warning so an LLM/ML outage never blocks intake; store a fragment
      // marked unavailable so the synthesizer knows this photo wasn't inspected.
      await _persistFragment(itemId, {
        fieldId: fieldId || null,
        fieldLabel: fieldLabel || null,
        imageUrl: photoUrl,
        imageHash: _imageHash(photoUrl),
        accepted: true,
        clarity: null,
        subjectMatch: null,
        identityMatch: 'unknown',
        observations: [],
        ocrText: null,
        conditionSignals: [],
        preflight: {},
        inspectorModel: null,
        inspectorStatus: 'unavailable',
        createdAt: new Date(),
      });
    }
    return {
      photo_url: photoUrl,
      accepted: true,
      inspector_status: 'unavailable',
      reason: err.code || err.message,
    };
  }
};

/**
 * Claim plausibility pre-check (v2.34). One cheap text-only LLM call to reject claims
 * that clearly can't pertain to this product (e.g. "fridge not cooling" on a phone)
 * BEFORE any Pass-1 / inspection / Pass-2 token spend. Fail-open: any error or an
 * unreachable ML service returns plausible=true so real users are never blocked.
 *
 * @returns {Promise<{plausible: boolean, reason: string|null, checked: boolean}>}
 */
const validateClaim = async ({ reason, category, productTitle, productId }) => {
  const text = (reason || '').trim();
  if (text.length < 6) return { plausible: true, reason: null, checked: false };

  let listingData = {};
  let title = productTitle;
  if (productId && mongoose.Types.ObjectId.isValid(productId)) {
    try {
      const Product = require('../products/product.model');
      const product = await Product.findById(productId)
        .select('title description category brandName').lean();
      if (product) {
        title = title || product.title;
        listingData = {
          title: product.title, description: product.description,
          category: product.category, brandName: product.brandName,
        };
      }
    } catch (_e) { /* ignore — pass what we have */ }
  }

  try {
    const resp = await axios.post(`${ML_SERVICE_URL}/grade/validate-claim`, {
      reason: text,
      category,
      product_title: title,
      listing_data: listingData,
    }, { timeout: 15000 });
    const d = resp.data || {};
    return {
      plausible: d.plausible !== false,
      reason: d.reason || null,
      checked: d.checked !== false,
    };
  } catch (err) {
    console.warn(`[grading] claim validation unavailable (${err.code || err.message}) — allowing claim`);
    return { plausible: true, reason: null, checked: false };
  }
};

/**
 * Health check — reports whether the ML_Service is reachable (Req 14.5).
 */
const checkMlHealth = async () => {
  try {
    const resp = await axios.get(`${ML_SERVICE_URL}/health`, { timeout: 5000 });
    return { mlServiceReachable: resp.status >= 200 && resp.status < 300, mlServiceUrl: ML_SERVICE_URL };
  } catch (_e) {
    return { mlServiceReachable: false, mlServiceUrl: ML_SERVICE_URL };
  }
};

module.exports = {
  triggerGrading,
  getGradeByItemId,
  getGradeById,
  getFlaggedGrades,
  checkMlHealth,
  startFormGeneration,
  getForm,
  validatePhoto,
  inspectPhoto,
  verifyField,
  validateClaim,
};
