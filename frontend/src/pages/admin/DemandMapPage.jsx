import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, MapPin, Search } from 'lucide-react';
import { getDemandMap } from '../../services/demand.service';

// Hardcoded demo search terms (the plan's ~5-10 terms).
const TERMS = ['shoe', 'laptop', 'office chair', 'washing machine', 'smartphone', 'headphones', 'jacket', 'textbook'];

// Chhattisgarh viewport bounds (lng/lat) for the SVG coordinate projection.
const BOUNDS = { minLng: 80.5, maxLng: 84.0, minLat: 18.5, maxLat: 22.8 };
const W = 560;
const H = 640;

const project = ([lng, lat]) => {
  const x = ((lng - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng)) * W;
  const y = H - ((lat - BOUNDS.minLat) / (BOUNDS.maxLat - BOUNDS.minLat)) * H;
  return { x, y };
};

const demandColor = (d) => {
  if (d >= 75) return '#dc2626';
  if (d >= 40) return '#f59e0b';
  if (d > 0) return '#16a34a';
  return '#9ca3af';
};

/**
 * Admin Demand Map — searching a term overlays the real, normalized demand
 * (computed by the backend $geoNear algorithm over seeded buyer posts) on each
 * Chhattisgarh warehouse, visually demonstrating the warehouse-selection signal.
 */
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

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 font-sans">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-gray-900 flex items-center gap-2">
          <MapPin className="w-6 h-6 text-indigo-600" /> Demand Map — Chhattisgarh
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Search a product term to see normalized buyer demand near each warehouse. This is the real
          <span className="font-mono text-xs bg-gray-100 px-1 rounded mx-1">$geoNear</span>
          signal that powers best-warehouse selection.
        </p>
      </div>

      {/* Search terms */}
      <div className="flex flex-wrap gap-2 mb-6">
        {TERMS.map((t) => (
          <button
            key={t}
            onClick={() => setTerm(t)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              term === t ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
            }`}
          >
            <Search className="w-3.5 h-3.5" /> {t}
          </button>
        ))}
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl mb-4">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Map */}
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-2xl p-4 relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/60 z-10 rounded-2xl">
              <Loader2 className="w-7 h-7 animate-spin text-indigo-500" />
            </div>
          )}
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto bg-slate-50 rounded-xl border border-slate-100">
            {/* subtle grid */}
            {[...Array(7)].map((_, i) => (
              <line key={`v${i}`} x1={(i * W) / 6} y1="0" x2={(i * W) / 6} y2={H} stroke="#eef2f7" strokeWidth="1" />
            ))}
            {[...Array(8)].map((_, i) => (
              <line key={`h${i}`} x1="0" y1={(i * H) / 7} x2={W} y2={(i * H) / 7} stroke="#eef2f7" strokeWidth="1" />
            ))}

            {warehouses.map((w) => {
              const coords = w.warehouse?.location?.coordinates;
              if (!coords) return null;
              const { x, y } = project(coords);
              const r = 10 + (w.demand / 100) * 26;
              const color = demandColor(w.demand);
              return (
                <g key={w.warehouseCode}>
                  <motion.circle
                    cx={x} cy={y}
                    initial={{ r: 0, opacity: 0 }}
                    animate={{ r, opacity: 0.25 }}
                    transition={{ duration: 0.4 }}
                    fill={color}
                  />
                  <circle cx={x} cy={y} r="5" fill={color} />
                  <text x={x} y={y - r - 4} textAnchor="middle" className="fill-gray-700" fontSize="11" fontWeight="700">
                    {w.warehouse?.city} ({w.demand})
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Ranking */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <h3 className="font-bold text-gray-800 mb-3 text-sm">Demand for "{term}"</h3>
          <div className="space-y-2">
            {[...warehouses].sort((a, b) => b.demand - a.demand).map((w) => (
              <div key={w.warehouseCode} className="flex items-center gap-2">
                <span className="text-xs text-gray-600 w-28 truncate">{w.warehouse?.name}</span>
                <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${w.demand}%` }}
                    transition={{ duration: 0.5 }}
                    className="h-full rounded-full"
                    style={{ backgroundColor: demandColor(w.demand) }}
                  />
                </div>
                <span className="text-xs font-bold text-gray-700 w-12 text-right">{w.demand}</span>
                <span className="text-[10px] text-gray-400 w-8 text-right">({w.raw})</span>
              </div>
            ))}
            {warehouses.length === 0 && !loading && (
              <p className="text-sm text-gray-400">No warehouses seeded. Run <code className="text-xs">npm run seed:demand</code>.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
