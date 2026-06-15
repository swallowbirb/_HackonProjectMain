import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  X, Loader2, Package, Boxes, Truck, Warehouse, Tag, Home, Handshake, PackageCheck,
  MapPin, TrendingUp, RotateCcw, Award, Route, ChevronDown,
} from 'lucide-react';
import { getDemandMap } from '../../services/demand.service';
import { getRoutingDecision } from '../../services/routing.service';
import { rankWarehouses, demandTermForListing, inr, DEMO_CITIES, sourcePos } from '../../lib/routingDemo';
import RouteCheckpointTracker from '../shared/RouteCheckpointTracker';
import ResaleRouteMap from './ResaleRouteMap';

const INDIGO = '#4f46e5';

const WAREHOUSE_STEPS = (city, name) => [
  { key: 'picked_up', label: 'Picked up', sublabel: "Collected from reseller's location", icon: Package },
  { key: 'dispatched', label: 'Dispatched', sublabel: 'Left the origin facility', icon: Boxes },
  { key: 'in_transit', label: 'In transit', sublabel: `En route to ${city}`, icon: Truck },
  { key: 'arrived', label: `Arrived · ${city}`, sublabel: name, icon: Warehouse },
  { key: 'listed', label: 'Listed for resale', sublabel: 'Live on Second-Life', icon: Tag },
];

const PEER_STEPS = [
  { key: 'held', label: 'Held at home', sublabel: 'Matching a nearby buyer', icon: Home },
  { key: 'matched', label: 'Buyer matched', sublabel: 'Within demand radius', icon: Handshake },
  { key: 'handoff', label: 'Handing off', sublabel: 'Short local hop', icon: Truck },
  { key: 'delivered', label: 'Delivered to buyer', sublabel: 'Peer handoff complete', icon: PackageCheck },
];

const storageKey = (itemId) => `resellRoute:${itemId}`;

