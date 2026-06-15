import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, CheckCircle2, Loader2, ImagePlus, ArrowRight, AlertTriangle, Sparkles, Send,
  Video, ChevronRight,
} from 'lucide-react';
import {
  uploadToS3, getItemStatus, getEvidenceForm, verifyEvidenceField,
} from '../services/item.service';
import { submitReturnEvidence } from '../services/return.service';
import { submitSecondhandEvidence } from '../services/secondhand.service';
import { getMontageMode, getBustCacheMode, regenForm } from '../services/dev.service';
import DeveloperLogsSidebar from '../components/shared/DeveloperLogsSidebar';
import EvidenceStepper from '../components/shared/EvidenceStepper';
import TrustTierBadge from '../components/shared/TrustTierBadge';

const FORM_POLL_INTERVAL = 1500;
// Max frames sampled from a recorded video for upload (Req 9.1, 9.4).
const MAX_VIDEO_FRAMES = 8;
const VIDEO_SAMPLE_INTERVAL_S = 1.5;

/**
 * ItemEvidencePage (v3 — dynamic stepper)
 *
 * Multi-step, context-aware evidence flow:
 *   1. Photos/videos for a field are uploaded to S3 — NO LLM called per upload.
 *   2. "Submit Field" → ONE multimodal LLM call over the whole photo set.
 *   3. "Next" is gated: all required fields in the step must be verified or
 *      passed-through (2nd failed attempt). Completed steps are revisitable.
 *   4. For capture_mode=video fields, the user records or uploads a video;
 *      frames are extracted client-side via <canvas> and uploaded as JPEGs.
 *   5. A schema without steps[] renders as a single implicit step (Req 6.6, 16.4).
 */
