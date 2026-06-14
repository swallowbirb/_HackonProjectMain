import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, CheckCircle2, Loader2, ImagePlus, ArrowRight, AlertTriangle, Sparkles, Send,
} from 'lucide-react';
import {
  uploadToS3, getItemStatus, getEvidenceForm, verifyEvidenceField,
} from '../services/item.service';
import { submitReturnEvidence } from '../services/return.service';
import { submitSecondhandEvidence } from '../services/secondhand.service';
import DeveloperLogsSidebar from '../components/shared/DeveloperLogsSidebar';
import TrustTierBadge from '../components/shared/TrustTierBadge';

const FORM_POLL_INTERVAL = 1500;

/**
 * ItemEvidencePage (v2.35)
 *
 * Per-field batched evidence flow:
 *   1. Photos for a field are uploaded to S3 only — NO LLM is called per upload.
 *   2. The user clicks "Submit Field" → ONE multimodal LLM call judges the
 *      whole photo SET for that field (right item, required views present, etc).
 *   3. The page-level "Submit Evidence" button triggers grading; any required
 *      field that wasn't submitted manually is verified inline first.
 *
 * Field state machine:
 *   idle → staged (≥1 photo) → verifying → verified | rejected
 *   editing photos in a verified field downgrades it back to 'staged'.
 */
