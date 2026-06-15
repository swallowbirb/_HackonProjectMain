import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { MAP_W, MAP_H, sourcePos, curvedPath, bezierPoint } from '../../lib/routingDemo';

const demandColor = (d) => {
  if (d <= 0) return '#9ca3af';
  if (d >= 75) return '#dc2626';
  if (d >= 40) return '#f59e0b';
  return '#16a34a';
};

/**
 * ResaleRouteMap — a read-only Chhattisgarh demand map (same visual language as
 * the admin Demand Map, minus the populator/drag/distance controls) that shows
 * the route a returned item takes from the customer (source) to the chosen
 * warehouse (destination). Advancing the route animates a smooth curved path.
 *
 * Props:
 *   ranked          ranked warehouses from rankWarehouses() [{code,city,pos,demand,raw,...}]
 *   destinationCode the winning warehouse code
 *   progress        0..1 — how far along the route the shipment is
 *   term            demand search term (for the legend)
 */
export default function ResaleRouteMap({ ranked = [], destinationCode, progress = 0, term, sourceCity }) {
  const src = sourcePos(sourceCity);
  const dest = ranked.find((w) => w.code === destinationCode);

  const { d: pathD, control } = useMemo(
    () => (dest ? curvedPath(src, dest.pos) : { d: '', control: src }),
    [dest, src]
  );

  const dot = useMemo(
    () => (dest ? bezierPoint(src, control, dest.pos, Math.max(0, Math.min(1, progress))) : null),
    [dest, src, control, progress]
  );

  return (
    <div className="relative bg-white border border-gray-200 rounded-2xl p-3">
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="w-full h-auto bg-slate-50 rounded-xl border border-slate-100">
        {/* subtle grid */}
        {[...Array(7)].map((_, i) => (
          <line key={`v${i}`} x1={(i * MAP_W) / 6} y1="0" x2={(i * MAP_W) / 6} y2={MAP_H} stroke="#eef2f7" strokeWidth="1" />
        ))}
        {[...Array(7)].map((_, i) => (
          <line key={`h${i}`} x1="0" y1={(i * MAP_H) / 6} x2={MAP_W} y2={(i * MAP_H) / 6} stroke="#eef2f7" strokeWidth="1" />
        ))}

        {/* Warehouse demand blobs (read-only) */}
        {ranked.map((w) => {
          const isDest = w.code === destinationCode;
          const r = 9 + (w.demand / 100) * 24;
          const color = demandColor(w.demand);
          return (
            <g key={w.code}>
              <circle cx={w.pos.x} cy={w.pos.y} r={r} fill={color} opacity={isDest ? 0.28 : 0.16} />
              <circle cx={w.pos.x} cy={w.pos.y} r="4.5" fill={color} />
              {isDest && (
                <motion.circle
                  cx={w.pos.x} cy={w.pos.y}
                  r="14" fill="none" stroke="#4f46e5" strokeWidth="2.5"
                  initial={{ opacity: 0, r: 8 }} animate={{ opacity: 1, r: 14 }} transition={{ duration: 0.4 }}
                />
              )}
              <text x={w.pos.x} y={w.pos.y - r - 5} textAnchor="middle" fontSize="11" fontWeight="700" className="fill-gray-700">
                {w.city}
              </text>
              <text x={w.pos.x} y={w.pos.y - r + 7} textAnchor="middle" fontSize="9.5" fontWeight="600" className="fill-gray-400">
                {w.raw} wants
              </text>
            </g>
          );
        })}

        {/* Planned route (faint dashed) */}
        {pathD && (
          <path d={pathD} fill="none" stroke="#a5b4fc" strokeWidth="2" strokeDasharray="6 6" opacity="0.7" />
        )}

        {/* Traveled route (animated) */}
        {pathD && (
          <motion.path
            d={pathD}
            fill="none"
            stroke="#4f46e5"
            strokeWidth="3.5"
            strokeLinecap="round"
            initial={false}
            animate={{ pathLength: Math.max(0, Math.min(1, progress)) }}
            transition={{ duration: 0.9, ease: 'easeInOut' }}
          />
        )}

        {/* Source pin (reseller) */}
        <g>
          <circle cx={src.x} cy={src.y} r="12" fill="#10b981" opacity="0.18" />
          <circle cx={src.x} cy={src.y} r="6" fill="#10b981" stroke="white" strokeWidth="2" />
          <text x={src.x} y={src.y + 22} textAnchor="middle" fontSize="11" fontWeight="800" className="fill-emerald-700">
            Reseller
          </text>
        </g>

        {/* Moving shipment marker */}
        {dot && progress > 0 && progress < 1 && (
          <motion.g
            initial={false}
            animate={{ x: dot.x, y: dot.y }}
            transition={{ duration: 0.9, ease: 'easeInOut' }}
          >
            <circle r="11" fill="#4f46e5" opacity="0.2" />
            <circle r="6" fill="#4f46e5" stroke="white" strokeWidth="2" />
            <text textAnchor="middle" y="3.5" fontSize="8">🚚</text>
          </motion.g>
        )}

        {/* Delivered marker */}
        {dest && progress >= 1 && (
          <motion.text
            x={dest.pos.x} y={dest.pos.y + 4} textAnchor="middle" fontSize="13"
            initial={{ scale: 0 }} animate={{ scale: 1 }}
          >✅</motion.text>
        )}
      </svg>

      {/* Legend */}
      <div className="flex items-center justify-between mt-2 px-1 text-[11px] text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Source
          <span className="w-2.5 h-2.5 rounded-full ring-2 ring-indigo-500 bg-transparent ml-2" /> Destination
        </span>
        <span>Demand heat for “{term}”</span>
      </div>
    </div>
  );
}
