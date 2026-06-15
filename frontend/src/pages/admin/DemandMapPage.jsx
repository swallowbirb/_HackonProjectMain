import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, MapPin, Move, Ruler, RotateCcw, Search, SlidersHorizontal, Users } from 'lucide-react';
import { getDemandMap, getPeerBuyerMap, getPopulatorConfig } from '../../services/demand.service';
import PopulatorSidebar from './PopulatorSidebar';

// Default demo search terms (the populator can add/remove tags at runtime).
const DEFAULT_TERMS = ['shoe', 'laptop', 'office chair', 'washing machine', 'smartphone', 'headphones', 'jacket', 'textbook'];

const W = 560;
const H = 640;

// How many real-world km the full map width represents. Distances on this map
// are derived purely from on-screen pixel positions, then scaled to a readable
// km value with this factor (and also reported normalized 0-100).
const MAP_WIDTH_KM = 320;
const KM_PER_PX = MAP_WIDTH_KM / W;

// Evenly-spread layout (fractions of the viewport) so warehouse pins never
// overlap — loosely mirrors Chhattisgarh geography but with clean spacing.
// Falls back to a real lng/lat projection for any unmapped warehouse.
const LAYOUT = {
  'BILASPUR-01': { fx: 0.46, fy: 0.15 },
  'KORBA-01': { fx: 0.80, fy: 0.23 },
  'RAIGARH-01': { fx: 0.85, fy: 0.48 },
  'RAIPUR-01': { fx: 0.50, fy: 0.50 },
  'BHILAI-01': { fx: 0.22, fy: 0.54 },
  'DURG-01': { fx: 0.18, fy: 0.82 },
  'JAGDALPUR-01': { fx: 0.56, fy: 0.85 },
};

const BOUNDS = { minLng: 80.5, maxLng: 84.0, minLat: 18.5, maxLat: 22.8 };
const projectGeo = ([lng, lat]) => ({
  x: ((lng - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng)) * W,
  y: H - ((lat - BOUNDS.minLat) / (BOUNDS.maxLat - BOUNDS.minLat)) * H,
});

const defaultPositionFor = (w) => {
  const slot = LAYOUT[w.warehouseCode];
  if (slot) return { x: slot.fx * W, y: slot.fy * H };
  const coords = w.warehouse?.location?.coordinates;
  return coords ? projectGeo(coords) : null;
};

// Two view modes for the map.
const MODES = {
  demand: {
    key: 'demand',
    label: 'Search Demand',
    icon: Search,
    accent: '#dc2626',
    fetch: getDemandMap,
    blurb: (term) => `Normalized buyer search demand for “${term}” near each warehouse.`,
    panelTitle: (term) => `Search demand for “${term}”`,
  },
  peers: {
    key: 'peers',
    label: 'Peer Buyers Nearby',
    icon: Users,
    accent: '#7c3aed',
    fetch: getPeerBuyerMap,
    blurb: (term) => `Nearby peer buyers ready for an instant handoff of a “${term}” right now.`,
    panelTitle: (term) => `Peer buyers ready for “${term}”`,
  },
};

const colorFor = (mode, d) => {
  if (d <= 0) return '#9ca3af';
  if (mode === 'peers') {
    if (d >= 75) return '#7c3aed';
    if (d >= 40) return '#a78bfa';
    return '#c4b5fd';
  }
  if (d >= 75) return '#dc2626';
  if (d >= 40) return '#f59e0b';
  return '#16a34a';
};

// Color a normalized distance (0 = closest, 100 = farthest on the map).
const distColor = (norm) => {
  if (norm <= 33) return '#16a34a';
  if (norm <= 66) return '#f59e0b';
  return '#dc2626';
};

const pixelDist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Admin Demand Map — searching a term overlays a per-warehouse signal on each
 * Chhattisgarh warehouse. Toggle between buyer Search Demand and live Peer
 * Buyers Nearby (peer-to-peer handoff readiness) for the same term.
 *
 * Pins are draggable: distances between warehouses are computed live from their
 * on-screen positions (this map only) — drag any pin to reshape the distances.
 */