export default function ItemEvidencePage() {
  const { itemId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const intakePath = location.state?.intakePath || 'return';
  const productTitle = location.state?.productTitle || 'Your item';

  const [trustTier, setTrustTier] = useState(null);
  const [schema, setSchema] = useState(null);
  const [readiness, setReadiness] = useState('pending');
  const [source, setSource] = useState(null);

  // Step machine state.
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState(new Set());

  // Per-field state (shared across all steps).
  const [fieldState, setFieldState] = useState({});
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const fileInputs = useRef({});
  const videoInputs = useRef({});
  const videoRecorderRefs = useRef({});

  // DEV cache-bypass (DevTools "Use Cache" OFF): force ONE fresh Pass-1
  // generation on mount so a stale cached/persisted form is never shown.
  // While this is in flight, the poll below holds at "pending" so it can't
  // grab the old persisted schema first.
  const awaitingRegenRef = useRef(getBustCacheMode());

  // --- Load trust tier once ---
  useEffect(() => {
    if (!itemId) return;
    getItemStatus(itemId)
      .then((res) => { if (res.success) setTrustTier(res.data.trustTier); })
      .catch(() => {});
  }, [itemId]);

  // --- DEV: when cache is disabled, force a fresh form before polling ---
  useEffect(() => {
    if (!itemId || !awaitingRegenRef.current) return;
    setReadiness('pending');
    setSource('regenerating');
    // regenForm resolves only after the backend finishes regeneration (the dev
    // endpoint awaits startFormGeneration), so by the time the ref flips false
    // the persisted form is already the fresh one and the poll picks it up.
    regenForm(itemId).finally(() => { awaitingRegenRef.current = false; });
  }, [itemId]);

  // --- Poll the dynamic form until ready/fallback ---
  useEffect(() => {
    if (!itemId) return undefined;
    let active = true;
    const poll = async () => {
      // Don't accept the (stale) persisted form while a forced regen is running.
      if (awaitingRegenRef.current) return;
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

  // --- Derive ordered steps from schema ---
  // A schema with steps[] uses those; otherwise wrap all fields in one implicit step.
  const steps = deriveSteps(schema);

  // The fields that belong to the currently visible step.
  const currentStepData = steps[currentStep] || steps[0] || { id: 'default', title: 'Evidence', fields: [] };
  const currentFields = (currentStepData.fields || []).filter((f) => !isHiddenField(f));
  const currentPhotoFields = currentFields.filter((f) => f.type !== 'text');
  const currentTextFields = currentFields.filter((f) => f.type === 'text');

  // --- Per-field helpers ---
  const revertVerifiedOnEdit = (state, fieldId) => {
    const f = state[fieldId];
    if (!f) return state;
    if (f.fieldStatus === 'verified' || f.fieldStatus === 'rejected') {
      return { ...state, [fieldId]: { ...f, fieldStatus: 'staged', reuploadReason: null, missingViews: [], perPhoto: [] } };
    }
    return state;
  };

  // --- Photo upload (S3 only — NO LLM) ---
  const handleFieldUpload = useCallback(async (field, files) => {
    const valid = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!valid.length) return;
    setError(null);

    for (const file of valid) {
      const tmpUrl = URL.createObjectURL(file);
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

  // --- Client-side video frame extraction (Req 9.1, 9.4) ---
  // Samples frames from a video file at fixed intervals via <canvas>, uploads each
  // as a JPEG through the existing S3 upload path (Task 12.3).
  const handleVideoUpload = useCallback(async (field, file) => {
    if (!file || !file.type.startsWith('video/')) return;
    setError(null);

    const placeholder = URL.createObjectURL(file);
    setFieldState((prev) => {
      const next = revertVerifiedOnEdit(prev, field.id);
      const f = next[field.id] || {};
      return { ...next, [field.id]: { ...f, photos: [...(f.photos || []), { tmpUrl: placeholder, status: 'extracting', isVideoFrame: true }], fieldStatus: 'staged' } };
    });

    try {
      const frames = await extractVideoFrames(file, { maxFrames: MAX_VIDEO_FRAMES, intervalS: VIDEO_SAMPLE_INTERVAL_S });

      // Remove the placeholder, upload real frames.
      setFieldState((prev) => {
        const f = prev[field.id] || {};
        return { ...prev, [field.id]: { ...f, photos: (f.photos || []).filter((p) => p.tmpUrl !== placeholder) } };
      });

      for (const { blob, tmpUrl } of frames) {
        const uploadPlaceholder = tmpUrl;
        setFieldState((prev) => {
          const next = revertVerifiedOnEdit(prev, field.id);
          const f = next[field.id] || {};
          return { ...next, [field.id]: { ...f, photos: [...(f.photos || []), { tmpUrl: uploadPlaceholder, status: 'uploading', isVideoFrame: true }], fieldStatus: 'staged' } };
        });
        try {
          const url = await uploadToS3(blob, itemId, 'video-frame.jpg');
          setFieldState((prev) => updatePhoto(prev, field.id, uploadPlaceholder, { url, status: 'ready' }));
        } catch {
          setFieldState((prev) => updatePhoto(prev, field.id, uploadPlaceholder, { status: 'error' }));
        }
      }
    } catch {
      setFieldState((prev) => updatePhoto(prev, field.id, placeholder, { status: 'error' }));
      setError('Video frame extraction failed. Try uploading photos instead.');
    }
  }, [itemId]);

  const removePhoto = (fieldId, tmpUrl) => {
    setFieldState((prev) => {
      const reverted = revertVerifiedOnEdit(prev, fieldId);
      const f = reverted[fieldId] || {};
      const remaining = (f.photos || []).filter((p) => p.tmpUrl !== tmpUrl);
      return {
        ...reverted,
        [fieldId]: { ...f, photos: remaining, fieldStatus: remaining.length === 0 ? 'idle' : (f.fieldStatus || 'staged'), reuploadReason: remaining.length === 0 ? null : f.reuploadReason, perPhoto: remaining.length === 0 ? [] : (f.perPhoto || []), missingViews: remaining.length === 0 ? [] : (f.missingViews || []) },
      };
    });
  };

  // Clears every photo/frame for a field at once (used to remove an uploaded video).
  const removeAllPhotos = (fieldId) => {
    setFieldState((prev) => {
      const reverted = revertVerifiedOnEdit(prev, fieldId);
      const f = reverted[fieldId] || {};
      return {
        ...reverted,
        [fieldId]: { ...f, photos: [], fieldStatus: 'idle', reuploadReason: null, perPhoto: [], missingViews: [] },
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

    setFieldState((prev) => ({ ...prev, [field.id]: { ...(prev[field.id] || {}), fieldStatus: 'verifying' } }));

    try {
      const res = await verifyEvidenceField({
        itemId,
        fieldId: field.id,
        fieldLabel: field.label,
        expectedSubject: field.expected_subject,
        validationCriteria: field.validation_criteria,
        photoUrls,
        montage: getMontageMode(),
      });
      const d = res?.data || {};
      const accepted = d.accepted !== false;
      const fieldStateFromServer = d.field_state;
      // Two-attempt pass-through: if backend marks status='unverified', treat as accepted.
      const passedThrough = fieldStateFromServer?.status === 'unverified';
      const effectivelyAccepted = accepted || passedThrough;
      setFieldState((prev) => ({
        ...prev,
        [field.id]: { ...(prev[field.id] || {}), fieldStatus: effectivelyAccepted ? 'verified' : 'rejected', reuploadReason: effectivelyAccepted ? null : (d.reupload_reason || 'Please review the photos for this field.'), perPhoto: Array.isArray(d.per_photo) ? d.per_photo : [], missingViews: Array.isArray(d.missing_views) ? d.missing_views : [], passedThrough },
      }));
      return effectivelyAccepted;
    } catch {
      setFieldState((prev) => ({ ...prev, [field.id]: { ...(prev[field.id] || {}), fieldStatus: 'verified', reuploadReason: null, perPhoto: [], missingViews: [] } }));
      return true;
    }
  }, [fieldState, itemId]);

  // --- Step navigation ---
  // A step is "satisfied" when every required photo field in it is verified/passed-through.
  const isStepSatisfied = (stepIdx) => {
    const sd = steps[stepIdx];
    if (!sd) return true;
    const fields = (sd.fields || []).filter((f) => !isHiddenField(f) && f.type !== 'text' && f.required);
    return fields.every((f) => {
      const s = fieldState[f.id];
      return s?.fieldStatus === 'verified';
    });
  };

  // What's blocking the current step's "Next" button.
  const currentStepBlocker = (() => {
    const fields = currentPhotoFields.filter((f) => f.required);
    const first = fields.find((f) => fieldState[f.id]?.fieldStatus !== 'verified');
    return first ? (first.label || first.id) : null;
  })();

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCompletedSteps((prev) => new Set([...prev, currentStep]));
      setCurrentStep((s) => s + 1);
      setError(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleStepClick = (idx) => {
    if (completedSteps.has(idx)) {
      setCurrentStep(idx);
      setError(null);
    }
  };

  // --- Required-field gating across ALL steps ---
  const allRequiredMissing = steps.flatMap((sd) =>
    (sd.fields || [])
      .filter((f) => !isHiddenField(f) && f.type !== 'text' && f.required)
      .filter((f) => !(fieldState[f.id]?.photos || []).some((p) => p.url))
      .map((f) => f.label || f.id)
  );

  const buildFieldImages = () => {
    const map = {};
    for (const sd of steps) {
      for (const f of (sd.fields || []).filter((fi) => fi.type !== 'text')) {
        const urls = (fieldState[f.id]?.photos || []).filter((p) => p.url && p.status === 'ready').map((p) => p.url);
        if (urls.length) map[f.id] = urls;
      }
    }
    return map;
  };

  // --- Page-level Submit ---
  const handleSubmit = async () => {
    if (allRequiredMissing.length) {
      setError(`Please add: ${allRequiredMissing.join(', ')}`);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const allPhotoFields = steps.flatMap((sd) => (sd.fields || []).filter((f) => f.type !== 'text'));
      const needsVerify = allPhotoFields.filter((f) => {
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
  const isLastStep = currentStep === steps.length - 1;

  return (
    <div className="flex">
      <div className="flex-1 min-w-0">
        <div className="max-w-2xl mx-auto px-4 py-10 font-sans">
          {readiness === 'pending' ? (
            <FormGeneratingScreen productTitle={productTitle} label={label} />
          ) : (
          <>
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
                : 'Add clear, well-lit photos showing the item’s current condition.'}
            </p>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
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

          {/* Step progress bar (only when there are multiple steps) */}
          {steps.length > 1 && (
            <div className="mb-6">
              <EvidenceStepper
                steps={steps}
                currentStep={currentStep}
                completedSteps={completedSteps}
                onStepClick={handleStepClick}
              />
              {currentStepData.purpose && (
                <p className="text-xs text-gray-500 mt-3 italic">{currentStepData.purpose}</p>
              )}
            </div>
          )}

          {/* Current step's fields */}
          <div className="space-y-4">
            {currentPhotoFields.map((field) => (
              <PhotoField
                key={field.id}
                field={field}
                fieldState={fieldState[field.id] || {}}
                verifying={fieldState[field.id]?.fieldStatus === 'verifying'}
                fileInputRef={(el) => { fileInputs.current[field.id] = el; }}
                videoInputRef={(el) => { videoInputs.current[field.id] = el; }}
                onPhotoUpload={(files) => handleFieldUpload(field, files)}
                onVideoUpload={(file) => handleVideoUpload(field, file)}
                onRemove={(tmpUrl) => removePhoto(field.id, tmpUrl)}
                onClearVideo={() => removeAllPhotos(field.id)}
                onSubmit={() => submitFieldForVerification(field)}
              />
            ))}

            {currentTextFields.map((field) => (
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

          {/* Photo tips */}
          {schema?.photo_guidance?.length > 0 && (
            <div className="mt-6 bg-blue-50 border border-blue-100 rounded-xl p-4">
              <p className="text-xs font-semibold text-blue-700 mb-2">📸 Photo tips</p>
              <ul className="text-xs text-blue-600 space-y-1 list-disc list-inside">
                {schema.photo_guidance.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          )}

          {/* Additional notes (only on last step) */}
          {isLastStep && (
            <div className="mt-4">
              <label className="block text-sm font-bold text-gray-800 mb-1">
                Anything else to describe?
                <span className="font-normal text-gray-400 ml-1">(optional)</span>
              </label>
              <textarea
                rows={3}
                value={additionalNotes}
                onChange={(e) => setAdditionalNotes(e.target.value)}
                placeholder="e.g. The crack appeared after just 2 weeks of normal use."
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#FF9900] focus:border-transparent resize-none"
              />
            </div>
          )}

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

          {/* Navigation footer */}
          <div className="mt-6 flex items-center justify-between gap-3">
            <p className="text-xs text-gray-400">
              {currentStepBlocker
                ? `Complete "${currentStepBlocker}" to continue`
                : isLastStep && allRequiredMissing.length > 0
                  ? `${allRequiredMissing.length} required item(s) left`
                  : isLastStep
                    ? 'All required photos added'
                    : 'Step complete — ready to continue'}
            </p>

            {isLastStep ? (
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleSubmit}
                disabled={submitting || allRequiredMissing.length > 0}
                className="inline-flex items-center gap-2 bg-[#FF9900] hover:bg-[#FFB347] disabled:opacity-40 disabled:cursor-not-allowed text-black font-bold px-6 py-2.5 rounded-xl transition-colors shadow-sm text-sm"
              >
                {submitting ? (<><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>) : (<>Submit Evidence <ArrowRight className="w-4 h-4" /></>)}
              </motion.button>
            ) : (
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleNext}
                disabled={!!currentStepBlocker}
                title={currentStepBlocker ? `Complete "${currentStepBlocker}" first` : 'Next step'}
                className="inline-flex items-center gap-2 bg-gray-900 hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold px-6 py-2.5 rounded-xl transition-colors shadow-sm text-sm"
              >
                Next <ChevronRight className="w-4 h-4" />
              </motion.button>
            )}
          </div>
          </>
          )}
        </div>
      </div>

      <DeveloperLogsSidebar itemId={itemId} />
    </div>
  );
}

// --- PhotoField sub-component ---
function PhotoField({ field, fieldState, verifying, fileInputRef, videoInputRef, onPhotoUpload, onVideoUpload, onRemove, onClearVideo, onSubmit }) {
  const photos = fieldState.photos || [];
  const fieldStatus = fieldState.fieldStatus || (photos.length > 0 ? 'staged' : 'idle');
  const hasReadyPhoto = photos.some((p) => p.url && p.status === 'ready');
  const verified = fieldStatus === 'verified';
  const rejected = fieldStatus === 'rejected';
  const isVideo = field.capture_mode === 'video' || field.type === 'video';

  const noteByUrl = new Map();
  for (const n of fieldState.perPhoto || []) {
    if (n && n.image_url) noteByUrl.set(n.image_url, n);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`border rounded-2xl p-4 bg-white ${verified ? 'border-emerald-300' : rejected ? 'border-red-300' : 'border-gray-200'}`}
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
                <CheckCircle2 className="w-3 h-3" /> {fieldState.passedThrough ? 'Passed through' : 'Verified'}
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

        {/* Upload button */}
        {isVideo ? (
          <>
            <button
              onClick={() => videoInputRef?.click?.() || document.querySelector(`[data-video="${field.id}"]`)?.click()}
              disabled={verifying}
              className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-[#FF9900] hover:text-[#FFB347] disabled:opacity-50 px-3 py-1.5 rounded-lg border border-orange-200 bg-orange-50"
            >
              <Video className="w-4 h-4" /> Add Video
            </button>
            <input
              ref={videoInputRef}
              data-video={field.id}
              type="file"
              accept="video/*"
              capture="environment"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onVideoUpload(e.target.files[0])}
            />
          </>
        ) : (
          <>
            <button
              onClick={() => fileInputRef?.click?.() || document.querySelector(`[data-photo="${field.id}"]`)?.click()}
              disabled={verifying}
              className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-[#FF9900] hover:text-[#FFB347] disabled:opacity-50 px-3 py-1.5 rounded-lg border border-orange-200 bg-orange-50"
            >
              <ImagePlus className="w-4 h-4" /> Add
            </button>
            <input
              ref={fileInputRef}
              data-photo={field.id}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => onPhotoUpload(e.target.files)}
            />
          </>
        )}
      </div>

      {/* Video fields: show a single status card — never expose the extracted frames. */}
      {isVideo && photos.length > 0 && (
        <VideoStatusCard photos={photos} verifying={verifying} onClear={onClearVideo} />
      )}

      {!isVideo && photos.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {photos.map((p) => {
            const note = p.url ? noteByUrl.get(p.url) : null;
            const flagged = note && note.usable === false;
            return (
              <div
                key={p.tmpUrl}
                className={`relative rounded-xl overflow-hidden aspect-square group border ${flagged ? 'border-red-300' : 'border-gray-200'}`}
              >
                <img src={p.tmpUrl || p.url} alt="" className="w-full h-full object-cover" />
                <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 text-[9px] font-semibold flex items-center gap-1">
                  {p.status === 'uploading' && (
                    <span className="text-white bg-black/60 rounded px-1 inline-flex items-center gap-1">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" /> Uploading
                    </span>
                  )}
                  {p.status === 'extracting' && (
                    <span className="text-white bg-blue-500/80 rounded px-1 inline-flex items-center gap-1">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" /> Extracting frames
                    </span>
                  )}
                  {p.status === 'error' && <span className="text-white bg-red-500/90 rounded px-1">Failed</span>}
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
                  onClick={() => onRemove(p.tmpUrl)}
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

      {rejected && fieldState.reuploadReason && (
        <div className="mt-3 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-lg">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <div>
            <p>{fieldState.reuploadReason}</p>
            {Array.isArray(fieldState.missingViews) && fieldState.missingViews.length > 0 && (
              <p className="mt-1 text-[11px] text-red-600">Still needed: {fieldState.missingViews.join(', ')}</p>
            )}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-[11px] text-gray-500">
          {verified
            ? fieldState.passedThrough ? 'Passed through after 2 attempts.' : 'Looks good. Edit photos to re-submit.'
            : rejected ? 'Add or replace photos and submit again.'
            : hasReadyPhoto ? 'When this field is complete, submit it for AI verification.'
            : isVideo ? 'Record or select a video to submit this field.' : 'Add at least one photo to submit this field.'}
        </p>
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={onSubmit}
          disabled={!hasReadyPhoto || verifying || verified}
          className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            verified ? 'bg-emerald-100 text-emerald-700' : rejected ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-gray-900 hover:bg-black text-white'
          }`}
        >
          {verifying ? (<><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking…</>)
            : verified ? (<><CheckCircle2 className="w-3.5 h-3.5" /> Verified</>)
            : rejected ? (<><Send className="w-3.5 h-3.5" /> Submit again</>)
            : (<><Send className="w-3.5 h-3.5" /> Submit Field</>)}
        </motion.button>
      </div>
    </motion.div>
  );
}

// --- "Just a moment" screen shown while the AI tailors the form ---
function FormGeneratingScreen({ productTitle, label }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-[60vh] flex flex-col items-center justify-center text-center"
    >
      <div className="relative mb-7">
        <motion.div
          className="absolute inset-0 rounded-3xl border-2 border-[#FF9900]/30"
          animate={{ scale: [1, 1.25, 1], opacity: [0.6, 0, 0.6] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div className="w-20 h-20 rounded-3xl bg-orange-50 flex items-center justify-center">
          <Sparkles className="w-9 h-9 text-[#FF9900]" />
        </div>
      </div>
      <h1 className="text-2xl font-black text-gray-900">Just a moment…</h1>
      <p className="text-sm text-gray-500 mt-2 max-w-sm leading-relaxed">
        We’re tailoring a custom condition checklist for{' '}
        <span className="font-semibold text-gray-700">{productTitle}</span>. This usually takes a few seconds.
      </p>
      <div className="mt-6 inline-flex items-center gap-2 text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Preparing your {label.toLowerCase()} form
      </div>
    </motion.div>
  );
}

// --- Single status card for a submitted video (frames stay hidden from the user) ---
function VideoStatusCard({ photos, verifying, onClear }) {
  const processing = photos.some((p) => p.status === 'extracting' || p.status === 'uploading');
  const ready = !processing && photos.some((p) => p.status === 'ready');
  const failed = !processing && !ready;

  return (
    <div className={`mt-3 flex items-center gap-3 border rounded-xl p-3 ${failed ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50'}`}>
      <div className="w-12 h-12 rounded-lg bg-[#FF9900]/10 flex items-center justify-center flex-shrink-0">
        <Video className="w-6 h-6 text-[#FF9900]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-800">
          {processing ? 'Processing your video…' : ready ? 'Video added' : 'Upload failed'}
        </p>
        <p className="text-xs text-gray-500">
          {processing
            ? 'We’ll analyse it automatically — no need to do anything.'
            : ready
              ? 'Ready to submit for AI verification.'
              : 'Something went wrong. Please record the video again.'}
        </p>
      </div>
      {processing ? (
        <Loader2 className="w-4 h-4 animate-spin text-gray-400 flex-shrink-0" />
      ) : (
        <button
          onClick={onClear}
          disabled={verifying}
          className="flex-shrink-0 w-7 h-7 rounded-full bg-black/60 hover:bg-red-500 disabled:opacity-50 text-white flex items-center justify-center transition-colors"
          aria-label="Remove video"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

// --- helpers ---

function updatePhoto(state, fieldId, tmpUrl, patch) {
  const f = state[fieldId] || {};
  return { ...state, [fieldId]: { ...f, photos: (f.photos || []).map((p) => (p.tmpUrl === tmpUrl ? { ...p, ...patch } : p)) } };
}

function isHiddenField(f) {
  const s = `${f.id || ''} ${f.label || ''} ${f.expected_subject || ''}`.toLowerCase();
  return /serial|imei/.test(s) || /(brand|model)[^a-z]{0,12}label/.test(s) || /label[^a-z]{0,12}(serial|brand|model)/.test(s) || f.id === 'label_photo';
}

/**
 * Derive an ordered steps array from a Form_Schema.
 * Schemas with explicit steps[] use those; a flat fields[] schema becomes one implicit step.
 * (Req 6.6, 16.4)
 */
function deriveSteps(schema) {
  if (!schema) return [{ id: 'default', title: 'Evidence', purpose: '', fields: [] }];
  if (Array.isArray(schema.steps) && schema.steps.length > 0) {
    return schema.steps;
  }
  // Legacy / flat fields[].
  const fields = Array.isArray(schema.fields) ? schema.fields : [];
  return [{ id: 'default', title: schema.title || 'Evidence', purpose: '', fields }];
}

/**
 * Extract up to maxFrames JPEG frames from a video file via <canvas> at fixed intervals.
 * Returns [{ blob, tmpUrl }]. (Req 9.1, 9.4 — Task 12.3)
 */
async function extractVideoFrames(file, { maxFrames = MAX_VIDEO_FRAMES, intervalS = VIDEO_SAMPLE_INTERVAL_S } = {}) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;

    video.onloadedmetadata = () => {
      const duration = video.duration;
      if (!isFinite(duration) || duration <= 0) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Video duration unavailable'));
        return;
      }

      const totalSlots = Math.max(1, Math.floor(duration / intervalS));
      const frameCount = Math.min(maxFrames, totalSlots);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const frames = [];
      let idx = 0;

      const captureNext = () => {
        if (idx >= frameCount) {
          URL.revokeObjectURL(objectUrl);
          resolve(frames);
          return;
        }
        const t = (idx / Math.max(1, frameCount - 1)) * (duration - 0.1);
        video.currentTime = Math.max(0, Math.min(t, duration - 0.05));
      };

      video.onseeked = () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) {
            const tmpUrl = URL.createObjectURL(blob);
            frames.push({ blob, tmpUrl });
          }
          idx++;
          captureNext();
        }, 'image/jpeg', 0.82);
      };

      video.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Video decode error'));
      };

      captureNext();
    };

    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Video load error'));
    };
  });
}
