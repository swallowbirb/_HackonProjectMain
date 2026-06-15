const Item = require('./item.model');
const { appendEvent } = require('../lifecycle/lifecycle.service');
const ItemLogger = require('../../utils/itemLogger');

// --- Dynamic-stepper helpers (task 9.3) -------------------------------------
// Shared, additive utilities for the submit-time required-field gate and the
// importance-based human-review routing decision. All degrade safely on legacy
// (no-aspect / flat `fields[]`) schemas so existing submit behavior is preserved.

/**
 * Temporarily hidden fields (serial/model-label) are not required for now —
 * mirrors the frontend filter so the gate doesn't block on a field the user
 * never sees.
 */
const _isHiddenField = (f) => {
  const s = `${(f && f.id) || ''} ${(f && f.label) || ''} ${(f && f.expected_subject) || ''}`.toLowerCase();
  return /serial|imei/.test(s)
    || /(brand|model)[^a-z]{0,12}label/.test(s)
    || /label[^a-z]{0,12}(serial|brand|model)/.test(s)
    || (f && f.id === 'label_photo');
};

/**
 * Flatten every field across a Form_Schema's `steps[]` (v3 aspect/step shape) and
 * any legacy top-level `fields[]`, preserving order. Returns [] for a missing or
 * non-object schema; a legacy flat schema yields exactly its `fields[]`.
 */
const _collectSchemaFields = (schema) => {
  if (!schema || typeof schema !== 'object') return [];
  const out = [];
  if (Array.isArray(schema.steps)) {
    for (const step of schema.steps) {
      if (step && Array.isArray(step.fields)) out.push(...step.fields);
    }
  }
  if (Array.isArray(schema.fields)) out.push(...schema.fields);
  return out.filter(Boolean);
};

/**
 * A field requires uploaded media when it is required, not a hidden field, and is
 * not a text-capture field (`type='text'` or `capture_mode='text'` — Req 5.3, a
 * verifiability=none/text field carries no media requirement).
 */
const _requiresMediaEvidence = (f) =>
  !!f && f.required === true && !_isHiddenField(f)
  && f.type !== 'text' && f.capture_mode !== 'text';

/**
 * True when the item has at least one uploaded photo (or selected video frame)
 * for the given field.
 */
const _fieldHasEvidence = (item, fieldImages, fieldId) => {
  const imgs = fieldImages && fieldImages[fieldId];
  if (Array.isArray(imgs) && imgs.length > 0) return true;
  const ve = item && item.videoEvidence && item.videoEvidence[fieldId];
  if (ve && Array.isArray(ve.selectedFrameUrls) && ve.selectedFrameUrls.length > 0) return true;
  return false;
};

/**
 * Resolve the photo/frame URL set the inline Verify_Action should inspect for a
 * field — uploaded photos first, else selected video frames.
 */
const _fieldEvidenceUrls = (item, fieldImages, fieldId) => {
  if (Array.isArray(fieldImages && fieldImages[fieldId]) && fieldImages[fieldId].length > 0) {
    return fieldImages[fieldId];
  }
  const ve = item && item.videoEvidence && item.videoEvidence[fieldId];
  if (ve && Array.isArray(ve.selectedFrameUrls)) return ve.selectedFrameUrls;
  return [];
};

/**
 * True when a resolved field context declares at least one `verifiability=none`
 * aspect (Pass-1 only emits these for material, non-photo-verifiable claims), so
 * the item routes to human review immediately — no two attempts required.
 */
const _hasUnverifiableAspect = (ctx) =>
  !!ctx && Array.isArray(ctx.aspects)
  && ctx.aspects.some((a) => a && a.verifiability === 'none');

