import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, MapPin, ChevronLeft, Warehouse } from 'lucide-react';
import { getDemandMap } from '../../services/demand.service';

// Demo search terms.
const TERMS = ['shoe', 'laptop', 'office chair', 'washing machine', 'smartphone', 'headphones', 'jacket', 'textbook'];

// Chhattisgarh viewport bounds (lng/lat) for the SVG projection.
const BOUNDS = { minLng: 80.5, maxLng: 84.0, minLat: 18.5, maxLat: 22.8 };
const W = 560;
const H = 620;
const PAD = 40;

const project = ([lng, lat]) => {
  const x = PAD + ((lng - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng)) * (W - PAD * 2);
  const y = H - PAD - ((lat - BOUNDS.minLat) / (BOUNDS.maxLat - BOUNDS.minLat)) * (H - PAD * 2);
  return { x, y };
};

// Heat scale tuned for a dark background.
const heat = (d) => {
  if (d >= 70) return '#f87171'; // hot — red
  if (d >= 40) return '#fbbf24'; // warm — amber
  if (d > 0) return '#34d399';   // cool — emerald
  return '#52525b';              // none — zinc
};

export default function DemandMapPage() {
  const [term, setTerm] = useState('shoe');
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = (t) => {
    setLoading(true);
    setError(null);
    getDemandMap(t)
      .then((data) => setWarehouses(data?.warehouses || []))
      .catch((e) => setError(e.response?.data?.message || 'Failed to load demand map.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(term); /* eslint-disable-next-line */ }, [term]);

  const ranked = [...warehouses].sort((a, b) => b.demand - a.demand);
  const top = ranked[0];

  return (
    <div className="min-h-screen bg-black text-white font-sans">
      {/* Header */}
      <div className="border-b border-zinc-900 bg-black/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/admin/dashboard"
              className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </Link>
            <div className="w-9 h-9 rounded-xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
              <MapPin className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Demand Map — Chhattisgarh</h1>
              <p className="text-xs text-zinc-500">Geo-demand signal powering warehouse selection</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-5">
        <p className="text-sm text-zinc-400 max-w-2xl leading-relaxed">
          Pick a product term to see live buyer demand near each warehouse, computed by a
          <span className="text-zinc-200 font-mono text-xs bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded mx-1">$geoNear</span>
          distance-decay query over seeded "Looking for…" posts. This is the same signal the routing
          engine uses to pick the best — not nearest — warehouse.
        </p>

        {/* Term selector */}
        <div className="flex flex-wrap gap-2">
          {TERMS.map((t) => (
            <button
              key={t}
              onClick={() => setTerm(t)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                term === t
                  ? 'bg-violet-500/20 text-violet-200 border-violet-500/40'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-200'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-300 text-sm px-4 py-3 rounded-xl">{error}</div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Map */}
          <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 relative overflow-hidden">
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/70 z-10 rounded-2xl">
                <Loader2 className="w-7 h-7 animate-spin text-violet-400" />
              </div>
            )}
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#18181b" strokeWidth="1" />
                </pattern>
              </defs>
              <rect x="0" y="0" width={W} height={H} rx="14" fill="#09090b" />
              <rect x="0" y="0" width={W} height={H} rx="14" fill="url(#grid)" />

              {warehouses.map((w) => {
                const coords = w.warehouse?.location?.coordinates;
                if (!coords) return null;
                const { x, y } = project(coords);
                const color = heat(w.demand);
                const ring = 14 + (w.demand / 100) * 34;
                const isTop = top && w.warehouseCode === top.warehouseCode && w.demand > 0;
                return (
                  <g key={w.warehouseCode}>
                    {/* heat halo */}
                    <motion.circle
                      cx={x} cy={y}
                      initial={{ r: 0, opacity: 0 }}
                      animate={{ r: ring, opacity: 0.18 }}
                      transition={{ duration: 0.45 }}
                      fill={color}
                    />
                    {isTop && (
                      <motion.circle
                        cx={x} cy={y} fill="none" stroke={color} strokeWidth="1.5"
                        initial={{ r: ring, opacity: 0.6 }}
                        animate={{ r: ring + 10, opacity: 0 }}
                        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
                      />
                    )}
                    {/* pin */}
                    <circle cx={x} cy={y} r="5" fill={color} stroke="#09090b" strokeWidth="1.5" />
                    {/* label */}
                    <text x={x} y={y - ring - 8} textAnchor="middle" fontSize="12" fontWeight="700" fill="#e4e4e7">
                      {w.warehouse?.city}
                    </text>
                    <text x={x} y={y - ring + 6} textAnchor="middle" fontSize="11" fontWeight="600" fill={color}>
                      {w.demand}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Legend */}
            <div className="flex items-center gap-4 mt-3 px-1 text-xs text-zinc-500">
              <span className="font-medium text-zinc-400">Demand</span>
              {[['#34d399', 'Low'], ['#fbbf24', 'Medium'], ['#f87171', 'High']].map(([c, label]) => (
                <span key={label} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c }} />
                  {label}
                </span>
              ))}
            </div>
          </div>

          {/* Ranking */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            {top && top.demand > 0 && (
              <div className="mb-4 bg-violet-500/10 border border-violet-500/20 rounded-xl p-3">
                <p className="text-[11px] uppercase tracking-wider text-violet-300/70 font-semibold mb-1">Best warehouse for "{term}"</p>
                <p className="flex items-center gap-1.5 text-sm font-bold text-white">
                  <Warehouse className="w-4 h-4 text-violet-400" />
                  {top.warehouse?.name}
                </p>
                <p className="text-xs text-zinc-500 mt-0.5">{top.warehouse?.city} · demand {top.demand}/100</p>
              </div>
            )}

            <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-3">All warehouses</h3>
            <div className="space-y-3">
              {ranked.map((w) => (
                <div key={w.warehouseCode}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-zinc-300 font-medium truncate">{w.warehouse?.city}</span>
                    <span className="text-zinc-500">
                      <span className="font-bold text-zinc-300">{w.demand}</span> · {w.raw} want{w.raw === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${w.demand}%` }}
                      transition={{ duration: 0.5 }}
                      className="h-full rounded-full"
                      style={{ backgroundColor: heat(w.demand) }}
                    />
                  </div>
                </div>
              ))}
              {warehouses.length === 0 && !loading && (
                <p className="text-sm text-zinc-500">
                  No warehouses seeded. Run <code className="text-xs bg-zinc-800 px-1 rounded">node seed-demand.js</code>.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
