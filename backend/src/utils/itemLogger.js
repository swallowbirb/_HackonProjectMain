const ItemLog = require('../modules/items/itemLog.model');

/**
 * ItemLogger — developer-visibility logging for the intake → grade flow.
 *
 * Emits plain-English, severity- and phase-tagged logs at every step. Logs are:
 *   1. Persisted to MongoDB (itemLogs collection, auto-expire after 7 days).
 *   2. Emitted via Socket.IO if `global.io` is available (real-time sidebar).
 *   3. Echoed to the backend console for local debugging.
 *
 * It also ingests the ML service's internal `trace` (see ingestTrace) so the
 * FastAPI pipeline — image fetches, Gemini attempts, vision calls — is no longer
 * a black box: every internal step lands in the same ordered stream.
 *
 * NEVER throws — logging failures must not break the business flow.
 */

// --- Level + phase derivation -------------------------------------------- //
// Server call sites emit a `step` key; we derive a sensible level/phase from it
// so we don't have to thread metadata through every call. Explicit values in
// metadata (`level`, `phase`, `durationMs`, `source`) always win.

const ERROR_STEPS = /(ERROR|REJECTED|UNAVAILABLE|_FAILED|_FAIL$)/;
const WARN_STEPS = /(WARNING|WARN|FLAGGED|INVALID|FALLBACK|SKIPPED)/;
const SUCCESS_STEPS = /(COMPLETE|ASSIGNED|_PASS$|_DONE|GRADE_ASSIGNED|TRUST_COMPLETE|ITEM_CREATED|_CACHE$|PASS1_COMPLETE|PASS2_GRADE)/;

function deriveLevel(step) {
  if (ERROR_STEPS.test(step)) return 'error';
  if (WARN_STEPS.test(step)) return 'warn';
  if (SUCCESS_STEPS.test(step)) return 'success';
  return 'info';
}

const PHASE_RULES = [
  [/^(INITIATE|ITEM_CREATED)$/, 'init'],
  [/^TRUST_/, 'trust'],
  [/^(PASS1_|FORM_)/, 'pass1'],
  [/^(EVIDENCE_|PHOTO_)/, 'evidence'],
  [/^(GRADING_REQUEST|GRADE_RECEIVED|ML_UNAVAILABLE|ML_INVALID_RESPONSE)$/, 'request'],
  [/^FRAUD_/, 'fraud'],
  [/^(ANALYSIS_|IMAGE_FETCH)/, 'analysis'],
  [/^(PASS2_|MODEL_|BEDROCK_)/, 'pass2'],
  [/^(PERSIST|LIFECYCLE_EMIT)/, 'persist'],
  [/^(GRADE_ASSIGNED|GRADE_REJECTED|STATUS_UPDATE|REVIEW_FLAGGED|FLOW_COMPLETE)$/, 'complete'],
  [/^ERROR$/, 'error'],
];

function derivePhase(step) {
  for (const [re, phase] of PHASE_RULES) {
    if (re.test(step)) return phase;
  }
  return 'general';
}

// In-memory monotonic sequence per item so same-millisecond logs keep their order.
const _seqCounters = new Map();
function nextSeq(itemId) {
  const key = String(itemId);
  const n = (_seqCounters.get(key) || 0) + 1;
  _seqCounters.set(key, n);
  // Bound the map so a long-lived process doesn't leak.
  if (_seqCounters.size > 5000) _seqCounters.clear();
  return n;
}