// Allowed state machine transitions
const ALLOWED_TRANSITIONS = {
  INITIATED: ['AWAITING_EVIDENCE', 'EVIDENCE_PENDING', 'CANCELLED'],
  AWAITING_EVIDENCE: ['EVIDENCE_PENDING', 'CANCELLED'],
  EVIDENCE_PENDING: ['GRADING', 'CANCELLED'],
  GRADING: ['GRADED', 'REJECTED'],       // Phase 2 drives these
  GRADED: ['ROUTED'],                     // Phase 4
  ROUTED: ['IN_TRANSIT', 'DONATED'],      // Phase 4 → 8
  IN_TRANSIT: ['LISTED', 'LIQUIDATED'],   // Phase 5 / ops
  LISTED: ['SOLD', 'LIQUIDATED'],         // Phase 5
};

/**
 * Transition an item's status. Validates against allowed transitions table.
 */
const transitionStatus = async (itemId, nextStatus, actor, eventData = {}) => {
  const item = await Item.findById(itemId);
  if (!item) throw new Error('Item not found');

  const allowed = ALLOWED_TRANSITIONS[item.status] || [];
  if (!allowed.includes(nextStatus)) {
    throw new Error(`Invalid transition: ${item.status} → ${nextStatus}`);
  }

  item.status = nextStatus;
  await item.save();

  await appendEvent(itemId, nextStatus, actor, eventData);

  return item;
};

/**
 * Create a new Item with status INITIATED and write the first lifecycle event.
 */
const createItem = async (data, actor) => {
  const item = await Item.create({ ...data, status: 'INITIATED' });
  await appendEvent(item._id, 'INITIATED', actor, { intakePath: data.intakePath });

  const pathLabel = data.intakePath === 'sell-used' ? 'Sell-used listing' : 'Return';
  await ItemLogger.log(item._id, 'INITIATE', `🚀 ${pathLabel} initiated by user`, {
    intakePath: data.intakePath,
    reason: data.reasonCode,
  });
  if (data.trustTierAtSubmission) {
    await ItemLogger.log(
      item._id,
      'TRUST_COMPLETE',
      `✅ Trust tier: ${data.trustTierAtSubmission.toUpperCase()}`,
      { tier: data.trustTierAtSubmission }
    );
  }
  await ItemLogger.log(item._id, 'ITEM_CREATED', '✅ Item record created in database', {
    status: 'INITIATED',
  });

  return item;
};

/**
 * Mark an item GRADED once the grading pipeline has persisted a Grade.
 * Links the grade, transitions GRADING → GRADED, and logs the result.
 *
 * Phase 3.5 fix: previously nothing transitioned the item out of GRADING because
 * the Phase 1 health-card lifecycle writer is still a stub. This closes the loop
 * so the status page actually shows the grade.
 *
 * Idempotent — safe to call more than once for the same grade.
 */