export default function ResaleRouteDetail({ listing, onClose }) {
  const itemId = listing.itemId;
  const term = useMemo(() => demandTermForListing(listing), [listing]);
  const isPeer = !!listing.peerRedistribute;

  const [loading, setLoading] = useState(true);
  const [warehouses, setWarehouses] = useState([]);
  const [ranked, setRanked] = useState([]);
  const [winner, setWinner] = useState(null);
  const [nearest, setNearest] = useState(null);
  const [destinationCode, setDestinationCode] = useState(null);
  const [sourceCity, setSourceCity] = useState(DEMO_CITIES[0].city); // default Raipur

  const [stepIndex, setStepIndex] = useState(() => {
    const saved = Number(localStorage.getItem(storageKey(itemId)));
    return Number.isFinite(saved) ? saved : 0;
  });

  const resaleValue = listing.suggestedPrice || listing.price || Math.round((listing.originalPrice || 0) * 0.6);

  // Fetch warehouses + routing decision once
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [mapData, decision] = await Promise.all([
        getDemandMap(term).catch(() => ({ warehouses: [] })),
        getRoutingDecision(itemId).catch(() => null),
      ]);
      if (cancelled) return;
      const whs = mapData?.warehouses || [];
      setWarehouses(whs);
      const src = sourcePos(sourceCity);
      const { ranked: r, winner: w, nearest: n } = rankWarehouses({
        warehouses: whs, resaleValue, category: listing.category, source: src,
      });
      setRanked(r);
      setWinner(w);
      setNearest(n);
      const chosen = decision?.chosenWarehouse?.code;
      setDestinationCode(chosen && r.some((x) => x.code === chosen) ? chosen : w?.code || null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [itemId, term]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-rank whenever the source city changes
  useEffect(() => {
    if (!warehouses.length) return;
    const src = sourcePos(sourceCity);
    const { ranked: r, winner: w, nearest: n } = rankWarehouses({
      warehouses, resaleValue, category: listing.category, source: src,
    });
    setRanked(r);
    setWinner(w);
    setNearest(n);
    setDestinationCode(w?.code || null);
    // Reset progress when city changes
    setStepIndex(0);
    localStorage.setItem(storageKey(itemId), '0');
  }, [sourceCity]); // eslint-disable-line react-hooks/exhaustive-deps

  const steps = isPeer
    ? PEER_STEPS
    : WAREHOUSE_STEPS(
        ranked.find((x) => x.code === destinationCode)?.city || 'warehouse',
        ranked.find((x) => x.code === destinationCode)?.name || ''
      );
  const lastIdx = steps.length - 1;
  const safeIndex = Math.min(stepIndex, lastIdx);
  const progress = lastIdx > 0 ? safeIndex / lastIdx : 0;

  const advance = () => {
    setStepIndex((i) => {
      const next = Math.min(i + 1, lastIdx);
      localStorage.setItem(storageKey(itemId), String(next));
      return next;
    });
  };
  const reset = () => {
    setStepIndex(0);
    localStorage.setItem(storageKey(itemId), '0');
  };

  const dest = ranked.find((x) => x.code === destinationCode);
  const maxScore = Math.max(1, ...ranked.map((r) => Math.abs(r.score)));

  const reason = useMemo(() => {
    if (!dest || !nearest) return '';
    const profit = dest.viable
      ? `We expect to recover ${inr(dest.netRecovery)} here (resale value × ${Math.round((dest.sellThrough || 0) * 100)}% sell-through − ₹${dest.inbound} shipping).`
      : `Even the best warehouse loses money at current demand — this item would be donated or liquidated instead.`;
    if (dest.code === nearest.code) {
      return `${dest.city} is both the closest hub (${dest.distanceKm} km) and carries the strongest demand for “${term}”. ${profit}`;
    }
    return `${dest.city} wins: its demand index of ${dest.demand}/100 for “${term}” makes it the highest expected-recovery hub, beating the nearest hub ${nearest.city} (${nearest.distanceKm} km) even though it's ${dest.distanceKm} km away. ${profit} Best warehouse, not nearest.`;
  }, [dest, nearest, term]);

  const img = listing.images?.[0] || 'https://picsum.photos/seed/resale/200/200';

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.97, opacity: 0, y: 16 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.97, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-[#F7F8FA] rounded-3xl shadow-2xl w-full max-w-6xl my-6 overflow-hidden"
      >
        {/* Header */}
        <div className="bg-white border-b border-gray-200 p-5 flex items-center gap-4">
          <img src={img} alt={listing.title} className="w-14 h-14 rounded-xl object-cover border border-gray-200 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-600">Resale route</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isPeer ? 'bg-violet-100 text-violet-700' : 'bg-indigo-100 text-indigo-700'}`}>
                {isPeer ? 'Peer handoff' : 'Warehouse → resale'}
              </span>
            </div>
            <p className="font-bold text-gray-900 truncate">{listing.title}</p>
            <p className="text-xs text-gray-500">
              Grade {listing.grade} · {listing.qualityScore}/100 · {inr(listing.price)} · demand {listing.demandCount || 0}
            </p>
          </div>
          {/* City picker */}
          <div className="relative flex-shrink-0">
            <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-0.5">
              <MapPin className="w-3 h-3" /> Reseller city
            </div>
            <div className="relative">
              <select
                value={sourceCity}
                onChange={(e) => setSourceCity(e.target.value)}
                className="appearance-none bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 pr-8 text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300 cursor-pointer"
              >
                {DEMO_CITIES.map((c) => (
                  <option key={c.city} value={c.city}>{c.city}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-gray-100 flex items-center justify-center flex-shrink-0">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {loading ? (
          <div className="h-96 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
          </div>
        ) : (
          <div className="p-5 space-y-5">
            {/* Top: checkpoints (left) + map (right) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Checkpoint rail */}
              <div className="bg-white border border-gray-200 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-gray-900 inline-flex items-center gap-1.5">
                    <Route className="w-4 h-4 text-indigo-500" /> Route checkpoints
                  </h3>
                  <button onClick={reset} title="Replay" className="text-gray-400 hover:text-indigo-600 transition-colors">
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>
                <RouteCheckpointTracker
                  steps={steps}
                  currentIndex={safeIndex}
                  onAdvance={advance}
                  accent={INDIGO}
                  advanceLabel="Advancing draws the route on the map →"
                />
              </div>

              {/* Map */}
              <div className="lg:col-span-2">
                <ResaleRouteMap ranked={ranked} destinationCode={destinationCode} progress={progress} term={term} sourceCity={sourceCity} />
              </div>
            </div>

            {/* Destination rationale */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Numbers */}
              <div className="bg-white border border-gray-200 rounded-2xl p-5">
                <h3 className="text-sm font-bold text-gray-900 inline-flex items-center gap-1.5 mb-3">
                  <MapPin className="w-4 h-4 text-indigo-500" /> Destination · {dest?.city || '—'}
                </h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                  <Num label="Distance" value={`${dest?.distanceKm ?? '—'} km`} />
                  <Num label="Demand index" value={`${dest?.demand ?? 0}/100`} highlight />
                  <Num label="Sell-through" value={`${Math.round((dest?.sellThrough ?? 0) * 100)}%`} />
                  <Num label="Inbound logistics" value={inr(dest?.inbound)} />
                  <Num label="Expected recovery" value={inr(dest?.netRecovery)} highlight />
                  <Num label="Profitable?" value={dest?.viable ? 'Yes ✓' : 'No'} />
                </div>
              </div>

              {/* Reason */}
              <div className="bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-200 rounded-2xl p-5 lg:col-span-2">
                <h3 className="text-sm font-bold text-indigo-900 inline-flex items-center gap-1.5 mb-2">
                  <Award className="w-4 h-4" /> Why {dest?.city}?
                </h3>
                <p className="text-sm text-indigo-900/80 leading-relaxed mb-4">{reason}</p>

                {/* Ranked comparison */}
                <div className="space-y-1.5">
                  {ranked.slice(0, 7).map((w) => {
                    const isWin = w.code === destinationCode;
                    const pct = Math.max(4, (Math.abs(w.score) / maxScore) * 100);
                    return (
                      <div key={w.code} className="flex items-center gap-2 text-xs">
                        <span className={`w-20 truncate ${isWin ? 'font-bold text-indigo-900' : 'text-gray-500'}`}>{w.city}</span>
                        <div className="flex-1 h-3 bg-white/60 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.5 }}
                            className="h-full rounded-full" style={{ backgroundColor: isWin ? INDIGO : '#c7d2fe' }}
                          />
                        </div>
                        <span className="w-10 text-right text-gray-400">{w.distanceKm}km</span>
                        <span className={`w-12 text-right ${isWin ? 'font-bold text-indigo-900' : 'text-gray-500'}`}>{w.score}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-indigo-900/50 mt-3">
                  expected recovery = resale value × sell-through(demand) − shipping cost · highest wins
                </p>
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

const Num = ({ label, value, highlight }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-gray-500">{label}</span>
    <span className={`font-bold ${highlight ? 'text-indigo-600' : 'text-gray-900'}`}>{value}</span>
  </div>
);
