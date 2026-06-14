import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, MapPin, ShieldAlert, Warehouse, Handshake, Sparkles } from 'lucide-react';
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
  immediate: 'Refunded immediately',
  'on-resolution': 'Refund on resolution',
  'on-inspection': 'Refund withheld — manual verification required',
  rejected: 'Return rejected — no refund',
};

/**
 * RoutingRationale — visualises a routing decision: six ₹-labelled score bars,
 * the winner, any hard-gate badge, the refund-hold notice, the nearby-demand
 * count, and the chosen warehouse.
 *
 * Props: { itemId, autoCompute=false }
 */
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
        setDecision(null); // not routed yet
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
    load().then(() => {
      if (autoCompute) run();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-zinc-400" /></div>;
  }

  if (!decision) {
    return (
      <div className="border border-gray-200 rounded-2xl p-5 bg-white">
        <p className="text-sm text-gray-500 mb-3">This item hasn't been routed yet.</p>
        <button
          onClick={run}
          disabled={computing}
          className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-bold px-4 py-2 rounded-xl text-sm"
        >
          {computing ? <><Loader2 className="w-4 h-4 animate-spin" /> Routing…</> : <><Sparkles className="w-4 h-4" /> Run routing engine</>}
        </button>
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
      </div>
    );
  }

  const alts = decision.rankedAlternatives || [];
  const maxScore = Math.max(1, ...alts.map((a) => a.score));
  const winner = decision.chosenPath;

  return (
    <div className="border border-gray-200 rounded-2xl p-5 bg-white space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-black text-gray-900 text-lg">Disposition decision</h3>
        <span className="inline-flex items-center gap-1.5 bg-indigo-100 text-indigo-700 font-bold px-3 py-1 rounded-full text-sm">
          {decision.chosenWarehouse?.code ? <Warehouse className="w-4 h-4" /> : decision.matchWindow?.active ? <Handshake className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
          {PATH_LABELS[winner] || winner}
        </span>
      </div>

      {/* Hard gate badge */}
      {decision.hardGatesApplied?.length > 0 && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2 rounded-xl">
          <ShieldAlert className="w-4 h-4 flex-shrink-0" />
          <span>Hard gate: <strong>{decision.hardGatesApplied.join(', ')}</strong> — overrode the score.</span>
        </div>
      )}

      {/* Nearby demand */}
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <MapPin className="w-4 h-4 text-indigo-500" />
        📍 {decision.demandSignal?.count ?? 0} buyer(s) within {decision.demandSignal?.radiusKm ?? '—'} km
      </div>

      {/* Score bars */}
      <div className="space-y-2">
        {alts.map((a) => {
          const isWinner = a.path === winner;
          const pct = Math.max(4, (a.score / maxScore) * 100);
          return (
            <div key={a.path}>
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className={isWinner ? 'font-bold text-gray-900' : 'text-gray-500'}>
                  {PATH_LABELS[a.path] || a.path}
                </span>
                <span className="text-gray-400">net ₹{a.netRecovery} · score {a.score}</span>
              </div>
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.5 }}
                  className={`h-full rounded-full ${isWinner ? 'bg-indigo-600' : 'bg-gray-300'}`}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Chosen warehouse / peer hold */}
      {decision.chosenWarehouse?.code && (
        <div className="text-sm bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
          <Warehouse className="w-4 h-4 inline mr-1.5 text-gray-500" />
          Best warehouse: <strong>{decision.chosenWarehouse.name}</strong> ({decision.chosenWarehouse.city})
          {decision.chosenWarehouse.breakdown && (
            <span className="text-gray-400"> · {decision.chosenWarehouse.breakdown.distanceKm} km · inbound ₹{decision.chosenWarehouse.breakdown.inbound}</span>
          )}
        </div>
      )}
      {decision.matchWindow?.active && (
        <div className="text-sm bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-emerald-800">
          <Handshake className="w-4 h-4 inline mr-1.5" />
          Holding at home {decision.matchWindow.hours}h for a nearby peer buyer — no warehouse leg.
        </div>
      )}

      {/* Refund notice */}
      <div className={`text-sm px-3 py-2 rounded-xl border ${decision.refundHold ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
        💰 {REFUND_LABELS[decision.refundTiming] || decision.refundTiming}
        {decision.refundHoldReason && <span className="block text-xs mt-0.5 opacity-80">{decision.refundHoldReason}</span>}
      </div>

      <button
        onClick={run}
        disabled={computing}
        className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
      >
        {computing ? 'Recomputing…' : '↻ Recompute'}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