export default function ItemEvidencePage() {
  const { itemId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const intakePath = location.state?.intakePath || 'return';
  const productTitle = location.state?.productTitle || 'Your item';

  const [trustTier, setTrustTier] = useState(null);
  const [schema, setSchema] = useState(null);
  const [readiness, setReadiness] = useState('pending'); // pending | ready | fallback
  const [source, setSource] = useState(null);

  // Per-field state — see file header for the shape.
  const [fieldState, setFieldState] = useState({});
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const fileInputs = useRef({});

  // --- Load trust tier once ---
  useEffect(() => {
    if (!itemId) return;
    getItemStatus(itemId)
      .then((res) => { if (res.success) setTrustTier(res.data.trustTier); })
      .catch(() => {});
  }, [itemId]);

  // --- Poll the dynamic form until ready/fallback ---
  useEffect(() => {
    if (!itemId) return undefined;
    let active = true;
    const poll = async () => {
      try {
        const res = await getEvidenceForm(itemId);
        if (!active || !res.success) return;
        setSchema(res.data.schema);
        setReadiness(res.data.readiness);
        setSource(res.data.source || null);
      } catch {
        /* keep last schema on transient failure */
      }
    };
    poll();
    const interval = setInterval(() => {
      if (readiness === 'ready' || readiness === 'fallback') return;
      poll();
    }, FORM_POLL_INTERVAL);
    return () => { active = false; clearInterval(interval); };
  }, [itemId, readiness]);

  // Temporarily hide serial-number / model-label fields (not required for now).
  const isHiddenField = (f) => {
    const s = `${f.id || ''} ${f.label || ''} ${f.expected_subject || ''}`.toLowerCase();
    return /serial|imei/.test(s)
      || /(brand|model)[^a-z]{0,12}label/.test(s)
      || /label[^a-z]{0,12}(serial|brand|model)/.test(s)
      || f.id === 'label_photo';
  };

  const visibleFields = (schema?.fields || []).filter((f) => !isHiddenField(f));
  const photoFields = visibleFields.filter((f) => f.type === 'photo');
  const textFields = visibleFields.filter((f) => f.type !== 'photo');

  // ----------- per-field helpers ---------------------------------------------
  // Editing a verified field reverts its badge: the user must Submit Field again.
  const revertVerifiedOnEdit = (state, fieldId) => {
    const f = state[fieldId];
    if (!f) return state;
    if (f.fieldStatus === 'verified' || f.fieldStatus === 'rejected') {
      return {
        ...state,
        [fieldId]: { ...f, fieldStatus: 'staged', reuploadReason: null, missingViews: [], perPhoto: [] },
      };
    }
    return state;
  };

  // --- Upload (S3 only) — NO LLM call here in v2.35 ---
  const handleFieldUpload = useCallback(async (field, files) => {
    const valid = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!valid.length) return;
    setError(null);

    for (const file of valid) {
      const tmpUrl = URL.createObjectURL(file);
      // Optimistic uploading entry; verified→staged on edit.
      setFieldState((prev) => {
        const next = revertVerifiedOnEdit(prev, field.id);
        const f = next[field.id] || {};
        return {
          ...next,
          [field.id]: {
            ...f,
            photos: [...(f.photos || []), { tmpUrl, status: 'uploading' }],
            fieldStatus: f.fieldStatus === 'verified' ? 'staged' : (f.fieldStatus || 'staged'),
          },
        };
      });

      try {
        const url = await uploadToS3(file, itemId);
        setFieldState((prev) => updatePhoto(prev, field.id, tmpUrl, { url, status: 'ready' }));
      } catch {
        setFieldState((prev) => updatePhoto(prev, field.id, tmpUrl, { status: 'error' }));
        setError('A photo failed to upload. Please try again.');
      }
    }
  }, [itemId]);

  const removePhoto = (fieldId, tmpUrl) => {
    setFieldState((prev) => {
      const reverted = revertVerifiedOnEdit(prev, fieldId);
      const f = reverted[fieldId] || {};
      const remaining = (f.photos || []).filter((p) => p.tmpUrl !== tmpUrl);
      return {
        ...reverted,
        [fieldId]: {
          ...f,
          photos: remaining,
          // No photos left ⇒ idle (and clear any old verification result).
          fieldStatus: remaining.length === 0 ? 'idle' : (f.fieldStatus || 'staged'),
          reuploadReason: remaining.length === 0 ? null : f.reuploadReason,
          perPhoto: remaining.length === 0 ? [] : (f.perPhoto || []),
          missingViews: remaining.length === 0 ? [] : (f.missingViews || []),
        },
      };
    });
  };

  const setText = (fieldId, value) => {
    setFieldState((prev) => ({ ...prev, [fieldId]: { ...(prev[fieldId] || {}), text: value } }));
  };

  // --- Per-field "Submit Field" — ONE LLM call over the whole photo set ---
  const submitFieldForVerification = useCallback(async (field) => {
    const f = fieldState[field.id] || {};
    const photoUrls = (f.photos || []).filter((p) => p.url && p.status === 'ready').map((p) => p.url);
    if (photoUrls.length === 0) return;

    setFieldState((prev) => ({
      ...prev,
      [field.id]: { ...(prev[field.id] || {}), fieldStatus: 'verifying' },
    }));

    try {
      const res = await verifyEvidenceField({
        itemId,
        fieldId: field.id,
        fieldLabel: field.label,
        expectedSubject: field.expected_subject,
        validationCriteria: field.validation_criteria,
        photoUrls,
      });
      const d = res?.data || {};
      const accepted = d.accepted !== false;
      setFieldState((prev) => ({
        ...prev,
        [field.id]: {
          ...(prev[field.id] || {}),
          fieldStatus: accepted ? 'verified' : 'rejected',
          reuploadReason: accepted ? null : (d.reupload_reason || 'Please review the photos for this field.'),
          perPhoto: Array.isArray(d.per_photo) ? d.per_photo : [],
          missingViews: Array.isArray(d.missing_views) ? d.missing_views : [],
        },
      }));
      return accepted;
    } catch {
      // ML/network failure → fail-open: mark verified-with-warning so the user
      // is never hard-blocked. The synthesizer at submit can still flag the item.
      setFieldState((prev) => ({
        ...prev,
        [field.id]: {
          ...(prev[field.id] || {}),
          fieldStatus: 'verified',
          reuploadReason: null,
          perPhoto: [],
          missingViews: [],
        },
      }));
      return true;
    }
  }, [fieldState, itemId]);

  // --- Required-field gating (mirrors the backend gate) ---
  // Required = at least one photo present. Verification status is enforced at submit.
  const missingRequired = photoFields
    .filter((f) => f.required)
    .filter((f) => !((fieldState[f.id]?.photos || []).some((p) => p.url)))
    .map((f) => f.label || f.id);

  const buildFieldImages = () => {
    const map = {};
    for (const f of photoFields) {
      const urls = (fieldState[f.id]?.photos || [])
        .filter((p) => p.url && p.status === 'ready')
        .map((p) => p.url);
      if (urls.length) map[f.id] = urls;
    }
    return map;
  };

  // --- Page-level Submit — verifies any required field that wasn't manually submitted ---
  const handleSubmit = async () => {
    if (missingRequired.length) {
      setError(`Please add: ${missingRequired.join(', ')}`);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      // Inline-verify any required fields that have photos but aren't 'verified' yet.
      const needsVerify = photoFields.filter((f) => {
        const s = fieldState[f.id];
        const hasPhotos = (s?.photos || []).some((p) => p.url && p.status === 'ready');
        return hasPhotos && s?.fieldStatus !== 'verified';
      });
      for (const field of needsVerify) {
        const accepted = await submitFieldForVerification(field);
        if (accepted === false) {
          setError(`"${field.label || field.id}" needs another photo. See the field for details.`);
          setSubmitting(false);
          return;
        }
      }

      const fieldImages = buildFieldImages();
      const allUrls = Object.values(fieldImages).flat();
      if (allUrls.length === 0) {
        setError('Upload at least one photo before submitting.');
        setSubmitting(false);
        return;
      }
      const submitFn = intakePath === 'sell-used' ? submitSecondhandEvidence : submitReturnEvidence;
      await submitFn(itemId, allUrls, fieldImages, additionalNotes.trim() || undefined);
      navigate(`/items/${itemId}/status`, { state: { intakePath, productTitle }, replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const label = intakePath === 'sell-used' ? 'Sell Used' : 'Return';
  const isAiForm = readiness === 'ready' && source && source !== 'last_resort';

  return (
    <div className="flex">
      <div className="flex-1 min-w-0">
        <div className="max-w-2xl mx-auto px-4 py-10 font-sans">
          {/* Header */}
          <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
            <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
              <span className="uppercase tracking-widest font-semibold text-[#FF9900]">{label}</span>
              <span>/</span>
              <span>Evidence</span>
            </div>
            <h1 className="text-2xl font-black text-gray-900 leading-tight">
              {schema?.title || 'Item Condition Evidence'} — <span className="text-[#FF9900]">{productTitle}</span>
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {isAiForm
                ? 'We tailored this checklist to your item and your reason. Add the photos for each field, then click Submit Field.'
                : 'Add clear, well-lit photos showing the item\u2019s current condition.'}
            </p>
            <div className="flex items-center gap-2 mt-3">
              {trustTier && <TrustTierBadge tier={trustTier} />}
              {readiness === 'pending' && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-600">
                  <Loader2 className="w-3 h-3 animate-spin" /> Tailoring your form…
                </span>
              )}
              {isAiForm && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-600">
                  <Sparkles className="w-3 h-3" /> AI-tailored checklist
                </span>
              )}
              {readiness === 'fallback' && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-600">
                  <AlertTriangle className="w-3 h-3" /> Standard checklist
                </span>
              )}
            </div>
          </motion.div>

          {/* Photo fields */}
          <div className="space-y-4">
            {photoFields.map((field) => {
              const f = fieldState[field.id] || {};
              const photos = f.photos || [];
              const fieldStatus = f.fieldStatus || (photos.length > 0 ? 'staged' : 'idle');
              const hasReadyPhoto = photos.some((p) => p.url && p.status === 'ready');
              const verifying = fieldStatus === 'verifying';
              const verified = fieldStatus === 'verified';
              const rejected = fieldStatus === 'rejected';

              // Map per-photo notes from the LLM back onto the photo cards.
              const noteByUrl = new Map();
              for (const n of f.perPhoto || []) {
                if (n && n.image_url) noteByUrl.set(n.image_url, n);
              }

              return (
                <motion.div
                  key={field.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`border rounded-2xl p-4 bg-white ${
                    verified ? 'border-emerald-300' : rejected ? 'border-red-300' : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-gray-800 text-sm">
                          {field.label}
                          {field.required && <span className="text-red-500 ml-1">*</span>}
                        </p>
                        {verified && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3" /> Verified
                          </span>
                        )}
                        {rejected && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
                            <AlertTriangle className="w-3 h-3" /> Re-upload
                          </span>
                        )}
                        {fieldStatus === 'staged' && hasReadyPhoto && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                            Awaiting submission
                          </span>
                        )}
                      </div>
                      {field.guidance && <p className="text-xs text-gray-500 mt-0.5">{field.guidance}</p>}
                      {field.expected_subject && (
                        <p className="text-[11px] text-gray-400 mt-0.5 italic">Should show: {field.expected_subject}</p>
                      )}
                    </div>
                    <button
                      onClick={() => fileInputs.current[field.id]?.click()}
                      disabled={verifying}
                      className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-[#FF9900] hover:text-[#FFB347] disabled:opacity-50 px-3 py-1.5 rounded-lg border border-orange-200 bg-orange-50"
                    >
                      <ImagePlus className="w-4 h-4" /> Add
                    </button>
                    <input
                      ref={(el) => { fileInputs.current[field.id] = el; }}
                      type="file" accept="image/*" multiple className="hidden"
                      onChange={(e) => handleFieldUpload(field, e.target.files)}
                    />
                  </div>

                  {photos.length > 0 && (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {photos.map((p) => {
                        const note = p.url ? noteByUrl.get(p.url) : null;
                        const flagged = note && note.usable === false;
                        return (
                          <div
                            key={p.tmpUrl}
                            className={`relative rounded-xl overflow-hidden aspect-square group border ${
                              flagged ? 'border-red-300' : 'border-gray-200'
                            }`}
                          >
                            <img src={p.tmpUrl || p.url} alt="" className="w-full h-full object-cover" />
                            <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 text-[9px] font-semibold flex items-center gap-1">
                              {p.status === 'uploading' && (
                                <span className="text-white bg-black/60 rounded px-1 inline-flex items-center gap-1">
                                  <Loader2 className="w-2.5 h-2.5 animate-spin" /> Uploading
                                </span>
                              )}
                              {p.status === 'error' && (
                                <span className="text-white bg-red-500/90 rounded px-1">Upload failed</span>
                              )}
                              {p.status === 'ready' && note?.role && !flagged && (
                                <span className="text-white bg-black/55 rounded px-1 truncate">{note.role}</span>
                              )}
                              {flagged && (
                                <span className="text-white bg-red-500/90 rounded px-1 inline-flex items-center gap-1">
                                  <AlertTriangle className="w-2.5 h-2.5" /> {note?.note || 'Replace this'}
                                </span>
                              )}
                            </div>
                            <button
                              onClick={() => removePhoto(field.id, p.tmpUrl)}
                              disabled={verifying}
                              className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/60 hover:bg-red-500 disabled:opacity-50 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Field-level reupload guidance from the Inspector */}
                  {rejected && f.reuploadReason && (
                    <div className="mt-3 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-lg">
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      <div>
                        <p>{f.reuploadReason}</p>
                        {Array.isArray(f.missingViews) && f.missingViews.length > 0 && (
                          <p className="mt-1 text-[11px] text-red-600">
                            Still needed: {f.missingViews.join(', ')}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Per-field Submit Field button */}
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <p className="text-[11px] text-gray-500">
                      {verified
                        ? 'Looks good. Edit photos to re-submit.'
                        : rejected
                          ? 'Add or replace photos and submit again.'
                          : hasReadyPhoto
                            ? 'When this field is complete, submit it for AI verification.'
                            : 'Add at least one photo to submit this field.'}
                    </p>
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={() => submitFieldForVerification(field)}
                      disabled={!hasReadyPhoto || verifying || verified}
                      className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                        verified
                          ? 'bg-emerald-100 text-emerald-700'
                          : rejected
                            ? 'bg-red-500 hover:bg-red-600 text-white'
                            : 'bg-gray-900 hover:bg-black text-white'
                      }`}
                    >
                      {verifying ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking…</>
                      ) : verified ? (
                        <><CheckCircle2 className="w-3.5 h-3.5" /> Verified</>
                      ) : rejected ? (
                        <><Send className="w-3.5 h-3.5" /> Submit Field again</>
                      ) : (
                        <><Send className="w-3.5 h-3.5" /> Submit Field</>
                      )}
                    </motion.button>
                  </div>
                </motion.div>
              );
            })}

            {/* Text / notes fields */}
            {textFields.map((field) => (
              <div key={field.id} className="border border-gray-200 rounded-2xl p-4 bg-white">
                <label className="font-bold text-gray-800 text-sm block">
                  {field.label}{field.required && <span className="text-red-500 ml-1">*</span>}
                </label>
                {field.guidance && <p className="text-xs text-gray-500 mt-0.5 mb-2">{field.guidance}</p>}
                <textarea
                  rows={3}
                  value={fieldState[field.id]?.text || ''}
                  onChange={(e) => setText(field.id, e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#FF9900]"
                  placeholder="Type here…"
                />
              </div>
            ))}
          </div>

          {/* Tips */}
          {schema?.photo_guidance?.length > 0 && (
            <div className="mt-6 bg-blue-50 border border-blue-100 rounded-xl p-4">
              <p className="text-xs font-semibold text-blue-700 mb-2">📸 Photo tips</p>
              <ul className="text-xs text-blue-600 space-y-1 list-disc list-inside">
                {schema.photo_guidance.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          )}

          {/* Additional notes — free-text passed to the AI grader as extra claim context */}
          <div className="mt-4">
            <label className="block text-sm font-bold text-gray-800 mb-1">
              Anything else to describe?
              <span className="font-normal text-gray-400 ml-1">(optional)</span>
            </label>
            <textarea
              rows={3}
              value={additionalNotes}
              onChange={(e) => setAdditionalNotes(e.target.value)}
              placeholder="e.g. The crack appeared after just 2 weeks of normal use. The screen still lights up but touch is broken on the left half."
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#FF9900] focus:border-transparent resize-none"
            />
            <p className="text-xs text-gray-400 mt-1">
              Your description is passed directly to the AI grader — the more specific the better.
            </p>
          </div>

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="mt-4 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Submit */}
          <div className="mt-6 flex items-center justify-between">
            <p className="text-xs text-gray-400">
              {missingRequired.length
                ? `${missingRequired.length} required item(s) left`
                : 'All required photos added'}
            </p>
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleSubmit}
              disabled={submitting || missingRequired.length > 0}
              className="inline-flex items-center gap-2 bg-[#FF9900] hover:bg-[#FFB347] disabled:opacity-40 disabled:cursor-not-allowed text-black font-bold px-6 py-2.5 rounded-xl transition-colors shadow-sm text-sm"
            >
              {submitting ? (<><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>)
                : (<>Submit Evidence <ArrowRight className="w-4 h-4" /></>)}
            </motion.button>
          </div>
        </div>
      </div>

      <DeveloperLogsSidebar itemId={itemId} />
    </div>
  );
}

// --- helpers ---------------------------------------------------------------
function updatePhoto(state, fieldId, tmpUrl, patch) {
  const f = state[fieldId] || {};
  return {
    ...state,
    [fieldId]: {
      ...f,
      photos: (f.photos || []).map((p) => (p.tmpUrl === tmpUrl ? { ...p, ...patch } : p)),
    },
  };
}