const markGraded = async (itemId, grade) => {
  const item = await Item.findById(itemId);
  if (!item) throw new Error('Item not found');

  // Already past grading — just ensure the grade link is set.
  if (item.status === 'GRADED' || ['ROUTED', 'IN_TRANSIT', 'LISTED', 'SOLD', 'DONATED', 'LIQUIDATED'].includes(item.status)) {
    if (!item.gradeId && grade?._id) {
      item.gradeId = grade._id;
      await item.save();
    }
    return item;
  }

  if (grade?._id) item.gradeId = grade._id;

  // Drive the state machine forward. From GRADING the only forward states are
  // GRADED / REJECTED. Fraud rejections go to REJECTED, everything else to GRADED.
  const isRejected = grade?.status === 'fraud_rejected';
  item.status = isRejected ? 'REJECTED' : 'GRADED';
  await item.save();

  const eventType = isRejected ? 'REJECTED' : 'GRADED';
  await appendEvent(itemId, eventType, { userId: null, role: 'system' }, {
    gradeId: grade?._id ? String(grade._id) : null,
    grade: grade?.grade,
    confidence: grade?.confidence,
  });

  if (isRejected) {
    await ItemLogger.log(itemId, 'GRADE_REJECTED', '🚫 Item rejected by fraud checks', {
      reviewReason: grade?.reviewReason,
    });
    await ItemLogger.log(itemId, 'STATUS_UPDATE', '📊 Status changed to REJECTED');
  } else {
    const verified = grade?.returnClaimVerified ? 'Claim verified ✓' : 'Claim not verified ✗';
    const defectSummary = (grade?.defects || []).length
      ? (grade.defects || []).map((d) => `${d.severity} ${d.type}`).join(', ')
      : 'none';
    await ItemLogger.log(
      itemId,
      'GRADE_ASSIGNED',
      `🎯 Grade ${grade?.grade} assigned (${grade?.qualityScore}/100, confidence: ${grade?.confidence}). ` +
        `${verified}. Routing hint: ${grade?.routingHint}. Defects: ${defectSummary}`,
      {
        grade: grade?.grade,
        qualityScore: grade?.qualityScore,
        confidence: grade?.confidence,
        routingHint: grade?.routingHint,
        returnClaimVerified: grade?.returnClaimVerified,
        estimatedResalePct: grade?.estimatedResalePct,
        defects: grade?.defects,
        missingEvidence: grade?.missingEvidence,
        gradeId: grade?._id ? String(grade._id) : null,
      }
    );
    await ItemLogger.log(itemId, 'STATUS_UPDATE', '📊 Item status changed: GRADING → GRADED', { phase: 'complete', level: 'success' });
    if (grade?.flaggedForReview) {
      await ItemLogger.log(
        itemId,
        'REVIEW_FLAGGED',
        `⚠️ Flagged for human review (${grade?.reviewReason || 'see grade'})`,
        { reviewReason: grade?.reviewReason }
      );
    }
    await ItemLogger.log(itemId, 'FLOW_COMPLETE', '✨ Grading complete. Ready for routing.');
  }

  return item;
};

/**
 * Attach evidence photos and transition → EVIDENCE_PENDING → GRADING.
 * Fire-and-forgets gradingService.triggerGrading — never throws on grading failure.
 *
 * v3.44: accepts an optional field→image mapping from the dynamic Pass-1 form.
 * When the item has a persisted AI form, required photo fields are gated before
 * grading (improvement #7). `photos` may be a flat array (back-compat) OR the
 * caller may pass `fieldImages` = { fieldId: [url,...] }.
 *
 * @param {string} itemId
 * @param {string[]} photos    flat union of all evidence photo URLs
 * @param {object} actor
 * @param {object} [opts]      { fieldImages }
 */
