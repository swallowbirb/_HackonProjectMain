import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Check, X, Loader2, ShieldQuestion, ChevronDown } from 'lucide-react';

/**
 * PendingAuthorizationCard — Phase 8 extension. Shows a return whose AI grade was
 * flagged for human review, and gives the seller (or admin) authority to APPROVE
 * (optionally overriding the grade) so it routes, or REJECT (deny the return).
 */

const GRADE_OPTIONS = ['A', 'B', 'C', 'D'];

const severityCls = (sev) => {
  switch (sev) {
    case 'major': return 'bg-red-500/10 text-red-400 border-red-500/20';
    case 'moderate': return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    default: return 'bg-zinc-700/40 text-zinc-300 border-zinc-600';
  }
};

const PendingAuthorizationCard = ({ entry, onApprove, onReject, busy }) => {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState('');
  const [mode, setMode] = useState(null); // 'approve' | 'reject' | null

  const images = Array.isArray(entry.evidenceImages) ? entry.evidenceImages : [];

  const handleApprove = () => {
    onApprove(entry.itemId, { notes });
  };

  const handleReject = () => {
    onReject(entry.itemId, { notes });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900 border border-amber-500/30 rounded-2xl p-5 space-y-4"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-zinc-100 truncate">{entry.title}</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            {entry.grade ? `AI Grade ${entry.grade}` : '—'}
            {entry.qualityScore != null ? ` · ${entry.qualityScore}/100` : ''}
            {entry.confidence ? ` · confidence: ${entry.confidence}` : ''}
            {entry.reasonCode ? ` · reason: ${entry.reasonCode}` : ''}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border bg-amber-500/10 text-amber-400 border-amber-500/20 whitespace-nowrap">
          <ShieldQuestion className="w-3 h-3" /> Needs your authorization
        </span>
      </div>

      {/* Why flagged */}
      <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-amber-400">Flagged for human review</p>
          <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">{entry.flagReason}</p>
        </div>
      </div>

      {/* Evidence thumbnails */}
      {images.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((src, i) => (
            <a key={i} href={src} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
              <img
                src={src}
                alt={`Evidence ${i + 1}`}
                className="w-16 h-16 object-cover rounded-lg border border-zinc-700 hover:border-zinc-500 transition-colors"
              />
            </a>
          ))}
        </div>
      )}

      {/* Expandable detail: rationale + defects */}
      {(entry.rationale || (entry.defects && entry.defects.length > 0)) && (
        <div>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-1 transition-colors"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            {expanded ? 'Hide' : 'Show'} AI assessment &amp; defects
          </button>
          {expanded && (
            <div className="mt-2 space-y-2">
              {entry.rationale && (
                <p className="text-xs text-zinc-400 leading-relaxed bg-zinc-950/40 border border-zinc-800 rounded-lg p-3">
                  {entry.rationale}
                </p>
              )}
              {entry.defects && entry.defects.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {entry.defects.map((d, i) => (
                    <span key={i} className={`text-[11px] px-2 py-0.5 rounded-full border ${severityCls(d.severity)}`}>
                      {d.severity} {d.type}{d.location ? ` (${d.location})` : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Action zone */}
      {mode === null && (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setMode('approve')}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 text-sm bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-4 py-2 rounded-xl font-medium hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
          >
            <Check className="w-4 h-4" /> Approve &amp; route
          </button>
          <button
            onClick={() => setMode('reject')}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 text-sm bg-red-500/10 text-red-400 border border-red-500/20 px-4 py-2 rounded-xl font-medium hover:bg-red-500/20 transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" /> Reject return
          </button>
        </div>
      )}

      {/* Approve confirm */}
      {mode === 'approve' && (
        <div className="space-y-3 bg-zinc-950/40 border border-emerald-500/20 rounded-xl p-3">
          <p className="text-xs text-zinc-400">
            Approving accepts the AI grade <span className="text-emerald-400 font-medium">{entry.grade}</span> as-is and
            routes this return for resale. The grade cannot be changed.
          </p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes (why you approved)…"
            rows={2}
            className="w-full text-xs bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 resize-none"
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleApprove}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 text-sm bg-emerald-500 text-white px-4 py-2 rounded-xl font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Confirm approve
            </button>
            <button
              onClick={() => setMode(null)}
              disabled={busy}
              className="text-sm text-zinc-400 border border-zinc-700 px-4 py-2 rounded-xl font-medium hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Reject confirm */}
      {mode === 'reject' && (
        <div className="space-y-3 bg-zinc-950/40 border border-red-500/20 rounded-xl p-3">
          <p className="text-xs text-zinc-400">
            Rejecting denies this return. The item will be marked <span className="text-red-400 font-medium">REJECTED</span> and
            no resale listing is created.
          </p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional reason for rejection…"
            rows={2}
            className="w-full text-xs bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-red-500/50 resize-none"
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleReject}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 text-sm bg-red-500 text-white px-4 py-2 rounded-xl font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
              Confirm reject
            </button>
            <button
              onClick={() => setMode(null)}
              disabled={busy}
              className="text-sm text-zinc-400 border border-zinc-700 px-4 py-2 rounded-xl font-medium hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default PendingAuthorizationCard;
