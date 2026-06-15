import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, MapPin, ShieldAlert, Warehouse, Handshake, Sparkles, RefreshCw } from 'lucide-react';
import { computeRouting, getRoutingDecision } from '../../services/routing.service';

const PATH_LABELS = {
  resell: 'Resell',
  refurbish: 'Refurbish',
  'peer-redistribute': 'Peer handoff',
  donate: 'Donate',
  liquidate: 'Liquidate',
  'return-to-seller': 'Return to seller',
};

const REFUND_LABELS = {
  immediate: 'Refund issued immediately',
  'on-resolution': 'Refund on resolution',
  'on-inspection': 'Refund withheld — manual inspection required',
  rejected: 'Return rejected — no refund',
};

const PATH_COLOR = {
  resell: 'bg-violet-500',
  refurbish: 'bg-blue-500',
  'peer-redistribute': 'bg-emerald-500',
  donate: 'bg-teal-500',
  liquidate: 'bg-zinc-500',
  'return-to-seller': 'bg-red-500',
};

export default function RoutingRationale({ itemId, autoCompute = false }) {
  const [decision, setDecision] = useState(null);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await getRoutingDecision(itemId);
      setDecision(d);
    } catch (err) {
      if (err.response?.status === 404) {
        setDecision(null);
      } else {
        setError(err.response?.data?.message || 'Could not load routing decision.');
      }
    } finally {
      setLoading(false);
    }
  };

  const run = async () => {
    setComputing(true);
    setError(null);
    try {
      const d = await computeRouting({ itemId });
      setDecision(d);
    } catch (err) {
      setError(err.response?.data?.message || 'Routing failed.');
    } finally {
      setComputing(false);
    }
  };

  useEffect(() => {
    load().then(() => { if (autoCompute) run(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (!decision) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-3">
        <p className="text-sm text-zinc-400">This item hasn't been routed yet.</p>
        <button
          onClick={run}
          disabled={computing}
          className="inline-flex items-center gap-2 bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/40 disabled:opacity-40 text-violet-200 font-semibold px-4 py-2 rounded-xl text-sm transition-colors"
        >
          {computing
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Routing…</>
            : <><Sparkles className="w-4 h-4" /> Run routing engine</>}
        </button>
        {error && <p className="text-sm text-red-400 mt-1">{error}</p>}
      </div>
    );
  }

  const alts = decision.rankedAlternatives || [];
  const maxScore = Math.max(1, ...alts.map((a) => a.score));
  const winner = decision.chosenPath;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-white text-base">Disposition decision</h3>
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${
            winner === 'peer-redistribute' ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' :
            winner === 'resell' ? 'bg-violet-500/15 border-violet-500/30 text-violet-300' :
            winner === 'refurbish' ? 'bg-blue-500/15 border-blue-500/30 text-blue-300' :
            winner === 'donate' ? 'bg-teal-500/15 border-teal-500/30 text-teal-300' :
            winner === 'return-to-seller' ? 'bg-red-500/15 border-red-500/30 text-red-300' :
            'bg-zinc-700 border-zinc-600 text-zinc-300'
          }`}
        >
          {decision.chosenWarehouse?.code ? <Warehouse className="w-3.5 h-3.5" />
            : decision.matchWindow?.active ? <Handshake className="w-3.5 h-3.5" />
            : <Sparkles className="w-3.5 h-3.5" />}
          {PATH_LABELS[winner] || winner}
        </span>
      </div>

      {/* Hard gate */}
      {decision.hardGatesApplied?.length > 0 && (
        <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs px-3 py-2.5 rounded-xl">
          <ShieldAlert className="w-4 h-4 flex-shrink-0" />
          Hard gate: <span className="font-bold ml-1">{decision.hardGatesApplied.join(', ')}</span> — overrode scoring.
        </div>
      )}

      {/* Demand */}
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <MapPin className="w-3.5 h-3.5 text-violet-400" />
        {decision.demandSignal?.count ?? 0} nearby buyer(s) within {decision.demandSignal?.radiusKm ?? '—'} km
      </div>

      {/* Score bars */}
      <div className="space-y-2.5">
        {alts.map((a) => {
          const isWinner = a.path === winner;
          const pct = Math.max(3, (a.score / maxScore) * 100);
          const barColor = isWinner
            ? (PATH_COLOR[a.path] || 'bg-violet-500')
            : 'bg-zinc-700';
          return (
            <div key={a.path}>
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className={isWinner ? 'font-bold text-white' : 'text-zinc-500'}>
                  {PATH_LABELS[a.path] || a.path}
                </span>
                <span className="text-zinc-600">net ₹{a.netRecovery} · {a.score}</span>
              </div>
              <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.45 }}
                  className={`h-full rounded-full ${barColor}`}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Warehouse / peer hold */}
      {decision.chosenWarehouse?.code && (
        <div className="flex items-center gap-2 text-xs bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-zinc-300">
          <Warehouse className="w-4 h-4 text-zinc-500 flex-shrink-0" />
          <span>
            Best warehouse: <span className="font-semibold text-white">{decision.chosenWarehouse.name}</span>
            <span className="text-zinc-500"> — {decision.chosenWarehouse.city}
              {decision.chosenWarehouse.breakdown &&
                ` · ${decision.chosenWarehouse.breakdown.distanceKm} km · inbound ₹${decision.chosenWarehouse.breakdown.inbound}`}
            </span>
          </span>
        </div>
      )}
      {decision.matchWindow?.active && (
        <div className="flex items-center gap-2 text-xs bg-emerald-500/10 border border-emerald-500/25 rounded-xl px-3 py-2.5 text-emerald-300">
          <Handshake className="w-4 h-4 flex-shrink-0" />
          Holding at home {decision.matchWindow.hours}h — peer buyer match window active.
        </div>
      )}

      {/* Refund */}
      <div className={`text-xs px-3 py-2.5 rounded-xl border flex items-start gap-2 ${
        decision.refundHold
          ? 'bg-red-500/10 border-red-500/25 text-red-300'
          : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
      }`}>
        <span>💰</span>
        <span>
          {REFUND_LABELS[decision.refundTiming] || decision.refundTiming}
          {decision.refundHoldReason && (
            <span className="block mt-0.5 opacity-70">{decision.refundHoldReason}</span>
          )}
        </span>
      </div>

      {/* Recompute */}
      <button
        onClick={run}
        disabled={computing}
        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${computing ? 'animate-spin' : ''}`} />
        {computing ? 'Recomputing…' : 'Recompute'}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