const attachEvidence = async (itemId, photos, actor, opts = {}) => {
  const item = await Item.findById(itemId);
  if (!item) throw new Error('Item not found');

  // Allow re-submission if item got stuck mid-transition (e.g. after a previous failed request)
  const attachableStatuses = ['INITIATED', 'AWAITING_EVIDENCE', 'EVIDENCE_PENDING'];
  if (!attachableStatuses.includes(item.status)) {
    throw new Error(`Cannot attach evidence when item is in status: ${item.status}`);
  }
  if (!photos || photos.length === 0) {
    throw new Error('At least one photo is required');
  }

  const fieldImages = opts.fieldImages && typeof opts.fieldImages === 'object'
    ? opts.fieldImages : null;
  const additionalNotes = opts.additionalNotes && opts.additionalNotes.trim()
    ? opts.additionalNotes.trim() : null;

  // --- Required-field gate + human-review routing (task 9.3) ---
  // Works for both the v3 aspect/step schema and legacy flat `fields[]`. The new
  // aspect-driven routing only fires for schemas that actually declare aspects;
  // legacy schemas keep the original required-field behavior unchanged.
  const formSchema = item.evidenceForm && item.evidenceForm.schema;
  if (fieldImages && formSchema) {
    const gradingService = require('../grading/grading.service');
    const allFields = _collectSchemaFields(formSchema);
    const mediaFields = allFields.filter(_requiresMediaEvidence);

    // Log the submit-gate context so devs can see exactly what schema is being
    // evaluated — schema version, step structure, field verifiability breakdown.
    const steps = Array.isArray(formSchema.steps) ? formSchema.steps : [];
    const unverifiableFields = allFields.filter((f) =>
      Array.isArray(f.aspects) && f.aspects.some((a) => a.verifiability === 'none')
    );
    await ItemLogger.log(itemId, 'SUBMIT_GATE',
      `🚦 Submit gate — evaluating ${mediaFields.length} required media field(s)` +
      (steps.length > 1
        ? ` across ${steps.length} steps (${steps.map((s) => `"${s.title || s.id}"`).join(' → ')})`
        : ' (single-step form)') +
      (unverifiableFields.length
        ? `\n⚠️  ${unverifiableFields.length} field(s) have verifiability=none aspects — will route to human review if present: ${unverifiableFields.map((f) => f.label || f.id).join(', ')}`
        : '') +
      `\nSchema v${formSchema.schemaVersion || '?'} | source: ${item.evidenceForm && item.evidenceForm.source || 'unknown'}`,
      {
        phase: 'evidence',
        schemaVersion: formSchema.schemaVersion,
        schemaSource: item.evidenceForm && item.evidenceForm.source,
        stepCount: steps.length,
        mediaFieldCount: mediaFields.length,
        allFieldCount: allFields.length,
        unverifiableFieldCount: unverifiableFields.length,
        steps: steps.map((s) => ({ id: s.id, title: s.title, fieldCount: (s.fields || []).length })),
      });

    // Req 4.6 — a required field with NO evidence at all blocks submission and is
    // named in the error so the user knows exactly what is outstanding.
    const missing = mediaFields
      .filter((f) => !_fieldHasEvidence(item, fieldImages, f.id))
      .map((f) => f.label || f.id);
    if (missing.length > 0) {
      const err = new Error(`Missing required evidence: ${missing.join(', ')}`);
      err.statusCode = 400;
      err.missingFields = missing;
      await ItemLogger.log(itemId, 'EVIDENCE_INCOMPLETE',
        `⚠️ Submission blocked — ${missing.length} required field(s) missing: ${missing.join(', ')}`,
        { phase: 'evidence', level: 'warn', missing });
      throw err;
    }

    // Req 4.5 — a required field WITH uploads but no successful verification gets
    // exactly one inline Verify_Action before the two-attempt pass-through rule.
    // verifyField increments the attempt counter and may pass the field through
    // (status='unverified') on its 2nd failed attempt.
    const fieldStateBefore = (item.evidenceForm && item.evidenceForm.fieldState) || {};
    for (const f of mediaFields) {
      const st = fieldStateBefore[f.id];
      if (st && st.status === 'verified') continue; // already verified — nothing to do
      const photoUrls = _fieldEvidenceUrls(item, fieldImages, f.id);
      if (photoUrls.length === 0) continue;
      try {
        await gradingService.verifyField({
          itemId: item._id.toString(),
          fieldId: f.id,
          fieldLabel: f.label || f.id,
          expectedSubject: f.expected_subject,
          validationCriteria: f.validation_criteria
            || (Array.isArray(f.aspects) && f.aspects[0] && f.aspects[0].validation_criteria)
            || undefined,
          photoUrls,
          reason: item.reasonText || item.description || undefined,
          category: item.category,
          productId: item.originalProductId ? item.originalProductId.toString() : null,
        });
      } catch (err) {
        // Never block submit on an inline-verify failure — the field simply keeps
        // its prior state and the routing/pass-through rules still apply.
        console.warn(`[items] inline verify failed for ${itemId}/${f.id}: ${err.message}`);
      }
    }

    // Re-read the per-field bookkeeping the inline verifies just mutated. verifyField
    // writes via its own fresh document, so our in-memory `item.evidenceForm.fieldState`
    // is stale here; read a fresh lean snapshot for the routing decision.
    let fieldState = fieldStateBefore;
    try {
      const refreshed = await Item.findById(itemId).select('evidenceForm.fieldState').lean();
      fieldState = (refreshed && refreshed.evidenceForm && refreshed.evidenceForm.fieldState) || {};
    } catch (_) { /* fall back to the pre-verify snapshot */ }

    // Req 3.4 / 4.2 / 4.3 / 4.4 — importance-based human-review routing.
    const reasons = [];
    for (const f of allFields) {
      if (!f || !f.id) continue;
      const ctx = gradingService._resolveFieldFromSchema(formSchema, f.id);
      // Any material verifiability=none aspect routes immediately — no attempts.
      if (_hasUnverifiableAspect(ctx)) {
        reasons.push(`unverifiable:${f.id}`);
        continue;
      }
      // A passed-through (unverified) field whose highest aspect importance is
      // `critical` routes; `minor`/`standard` pass through silently.
      const st = fieldState[f.id];
      if (st && st.status === 'unverified' && ctx.highestImportance === 'critical') {
        reasons.push(`unverified_critical:${f.id}`);
      }
    }

    if (reasons.length > 0) {
      const uniqueReasons = Array.from(new Set(reasons));
      item.needsHumanReview = true;
      item.humanReviewReasons = uniqueReasons;
      const unverifiableList = uniqueReasons.filter((r) => r.startsWith('unverifiable:')).map((r) => r.slice(13));
      const criticalList = uniqueReasons.filter((r) => r.startsWith('unverified_critical:')).map((r) => r.slice(20));
      await ItemLogger.log(itemId, 'REVIEW_FLAGGED',
        `⚠️ Routed to human review (${uniqueReasons.length} reason(s)):` +
        (unverifiableList.length
          ? `\n  • verifiability=none claim on field(s): ${unverifiableList.join(', ')} — camera cannot confirm, needs agent review`
          : '') +
        (criticalList.length
          ? `\n  • unverified critical field(s): ${criticalList.join(', ')} — passed through after 2 failed attempts`
          : ''),
        {
          phase: 'evidence',
          level: 'warn',
          reasons: uniqueReasons,
          unverifiableFields: unverifiableList,
          unverifiedCriticalFields: criticalList,
        });
    }
  }

  // Append photos (avoid duplicates on re-submit)
  const existingUrls = new Set(item.evidencePhotos.map(String));
  const newPhotos = photos.filter((p) => !existingUrls.has(String(p)));
  if (newPhotos.length > 0) item.evidencePhotos.push(...newPhotos);

  // Persist the field→image mapping so Pass 2 can reference photos by field name.
  if (fieldImages) {
    item.evidenceFieldImages = fieldImages;
  }

  // Append additional notes (buyer's free-text) to the item's description so the
  // grading pipeline can reason over the user's own words alongside the photos.
  if (additionalNotes) {
    const existing = item.description ? item.description.trim() : '';
    item.description = existing
      ? `${existing}\n\nAdditional notes (at submission): ${additionalNotes}`
      : additionalNotes;
  }

  await ItemLogger.log(itemId, 'EVIDENCE_SUBMIT', `📤 Evidence submitted: ${photos.length} photo(s)` +
    (fieldImages ? ` across ${Object.keys(fieldImages).length} form field(s)` : ''), {
    photoCount: photos.length,
    fieldCount: fieldImages ? Object.keys(fieldImages).length : 0,
  });

  // Transition to EVIDENCE_PENDING only if not already past it
  if (item.status === 'INITIATED' || item.status === 'AWAITING_EVIDENCE') {
    item.status = 'EVIDENCE_PENDING';
    await item.save();
    await appendEvent(itemId, 'EVIDENCE_SUBMITTED', actor, { photoCount: photos.length });
    await ItemLogger.log(itemId, 'STATUS_UPDATE', '📊 Status changed to EVIDENCE_PENDING', { phase: 'evidence' });
  } else {
    // Already EVIDENCE_PENDING — just save the new photos
    await item.save();
  }

  // Transition to GRADING
  item.status = 'GRADING';
  await item.save();
  await appendEvent(itemId, 'GRADING', actor, { triggeredAt: new Date() });
  await ItemLogger.log(itemId, 'PASS2_START', '⚙️ Starting AI grading analysis...', { phase: 'request' });

  // Combine clarifying photos (from the claim step) with the submitted evidence so
  // Pass 2 reasons over everything the user provided.
  const allPhotos = Array.from(new Set([
    ...(item.clarifyingPhotos || []).map(String),
    ...item.evidencePhotos.map(String),
  ]));

  // Fire-and-forget grading pipeline (Phase 2 implements this)
  try {
    const gradingService = require('../grading/grading.service');
    gradingService
      .triggerGrading(item._id.toString(), {
        userId: item.initiatorUserId?.toString(),
        evidencePhotos: allPhotos,
        fieldImages: item.evidenceFieldImages || {},
        category: item.category,
        // Compose reason: original claim + any additional notes the buyer just submitted.
        reason: [item.reasonText, additionalNotes, item.description]
          .filter(Boolean)
          .join('\n\n') || undefined,
        intakePath: item.intakePath === 'return' ? 'returns' : 'sell-used',
        originalProductId: item.originalProductId?.toString() || null,
        // Dynamic-stepper (task 9.3): carry the submit-time human-review routing
        // decision so persistGrade flags the grade and the routing brain holds it
        // for inspection. Also persisted on the Item above.
        needsHumanReview: !!item.needsHumanReview,
        humanReviewReasons: Array.isArray(item.humanReviewReasons) ? item.humanReviewReasons : [],
      })
      .then(async (grade) => {
        // Phase 3.5: close the loop — transition the item to GRADED and link the grade.
        try {
          await markGraded(item._id.toString(), grade);
        } catch (err) {
          const detail = err.message || String(err);
          console.warn(`[items] markGraded failed for ${item._id}: ${detail}`);
          await ItemLogger.log(item._id, 'ERROR',
            `❌ MARK_GRADED: Could not transition item to GRADED — ${detail}`,
            { error: err.stack }
          );
        }
      })
      .catch(async (err) => {
        const detail = err.message || String(err);
        console.warn(`[items] gradingService.triggerGrading failed (non-blocking): ${detail}`);
        await ItemLogger.log(item._id, 'ERROR',
          `❌ GRADING: Pipeline threw an unhandled error — ${detail}`,
          { error: err.stack }
        );
      });
  } catch (err) {
    console.warn('[items] gradingService not yet implemented — skipping trigger');
  }

  return item;
};

