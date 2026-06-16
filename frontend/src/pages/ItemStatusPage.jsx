import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { getItemStatus } from '../services/item.service';
import DeveloperLogsSidebar from '../components/shared/DeveloperLogsSidebar';
import {
  Loader2, CheckCircle2, AlertCircle, AlertTriangle, FlaskConical, X,
} from 'lucide-react';

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

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  const grade = status?.grade;

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
            <div className="min-h-[60vh] flex flex-col items-center justify-center text-center">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-md">
                <motion.div
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 220, damping: 16 }}
                  className="mb-7 inline-flex"
                >
                  <div className="w-20 h-20 rounded-3xl bg-emerald-50 flex items-center justify-center">
                    <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                  </div>
                </motion.div>
                <h1 className="text-2xl font-black text-gray-900">
                  {status?.intakePath === 'sell-used' ? 'Your Item Is Being Processed' : 'Your Return Is Processing'}
                </h1>
                <p className="text-base text-gray-600 mt-3">
                  Check{' '}
                  <Link to="/orders" className="text-[#FF9900] font-semibold underline underline-offset-2">
                    Returns &amp; Orders
                  </Link>{' '}
                  for more info!
                </p>
              </motion.div>
            </div>
          )}
        </div>
      </div>

      <DeveloperLogsSidebar itemId={itemId} />

      {/* Dev-only: full grade is hidden from the user but visible here for the prototype. */}
      <DevGradePanel status={status} grade={grade} />
    </div>
  );
}

// --- Dev-only floating panel (bottom-left) showing the hidden grade ---
function DevGradePanel({ status, grade }) {
  const isDev = process.env.NODE_ENV !== 'production' || import.meta.env?.DEV;
  const [open, setOpen] = useState(false);
  if (!isDev) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[9999] font-sans">
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 bg-zinc-900 hover:bg-zinc-800 text-white px-4 py-2.5 rounded-full shadow-2xl font-semibold text-xs border border-zinc-700 cursor-pointer"
      >
        <FlaskConical className="w-4 h-4 text-amber-400" />
        <span>Dev: Grade</span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="absolute bottom-14 left-0 w-80 bg-zinc-950/95 backdrop-blur-md border border-zinc-800 rounded-3xl p-5 shadow-2xl text-white space-y-3"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <FlaskConical className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-sm">AI Grade (Dev)</h3>
              </div>
              <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[10px] font-semibold text-amber-400/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2 py-1 text-center">
              Showing only for this prototype
            </p>

            <div className="text-[11px] text-zinc-400">
              Status: <span className="font-mono text-zinc-200">{status?.status?.replace(/_/g, ' ') || '—'}</span>
            </div>

            {grade ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white text-2xl font-black ${GRADE_COLORS[grade.grade] || 'bg-zinc-600'}`}>
                    {grade.grade}
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-zinc-500 font-semibold">Quality Score</p>
                    <p className="text-xl font-black text-white">
                      {grade.qualityScore}<span className="text-sm text-zinc-500">/100</span>
                    </p>
                    {grade.confidence != null && (
                      <p className="text-[10px] text-zinc-500">Confidence: {grade.confidence}</p>
                    )}
                  </div>
                </div>

                <div className={`flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-xl ${
                  grade.returnClaimVerified ? 'bg-emerald-950/40 text-emerald-300' : 'bg-orange-950/40 text-orange-300'
                }`}>
                  {grade.returnClaimVerified ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                  {grade.returnClaimVerified ? 'Claim verified' : 'Claim not verified'}
                </div>

                {grade.defects?.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">Defects</p>
                    <ul className="space-y-1">
                      {grade.defects.map((d, i) => (
                        <li key={i} className="text-[11px] text-zinc-300 flex items-start gap-1.5">
                          <span className="text-zinc-600">•</span>
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

                {grade.rationale && (
                  <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-2.5">
                    <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">AI Rationale</p>
                    <p className="text-[11px] text-zinc-300 leading-relaxed">{grade.rationale}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[11px] text-zinc-500 bg-zinc-900/50 border border-zinc-800 rounded-xl p-3">
                <AlertTriangle className="w-3.5 h-3.5 text-zinc-600" />
                <span>No grade yet — still processing in the background.</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
