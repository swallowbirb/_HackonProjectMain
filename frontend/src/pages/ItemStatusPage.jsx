import { useEffect, useState, useCallback } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getItemStatus, updateItemNotes } from '../services/item.service';
import DeveloperLogsSidebar from '../components/shared/DeveloperLogsSidebar';
import TrustTierBadge from '../components/shared/TrustTierBadge';
import RoutingRationale from '../components/routing/RoutingRationale';
import {
  Loader2, CheckCircle2, Clock, AlertCircle, Recycle, ShoppingBag, Package, ChevronDown, Pencil,
} from 'lucide-react';

const STEPS = [
  { key: 'INITIATED', label: 'Initiated', icon: Package },
  { key: 'EVIDENCE_PENDING', label: 'Evidence', icon: Clock },
  { key: 'GRADING', label: 'AI Grading', icon: Recycle },
  { key: 'GRADED', label: 'Graded', icon: CheckCircle2 },
  { key: 'ROUTED', label: 'Routed', icon: ShoppingBag },
];

const STATUS_ORDER = ['INITIATED', 'EVIDENCE_PENDING', 'GRADING', 'GRADED', 'ROUTED', 'IN_TRANSIT', 'LISTED', 'SOLD', 'DONATED', 'LIQUIDATED'];
const TERMINAL = ['SOLD', 'DONATED', 'LIQUIDATED', 'REJECTED', 'CANCELLED'];
const POLLING_INTERVAL = 3000;

const GRADE_COLORS = {
  A: 'bg-emerald-500',
  B: 'bg-blue-500',
  C: 'bg-orange-500',
  D: 'bg-red-500',
};