/**
 * Kick off dynamic Pass-1 form generation for an item at the CLAIM step (v3.44).
 *
 * Called by the intake services right after the Item is created. Transitions
 * INITIATED → AWAITING_EVIDENCE and fires the (fire-and-forget) Pass-1 request so
 * the form is product- and claim-specific by the time the user reaches the
 * evidence screen.
 *
 * @param {string} itemId
 * @param {object} actor
 * @param {object} [opts] { clarifyingPhotos }
 */
const requestEvidenceForm = async (itemId, actor, opts = {}) => {
  const item = await Item.findById(itemId);
  if (!item) throw new Error('Item not found');

  // Persist any clarifying photos captured at the claim step.
  const clarifying = Array.isArray(opts.clarifyingPhotos) ? opts.clarifyingPhotos.filter(Boolean) : [];
  if (clarifying.length > 0) {
    item.clarifyingPhotos = clarifying;
  }

  // Move into AWAITING_EVIDENCE so the dynamic form is a real, enforced stop.
  if (item.status === 'INITIATED') {
    item.status = 'AWAITING_EVIDENCE';
    item.set('evidenceForm.status', 'pending');
    await item.save();
    await appendEvent(itemId, 'AWAITING_EVIDENCE', actor, { clarifyingPhotoCount: clarifying.length });
    await ItemLogger.log(itemId, 'STATUS_UPDATE', '📊 Status changed to AWAITING_EVIDENCE', { phase: 'pass1' });
  } else {
    await item.save();
  }

  // Fire-and-forget Pass 1; never block intake on it.
  try {
    const gradingService = require('../grading/grading.service');
    gradingService.startFormGeneration(itemId, {
      productId: item.originalProductId?.toString() || null,
      reason: item.reasonText || item.description || undefined,
      category: item.category,
      initialPhotos: clarifying,
    });
  } catch (err) {
    console.warn(`[items] could not start form generation for ${itemId}: ${err.message}`);
  }

  return item;
};

