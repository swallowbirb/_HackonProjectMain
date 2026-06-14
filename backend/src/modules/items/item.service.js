const Item = require('./item.model');
const { appendEvent } = require('../lifecycle/lifecycle.service');
const ItemLogger = require('../../utils/itemLogger');

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

  // --- Required-field gating (improvement #7) ---
  // If the item has a persisted AI/generic form, ensure every required photo field
  // has at least one image before we burn a grading pass.
  const formSchema = item.evidenceForm && item.evidenceForm.schema;
  if (fieldImages && formSchema && Array.isArray(formSchema.fields)) {
    // Temporarily hidden fields (serial/model-label) are not required for now —
    // mirrors the frontend filter so the gate doesn't block on a field the user never sees.
    const isHiddenField = (f) => {
      const s = `${f.id || ''} ${f.label || ''} ${f.expected_subject || ''}`.toLowerCase();
      return /serial|imei/.test(s)
        || /(brand|model)[^a-z]{0,12}label/.test(s)
        || /label[^a-z]{0,12}(serial|brand|model)/.test(s)
        || f.id === 'label_photo';
    };
    const missing = formSchema.fields
      .filter((f) => f && f.required && f.type === 'photo' && !isHiddenField(f))
      .filter((f) => !(Array.isArray(fieldImages[f.id]) && fieldImages[f.id].length > 0))
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