export default function ItemStatusPage() {
  const { itemId } = useParams();
  const location = useLocation();
  const intakePath = location.state?.intakePath || 'return';
  const productTitle = location.state?.productTitle || 'Your item';

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rationaleOpen, setRationaleOpen] = useState(false);

  // Previous-owner notes (editable once graded).
  const [notesDraft, setNotesDraft] = useState('');
  const [notesInit, setNotesInit] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await getItemStatus(itemId);
      if (res.success) setStatus(res.data);
    } catch {
      setError('Could not load item status.');
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(() => {
      setStatus((cur) => {
        if (cur && !TERMINAL.includes(cur.status) && cur.status !== 'GRADED' && cur.status !== 'ROUTED') {
          fetchStatus();
        }
        return cur;
      });
    }, POLLING_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const currentStepIdx = status ? STATUS_ORDER.indexOf(status.status) : 0;
  const grade = status?.grade;
  const label = intakePath === 'sell-used' ? 'Sell Used' : 'Return';

  // Seed the notes draft once status arrives.
  useEffect(() => {
    if (status && !notesInit) {
      setNotesDraft(status.ownerNotes || '');
      setNotesInit(true);
    }
  }, [status, notesInit]);

  const POST_GRADED = ['GRADED', 'ROUTED', 'IN_TRANSIT', 'LISTED', 'SOLD', 'DONATED', 'LIQUIDATED'];
  const canAddNotes = status && POST_GRADED.includes(status.status);

  const handleSaveNotes = async () => {
    setSavingNotes(true);
    setNotesSaved(false);
    try {
      const res = await updateItemNotes(itemId, notesDraft);
      if (res.success) {
        setNotesSaved(true);
        setStatus((cur) => (cur ? { ...cur, ownerNotes: res.data.ownerNotes } : cur));
        setTimeout(() => setNotesSaved(false), 2500);
      }
    } catch {
      /* surfaced inline below */
    } finally {
      setSavingNotes(false);
    }
  };

  return (
    <div className="flex">
      <div className="flex-1 min-w-0">
        <div className="max-w-2xl mx-auto px-4 py-10 font-sans">
          {loading ? (
            <div className="min-h-[50vh] flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
            </div>
          ) : error ? (
            <div className="text-center py-16">
              <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
              <p className="text-gray-600">{error}</p>
              <Link to="/orders" className="mt-4 inline-block text-sm text-[#FF9900] underline">Back to orders</Link>
            </div>
          ) : (
            <>
              {/* Header */}
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
                <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
                  <span className="uppercase tracking-widest font-semibold text-[#FF9900]">{label}</span>
                  <span>/</span>
                  <span>Status</span>
                </div>
                <h1 className="text-2xl font-black text-gray-900">{status?.product?.title || productTitle}</h1>
                <p className="text-sm text-gray-500 mt-1">
                  Current status: <span className="font-semibold text-gray-800">{status?.status?.replace(/_/g, ' ')}</span>
                </p>
              </motion.div>

              {/* Trust tier */}
              {status?.trustTier && (
                <div className="mb-8">
                  <TrustTierBadge tier={status.trustTier} showMessage />
                </div>
              )}

              {/* Step tracker */}
              <div className="relative mb-10">
                <div className="absolute top-5 left-5 right-5 h-0.5 bg-gray-100 z-0" />
                <div className="relative z-10 flex justify-between">
                  {STEPS.map((step, i) => {
                    const stepIdx = STATUS_ORDER.indexOf(step.key);
                    const done = currentStepIdx > stepIdx;
                    const active = currentStepIdx === stepIdx;
                    const Icon = step.icon;
                    return (
                      <motion.div
                        key={step.key}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.07 }}
                        className="flex flex-col items-center gap-2"
                      >
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300
                          ${done ? 'bg-emerald-500 border-emerald-500 text-white'
                            : active ? 'bg-[#FF9900] border-[#FF9900] text-black'
                            : 'bg-white border-gray-200 text-gray-300'}`}
                        >
                          {active && !TERMINAL.includes(status?.status) && status?.status === 'GRADING' ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : done ? (
                            <CheckCircle2 className="w-4 h-4" />
                          ) : (
                            <Icon className="w-4 h-4" />
                          )}
                        </div>
                        <span className={`text-[10px] font-semibold text-center leading-tight w-14
                          ${done ? 'text-emerald-600' : active ? 'text-[#FF9900]' : 'text-gray-300'}`}
                        >
                          {step.label}
                        </span>
                      </motion.div>
                    );
                  })}
                </div>
              </div>

              {/* Grade results */}
              {grade ? (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm"
                >
                  <div className="flex items-center gap-4 mb-5">
                    <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-white text-3xl font-black ${GRADE_COLORS[grade.grade] || 'bg-zinc-400'}`}>
                      {grade.grade}
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-400 font-semibold">Quality Score</p>
                      <p className="text-2xl font-black text-gray-900">{grade.qualityScore}<span className="text-base text-gray-400">/100</span></p>
                      <p className="text-xs text-gray-500 mt-0.5">Confidence: {grade.confidence}</p>
                    </div>
                  </div>

                  {/* Claim verification */}
                  <div className={`flex items-center gap-2 text-sm font-medium mb-4 px-3 py-2 rounded-xl ${
                    grade.returnClaimVerified ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-700'
                  }`}>
                    {grade.returnClaimVerified ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    {grade.returnClaimVerified ? 'Claim verified' : 'Claim could not be verified'}
                  </div>

                  {/* Defects */}
                  {grade.defects?.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-gray-600 mb-2">Defects found</p>
                      <ul className="space-y-1">
                        {grade.defects.map((d, i) => (
                          <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                            <span className="text-gray-400">•</span>
                            <span>
                              <span className="font-medium capitalize">{d.severity}</span>{' '}
                              {d.type}{d.location ? ` (${d.location})` : ''}
                              {d.description ? ` — ${d.description}` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Rationale (expandable) */}
                  {grade.rationale && (
                    <div className="border-t border-gray-100 pt-3">
                      <button
                        onClick={() => setRationaleOpen((o) => !o)}
                        className="flex items-center justify-between w-full text-sm font-semibold text-gray-700"
                      >
                        AI Rationale
                        <ChevronDown className={`w-4 h-4 transition-transform ${rationaleOpen ? 'rotate-180' : ''}`} />
                      </button>
                      {rationaleOpen && (
                        <p className="text-sm text-gray-600 leading-relaxed mt-2">{grade.rationale}</p>
                      )}
                    </div>
                  )}

                  {/* Routing decision (Phase A) */}
                  <div className="mt-5">
                    <RoutingRationale itemId={itemId} />
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key={status?.status}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-gray-50 border border-gray-200 rounded-2xl p-6"
                >
                  {status?.status === 'GRADING' && (
                    <>
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
                          <Recycle className="w-5 h-5 text-[#FF9900]" />
                        </div>
                        <div>
                          <p className="font-bold text-gray-900">AI grading in progress</p>
                          <p className="text-xs text-gray-500">Results in ~15 seconds</p>
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 leading-relaxed">
                        Our AI is analysing your photos to objectively grade the item's condition.
                        This page updates automatically.
                      </p>
                    </>
                  )}
                  {status?.status === 'INITIATED' && (
                    <p className="text-sm text-gray-600">Your {label.toLowerCase()} has been initiated. Upload your evidence photos to continue.</p>
                  )}
                  {status?.status === 'EVIDENCE_PENDING' && (
                    <p className="text-sm text-gray-600">Photos received. Preparing grading...</p>
                  )}
                  {status?.status === 'REJECTED' && (
                    <p className="text-sm text-red-600">This submission was rejected by our fraud checks and requires manual review.</p>
                  )}
                </motion.div>
              )}

              {/* Previous-owner notes — editable once graded (Phase B). */}
              {canAddNotes && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white border border-gray-200 rounded-2xl p-5 mt-6"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Pencil className="w-4 h-4 text-[#FF9900]" />
                    <p className="font-bold text-gray-900 text-sm">Notes for buyers</p>
                  </div>
                  <p className="text-xs text-gray-500 mb-3 leading-relaxed">
                    Add any honest details about this item — how you used it, what's included, why you're parting with it.
                    These notes appear on the resale listing.
                  </p>
                  <textarea
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    maxLength={2000}
                    rows={3}
                    placeholder="e.g. Bought last year, barely used, comes with original box and charger."
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF9900] resize-none"
                  />
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[11px] text-gray-400">{notesDraft.length}/2000</span>
                    <div className="flex items-center gap-2">
                      {notesSaved && (
                        <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Saved
                        </span>
                      )}
                      <button
                        onClick={handleSaveNotes}
                        disabled={savingNotes}
                        className="amz-btn-primary px-4 py-1.5 rounded-full text-xs font-semibold disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {savingNotes ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                        Save notes
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}

              <p className="text-xs text-gray-300 text-center mt-6">Item ID: {itemId}</p>
            </>
          )}
        </div>
      </div>

      <DeveloperLogsSidebar itemId={itemId} />
    </div>
  );
}