/**
 * Get a single item by ID with populated phase refs.
 */
const getItemById = async (itemId) => {
  return Item.findById(itemId)
    .populate('originalProductId', 'title images category price')
    .populate('originalOrderId', 'totalPrice createdAt')
    .populate('gradeId')
    .lean();
};

/**
 * Get all items for a user across both intake paths.
 */
const getItemsByUser = async (userId) => {
  return Item.find({ initiatorUserId: userId })
    .populate('originalProductId', 'title images category')
    .sort({ createdAt: -1 })
    .lean();
};

/**
 * Phase 3.5 — Unified status query. Merges item state, trust tier, and grade
 * (if complete) into one response the frontend can poll.
 */
const getItemStatus = async (itemId) => {
  const item = await Item.findById(itemId)
    .populate('originalProductId', 'title images category price')
    .lean();
  if (!item) return null;

  // Pull the grade if one exists (keyed by itemId in the grading module).
  let grade = null;
  try {
    const gradingService = require('../grading/grading.service');
    grade = await gradingService.getGradeByItemId(itemId);
  } catch (_) {
    /* grading module optional */
  }

  return {
    itemId: item._id,
    status: item.status,
    intakePath: item.intakePath,
    trustTier: item.trustTierAtSubmission || null,
    product: item.originalProductId || null,
    category: item.category || null,
    reasonCode: item.reasonCode || null,
    reasonText: item.reasonText || null,
    evidenceForm: item.evidenceForm || null,
    clarifyingPhotos: item.clarifyingPhotos || [],
    ownerNotes: item.ownerNotes || '',
    grade: grade || null,
    routingDecision: null, // populated in P4
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
};

/**
 * Add/update previous-owner notes on an item (Phase B — B4).
 * Initiator-only; allowed once the item is graded (status ≥ GRADED). If a
 * resale listing already exists, the note is mirrored onto it.
 */
const POST_GRADED_STATUSES = ['GRADED', 'ROUTED', 'IN_TRANSIT', 'LISTED', 'SOLD', 'DONATED', 'LIQUIDATED'];

const addOwnerNotes = async (itemId, userId, notes) => {
  const item = await Item.findById(itemId);
  if (!item) throw new Error('Item not found');
  if (item.initiatorUserId.toString() !== userId.toString()) throw new Error('Forbidden');
  if (!POST_GRADED_STATUSES.includes(item.status)) {
    throw new Error('Notes can only be added once the item has been graded');
  }

  item.ownerNotes = typeof notes === 'string' ? notes.trim() : '';
  await item.save();

  await ItemLogger.log(itemId, 'OWNER_NOTES', '📝 Previous-owner notes updated', {
    length: item.ownerNotes.length,
  });

  // Mirror onto an existing resale listing, if any (defensive — module optional).
  try {
    const ResaleListing = require('../resale/resale.model');
    await ResaleListing.findOneAndUpdate({ itemId }, { previousOwnerNotes: item.ownerNotes });
  } catch (_) {
    /* resale module optional */
  }

  return item;
};

module.exports = {
  createItem,
  transitionStatus,
  attachEvidence,
  requestEvidenceForm,
  markGraded,
  getItemById,
  getItemsByUser,
  getItemStatus,
  addOwnerNotes,
};