export default function DemandMapPage() {
  const [term, setTerm] = useState('shoe');
  const [mode, setMode] = useState('demand');
  const [tags, setTags] = useState(DEFAULT_TERMS);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [populatorOpen, setPopulatorOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Live, draggable pin positions keyed by warehouseCode. Seeded from the
  // default layout; preserved across term/mode changes (codes are stable).
  const [positions, setPositions] = useState({});
  const [showDistances, setShowDistances] = useState(true);
  const [originCode, setOriginCode] = useState(null);

  const svgRef = useRef(null);
  const dragRef = useRef(null); // warehouseCode being dragged
  const movedRef = useRef(false);
  const startRef = useRef(null);

  const active = MODES[mode];

  // Load the live tag list (built-in + custom) for the pills.
  useEffect(() => {
    getPopulatorConfig()
      .then((cfg) => { if (cfg?.tags?.length) setTags(cfg.tags); })
      .catch(() => { /* keep defaults */ });
  }, []);

  // Keep the selected term valid when tags change (e.g. a custom tag removed).
  useEffect(() => {
    if (tags.length && !tags.includes(term)) setTerm(tags[0]);
  }, [tags]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    active
      .fetch(term)
      .then((data) => {
        if (cancelled) return;
        const list = data?.warehouses || [];
        setWarehouses(list);
        // Seed positions for any warehouse we haven't placed yet, keeping any
        // the admin has already dragged.
        setPositions((prev) => {
          const next = { ...prev };
          list.forEach((w) => {
            if (!next[w.warehouseCode]) {
              const p = defaultPositionFor(w);
              if (p) next[w.warehouseCode] = p;
            }
          });
          return next;
        });
      })
      .catch((e) => { if (!cancelled) setError(e.response?.data?.message || 'Failed to load map.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [term, mode, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Distance model (derived purely from on-screen pin positions) ──────────
  const placed = useMemo(
    () =>
      warehouses
        .map((w) => ({
          code: w.warehouseCode,
          city: w.warehouse?.city || w.warehouseCode,
          name: w.warehouse?.name || w.warehouseCode,
          pos: positions[w.warehouseCode],
        }))
        .filter((w) => w.pos),
    [warehouses, positions]
  );

  const maxPairPx = useMemo(() => {
    let max = 0;
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const d = pixelDist(placed[i].pos, placed[j].pos);
        if (d > max) max = d;
      }
    }
    return max;
  }, [placed]);

  // Distances from the selected origin to every other warehouse, sorted near→far.
  const originDistances = useMemo(() => {
    if (!originCode) return [];
    const origin = placed.find((p) => p.code === originCode);
    if (!origin) return [];
    return placed
      .filter((p) => p.code !== originCode)
      .map((p) => {
        const px = pixelDist(origin.pos, p.pos);
        return {
          code: p.code,
          city: p.city,
          name: p.name,
          pos: p.pos,
          km: px * KM_PER_PX,
          norm: maxPairPx ? Math.round((px / maxPairPx) * 100) : 0,
        };
      })
      .sort((a, b) => a.km - b.km);
  }, [originCode, placed, maxPairPx]);

  const originPos = originCode ? placed.find((p) => p.code === originCode)?.pos : null;

  // ── Drag handling (convert client coords → SVG viewBox coords) ────────────
  const toSvgPoint = (e) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const onPinDown = (e, code) => {
    e.stopPropagation();
    dragRef.current = code;
    movedRef.current = false;
    startRef.current = toSvgPoint(e);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onSvgMove = (e) => {
    if (!dragRef.current) return;
    const p = toSvgPoint(e);
    const start = startRef.current;
    if (start && pixelDist(p, start) > 4) movedRef.current = true;
    const pad = 26;
    const x = Math.max(pad, Math.min(W - pad, p.x));
    const y = Math.max(pad, Math.min(H - pad, p.y));
    setPositions((prev) => ({ ...prev, [dragRef.current]: { x, y } }));
  };

  const onSvgUp = () => {
    const code = dragRef.current;
    dragRef.current = null;
    // A press without movement = click → toggle this warehouse as the origin.
    if (code && !movedRef.current) {
      setOriginCode((prev) => (prev === code ? null : code));
    }
  };

  const resetLayout = () => {
    const next = {};
    warehouses.forEach((w) => {
      const p = defaultPositionFor(w);
      if (p) next[w.warehouseCode] = p;
    });
    setPositions(next);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 font-sans">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 flex items-center gap-2">
            <MapPin className="w-6 h-6 text-indigo-600" /> Demand Map — Chhattisgarh
          </h1>
          <p className="text-sm text-gray-500 mt-1">{active.blurb(term)}</p>
        </div>
        <button
          onClick={() => setPopulatorOpen(true)}
          className="shrink-0 inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 transition-colors"
        >
          <SlidersHorizontal className="w-4 h-4" /> Populator
        </button>
      </div>

      {/* Mode toggle */}
      <div className="inline-flex p-1 mb-5 bg-gray-100 rounded-full border border-gray-200">
        {Object.values(MODES).map((m) => {
          const Icon = m.icon;
          const selected = mode === m.key;
          return (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                selected ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
              style={selected ? { color: m.accent } : undefined}
            >
              <Icon className="w-4 h-4" /> {m.label}
            </button>
          );
        })}
      </div>

      {/* Search terms */}
      <div className="flex flex-wrap gap-2 mb-6">
        {tags.map((t) => (
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
          {/* Map toolbar */}
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <p className="text-xs text-gray-500 inline-flex items-center gap-1.5">
              <Move className="w-3.5 h-3.5" /> Drag any warehouse to reshape distances. Click one to measure from it.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowDistances((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  showDistances ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                }`}
              >
                <Ruler className="w-3.5 h-3.5" /> Distances
              </button>
              <button
                onClick={resetLayout}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 bg-white border border-gray-200 hover:border-gray-300 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Reset layout
              </button>
            </div>
          </div>

          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/60 z-10 rounded-2xl">
              <Loader2 className="w-7 h-7 animate-spin text-indigo-500" />
            </div>
          )}
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-auto bg-slate-50 rounded-xl border border-slate-100 touch-none select-none"
            onPointerMove={onSvgMove}
            onPointerUp={onSvgUp}
            onPointerLeave={onSvgUp}
          >
            {/* subtle grid */}
            {[...Array(7)].map((_, i) => (
              <line key={`v${i}`} x1={(i * W) / 6} y1="0" x2={(i * W) / 6} y2={H} stroke="#eef2f7" strokeWidth="1" />
            ))}
            {[...Array(8)].map((_, i) => (
              <line key={`h${i}`} x1="0" y1={(i * H) / 7} x2={W} y2={(i * H) / 7} stroke="#eef2f7" strokeWidth="1" />
            ))}

            {/* Distance lines from the selected origin to every other warehouse */}
            {showDistances && originPos &&
              originDistances.map((d) => {
                const mx = (originPos.x + d.pos.x) / 2;
                const my = (originPos.y + d.pos.y) / 2;
                const c = distColor(d.norm);
                return (
                  <g key={`line-${d.code}`} className="pointer-events-none">
                    <line
                      x1={originPos.x} y1={originPos.y} x2={d.pos.x} y2={d.pos.y}
                      stroke={c} strokeWidth="1.5" strokeDasharray="5 4" opacity="0.7"
                    />
                    <rect x={mx - 26} y={my - 9} width="52" height="16" rx="8" fill="white" stroke={c} strokeWidth="1" opacity="0.95" />
                    <text x={mx} y={my + 3} textAnchor="middle" fontSize="10" fontWeight="700" fill={c}>
                      {Math.round(d.km)} km
                    </text>
                  </g>
                );
              })}

            {warehouses.map((w) => {
              const pos = positions[w.warehouseCode];
              if (!pos) return null;
              const { x, y } = pos;
              const r = 10 + (w.demand / 100) * 26;
              const color = colorFor(mode, w.demand);
              const isOrigin = originCode === w.warehouseCode;
              return (
                <g key={`${mode}-${w.warehouseCode}`}>
                  <motion.circle
                    cx={x} cy={y}
                    initial={{ r: 0, opacity: 0 }}
                    animate={{ r, opacity: 0.25 }}
                    transition={{ duration: 0.4 }}
                    fill={color}
                    className="pointer-events-none"
                  />
                  {isOrigin && (
                    <circle cx={x} cy={y} r="11" fill="none" stroke="#4f46e5" strokeWidth="2.5" />
                  )}
                  <circle cx={x} cy={y} r="5" fill={color} className="pointer-events-none" />
                  {/* Invisible, larger drag/click hit-area */}
                  <circle
                    cx={x} cy={y} r="16"
                    fill="transparent"
                    style={{ cursor: 'grab' }}
                    onPointerDown={(e) => onPinDown(e, w.warehouseCode)}
                  />
                  <text x={x} y={y - r - 6} textAnchor="middle" className="fill-gray-700 pointer-events-none" fontSize="11" fontWeight="700">
                    {w.warehouse?.city}
                  </text>
                  <text x={x} y={y - r + 6} textAnchor="middle" className="fill-gray-400 pointer-events-none" fontSize="10" fontWeight="600">
                    {w.raw} {mode === 'peers' ? 'buyers' : 'wants'}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Side panel: demand ranking + (when enabled) live distances */}
        <div className="space-y-6">
          {/* Ranking */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <h3 className="font-bold text-gray-800 mb-3 text-sm">{active.panelTitle(term)}</h3>
            <div className="space-y-2">
              {[...warehouses].sort((a, b) => (a.warehouse?.name || "").localeCompare(b.warehouse?.name || "")).map((w) => (
                <div key={w.warehouseCode} className="flex items-center gap-2">
                  <span className="text-xs text-gray-600 w-28 truncate">{w.warehouse?.name}</span>
                  <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${w.demand}%` }}
                      transition={{ duration: 0.5 }}
                      className="h-full rounded-full"
                      style={{ backgroundColor: colorFor(mode, w.demand) }}
                    />
                  </div>
                  <span className="text-xs font-bold text-gray-700 w-12 text-right">{w.demand}</span>
                  <span className="text-[10px] text-gray-400 w-12 text-right">({w.raw})</span>
                </div>
              ))}
              {warehouses.length === 0 && !loading && (
                <p className="text-sm text-gray-400">No warehouses seeded. Run <code className="text-xs">npm run seed:demand</code>.</p>
              )}
            </div>
          </div>

          {/* Live distances from origin */}
          {showDistances && (
            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <h3 className="font-bold text-gray-800 mb-1 text-sm inline-flex items-center gap-1.5">
                <Ruler className="w-4 h-4 text-indigo-600" /> Distances
              </h3>
              {!originCode ? (
                <p className="text-xs text-gray-400 mt-2">
                  Click a warehouse on the map to measure straight-line distances from it to every other warehouse.
                </p>
              ) : (
                <>
                  <p className="text-xs text-gray-500 mb-3">
                    From <span className="font-semibold text-gray-700">{placed.find((p) => p.code === originCode)?.city}</span>{' '}
                    — straight-line, measured from the map.
                  </p>
                  <div className="space-y-2">
                    {originDistances.map((d) => (
                      <div key={d.code} className="flex items-center gap-2">
                        <span className="text-xs text-gray-600 w-20 truncate">{d.city}</span>
                        <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                          <motion.div
                            animate={{ width: `${d.norm}%` }}
                            transition={{ duration: 0.3 }}
                            className="h-full rounded-full"
                            style={{ backgroundColor: distColor(d.norm) }}
                          />
                        </div>
                        <span className="text-xs font-bold text-gray-700 w-14 text-right">{Math.round(d.km)} km</span>
                        <span className="text-[10px] text-gray-400 w-8 text-right">{d.norm}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-3">
                    km = pixel distance × {KM_PER_PX.toFixed(2)} (map width ≈ {MAP_WIDTH_KM} km). Last column is normalized 0–100 vs. the
                    farthest pair on the map.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <PopulatorSidebar
        open={populatorOpen}
        onClose={() => setPopulatorOpen(false)}
        onApplied={(cfg) => {
          if (cfg?.tags) setTags(cfg.tags);
          setReloadKey((k) => k + 1);
        }}
      />
    </div>
  );
}