class ItemLogger {
  /**
   * @param {string} itemId
   * @param {string} step      machine key e.g. 'TRUST_COMPLETE'
   * @param {string} message   plain-English message
   * @param {object} [metadata] structured payload. Reserved keys (lifted to columns):
   *                            level, phase, durationMs, source.
   * @returns {Promise<object|null>} the persisted log entry (or null on failure)
   */
  static async log(itemId, step, message, metadata = {}) {
    const md = { ...(metadata || {}) };
    const level = md.level || deriveLevel(step);
    const phase = md.phase || derivePhase(step);
    const source = md.source || 'server';
    const durationMs = md.durationMs;
    delete md.level;
    delete md.phase;
    delete md.source;
    delete md.durationMs;

    const entry = {
      itemId,
      step,
      message,
      level,
      phase,
      source,
      durationMs,
      seq: nextSeq(itemId),
      metadata: md,
      timestamp: new Date(),
    };

    let saved = null;
    try {
      saved = await ItemLog.create(entry);
    } catch (err) {
      console.warn(`[itemLogger] failed to persist log for ${itemId}: ${err.message}`);
    }

    try {
      if (global.io) {
        global.io.to(`item:${itemId}`).emit('log', saved || entry);
      }
    } catch (_) {
      /* non-fatal */
    }

    const tag = level === 'error' ? 'ERR ' : level === 'warn' ? 'WARN' : '    ';
    console.log(`[item ${itemId}] ${tag} ${step}: ${message}`);

    return saved;
  }

  /**
   * Convenience error logger — never throws.
   */
  static async error(itemId, step, error, extra = {}) {
    const message = `❌ ${step}: ${error?.message || String(error)}`;
    return ItemLogger.log(itemId, 'ERROR', message, {
      level: 'error',
      failingStep: step,
      error: error?.stack || String(error),
      ...extra,
    });
  }

  /**
   * Ingest the ML service's internal pipeline `trace` into the itemLogs stream.
   *
   * Each trace entry already carries phase / level / duration / message, so we
   * map them straight into log documents (bulk insert for speed) rather than
   * re-deriving. This is what turns the FastAPI pipeline from a black box into a
   * fully visible, step-by-step story (image fetches, Gemini attempts, etc.).
   *
   * @param {string} itemId
   * @param {Array} trace - array of { seq, phase, code, level, message, ts, duration_ms, meta }
   * @param {object} [opts] - { source: 'ml' }
   * @returns {Promise<number>} number of log entries written
   */
  static async ingestTrace(itemId, trace, opts = {}) {
    if (!Array.isArray(trace) || trace.length === 0) return 0;
    const source = opts.source || 'ml';
    const baseSeq = nextSeq(itemId) * 1000; // keep ML block ordered after current server logs

    const docs = trace.map((e, idx) => {
      const meta = (e && e.meta) || {};
      // Surface a couple of useful fields the trace carries at top-level.
      if (e && e.since_start_ms != null && meta.sinceStartMs == null) {
        meta.sinceStartMs = e.since_start_ms;
      }
      return {
        itemId,
        step: (e && e.code) || 'ML_STEP',
        message: (e && e.message) || '(no message)',
        level: (e && e.level) || 'info',
        phase: (e && e.phase) || 'analysis',
        source,
        durationMs: e && e.duration_ms,
        seq: baseSeq + ((e && e.seq) || idx + 1),
        metadata: meta,
        timestamp: e && e.ts ? new Date(e.ts) : new Date(),
      };
    });

    let written = 0;
    try {
      const res = await ItemLog.insertMany(docs, { ordered: false });
      written = res.length;
    } catch (err) {
      // Partial inserts still count; never break the flow.
      console.warn(`[itemLogger] ingestTrace partial/failed for ${itemId}: ${err.message}`);
      written = err?.result?.nInserted || 0;
    }

    try {
      if (global.io) {
        docs.forEach((d) => global.io.to(`item:${itemId}`).emit('log', d));
      }
    } catch (_) {
      /* non-fatal */
    }

    console.log(`[item ${itemId}]      ML_TRACE: ingested ${written}/${docs.length} internal step(s)`);
    return written;
  }

  /**
   * Fetch logs for an item in chronological order (seq breaks same-ms ties).
   */
  static async getLogs(itemId, limit = 500) {
    try {
      return await ItemLog.find({ itemId })
        .sort({ timestamp: 1, seq: 1, _id: 1 })
        .limit(limit)
        .lean();
    } catch (err) {
      console.warn(`[itemLogger] failed to read logs for ${itemId}: ${err.message}`);
      return [];
    }
  }
}

module.exports = ItemLogger;
