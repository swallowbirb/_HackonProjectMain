import React from 'react';
import { motion } from 'framer-motion';
import { Truck, Package, Handshake, Gift, Recycle, CornerUpLeft, Loader2 } from 'lucide-react';

/**
 * SellerReturnCard — Phase 8, Part D. A minimal, map-free card showing one
 * returned product's emulated logistics journey + the seller's loss view.
 * Plain text + a simple progress bar. No map, no tracking dot.
 */

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

const STATUS_PILL = {
  awaiting_pickup: { label: 'Awaiting pickup', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  in_transit: { label: 'In transit', cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  arrived: { label: 'Arrived', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  delivered: { label: 'Delivered', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  cancelled: { label: 'Cancelled', cls: 'bg-zinc-700 text-zinc-300 border-zinc-600' },
};

const destIcon = (destinationType) => {
  switch (destinationType) {
    case 'peer': return Handshake;
    case 'ngo': return Gift;
    case 'liquidator': return Recycle;
    case 'seller': return CornerUpLeft;
    default: return Truck;
  }
};

const SellerReturnCard = ({ entry, onPickup, busy }) => {
  const ship = entry.shipment || {};
  const fin = ship.financials || null;
  const isPeer = ship.destinationType === 'peer';
  const pill = STATUS_PILL[ship.status] || STATUS_PILL.awaiting_pickup;
  const progressPct = Math.round((ship.progress || 0) * 100);
  const Icon = destIcon(ship.destinationType);

  const netSoFarNeg = fin && fin.netSoFar < 0;
  const projNetNeg = fin && fin.projectedNet < 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-zinc-100 truncate">{entry.title}</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            {entry.grade ? `Grade ${entry.grade} · ` : ''}
            {entry.category || '—'}
            {entry.reasonCode ? ` · Return reason: ${entry.reasonCode}` : ''}
          </p>
        </div>
        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ${pill.cls}`}>
          {isPeer ? 'Peer handoff' : pill.label}
        </span>
      </div>

      {/* Status line + progress */}
      <div className="space-y-2">
        <p className="text-sm text-zinc-300 flex items-center gap-2">
          <Icon className="w-4 h-4 text-zinc-400 flex-shrink-0" />
          <span>{ship.statusLine || 'Awaiting pickup from customer'}</span>
        </p>
        {ship.status !== 'awaiting_pickup' && (
          <div>
            <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
              <motion.div
                className={`h-full rounded-full ${progressPct >= 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
                initial={{ width: 0 }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.6 }}
              />
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">{progressPct}%</p>
          </div>
        )}
      </div>

      {/* Financials */}
      {fin && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs bg-zinc-950/40 border border-zinc-800 rounded-xl p-3">
          <Stat label="Original price" value={inr(fin.originalPrice)} />
          <Stat
            label={fin.refundPending ? 'Refund (held)' : 'Refund paid'}
            value={fin.refundPending ? 'Pending' : inr(fin.refundPaid)}
            muted={fin.refundPending}
          />
          <Stat label="Logistics cost so far" value={inr(fin.logisticsCostSoFar)} />
          <Stat label="Projected recovery" value={inr(fin.projectedRecovery)} />
          <Stat label="Net so far" value={inr(fin.netSoFar)} negative={netSoFarNeg} />
          <Stat label="Projected net" value={inr(fin.projectedNet)} negative={projNetNeg} />
        </div>
      )}

      {fin?.note && <p className="text-[10px] text-zinc-600 italic">{fin.note}</p>}

      {/* Pickup button — only before pickup, only when routed */}
      {ship.status === 'awaiting_pickup' && entry.itemStatus === 'ROUTED' && (
        <button
          onClick={() => onPickup(entry.itemId)}
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-2 text-sm bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-4 py-2 rounded-xl font-medium hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
          Mark picked up from customer
        </button>
      )}
    </motion.div>
  );
};

const Stat = ({ label, value, negative, muted }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-zinc-500">{label}</span>
    <span className={`font-semibold ${negative ? 'text-red-400' : muted ? 'text-amber-400' : 'text-zinc-200'}`}>
      {value}
    </span>
  </div>
);

export default SellerReturnCard;
