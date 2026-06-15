import { motion } from 'framer-motion';
import { Check, ChevronRight, Loader2, Flag } from 'lucide-react';

/**
 * RouteCheckpointTracker — a thin VERTICAL checkpoint rail with an "advance"
 * control. Shared by the buyer order-tracking sidebar and the reseller route
 * tracker. Purely presentational: the parent owns the index + advance handler.
 *
 * Props:
 *   steps        [{ key, label, sublabel?, icon }]   ordered checkpoints
 *   currentIndex number                              0-based index reached so far
 *   onAdvance    () => void                          advance to the next checkpoint
 *   advancing    boolean                             show a spinner on the button
 *   accent       string (hex)                        theme color (default amber)
 *   title        string
 *   subtitle     string
 *   advanceLabel string                              override the button verb
 */
export default function RouteCheckpointTracker({
  steps = [],
  currentIndex = 0,
  onAdvance,
  advancing = false,
  accent = '#FF9900',
  title,
  subtitle,
  advanceLabel,
}) {
  const n = steps.length;
  if (n === 0) return null;

  const safeIndex = Math.max(0, Math.min(currentIndex, n - 1));
  const isComplete = safeIndex >= n - 1;
  const next = !isComplete ? steps[safeIndex + 1] : null;

  return (
    <div className="select-none">
      {(title || subtitle) && (
        <div className="mb-4">
          {title && <p className="text-sm font-bold text-gray-900">{title}</p>}
          {subtitle && <p className="text-xs text-gray-500 mt-0.5 leading-snug">{subtitle}</p>}
        </div>
      )}

      <ol className="relative">
        {steps.map((step, idx) => {
          const done = idx < safeIndex;
          const current = idx === safeIndex;
          const upcoming = idx > safeIndex;
          const isLast = idx === n - 1;
          const Icon = step.icon || (isLast ? Flag : null);

          // Connector below this node is "filled" once the NEXT node is reached.
          const connectorFilled = idx < safeIndex;

          return (
            <li key={step.key || idx} className="relative flex gap-3 pb-6 last:pb-0">
              {/* Rail + node */}
              <div className="relative flex flex-col items-center">
                <motion.span
                  initial={false}
                  animate={{
                    backgroundColor: done || current ? accent : '#ffffff',
                    borderColor: done || current ? accent : '#d4d4d8',
                    scale: current ? 1.12 : 1,
                  }}
                  transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                  className="z-10 flex items-center justify-center w-8 h-8 rounded-full border-2 shadow-sm"
                  style={current ? { boxShadow: `0 0 0 4px ${accent}22` } : undefined}
                >
                  {done ? (
                    <Check className="w-4 h-4 text-white" />
                  ) : current ? (
                    advancing ? (
                      <Loader2 className="w-4 h-4 text-white animate-spin" />
                    ) : Icon ? (
                      <Icon className="w-4 h-4 text-white" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-white" />
                    )
                  ) : Icon ? (
                    <Icon className="w-4 h-4 text-gray-300" />
                  ) : (
                    <span className="text-[11px] font-bold text-gray-300">{idx + 1}</span>
                  )}
                </motion.span>

                {/* Vertical connector */}
                {!isLast && (
                  <div className="relative flex-1 w-0.5 my-1 bg-gray-200 rounded-full overflow-hidden min-h-[1.5rem]">
                    <motion.div
                      initial={false}
                      animate={{ height: connectorFilled ? '100%' : '0%' }}
                      transition={{ duration: 0.5, ease: 'easeInOut' }}
                      className="absolute top-0 left-0 w-full rounded-full"
                      style={{ backgroundColor: accent }}
                    />
                  </div>
                )}
              </div>

              {/* Labels */}
              <div className={`pt-1 ${upcoming ? 'opacity-50' : ''}`}>
                <p
                  className="text-sm font-semibold leading-tight"
                  style={{ color: done ? accent : current ? '#111827' : '#9ca3af' }}
                >
                  {step.label}
                </p>
                {step.sublabel && (
                  <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{step.sublabel}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Advance control */}
      {onAdvance && (
        <div className="mt-2">
          {isComplete ? (
            <div
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold"
              style={{ backgroundColor: `${accent}14`, color: accent }}
            >
              <Check className="w-4 h-4" /> Journey complete
            </div>
          ) : (
            <button
              onClick={onAdvance}
              disabled={advancing}
              className="group flex items-center justify-between w-full px-4 py-2.5 rounded-xl text-sm font-bold text-white shadow-sm transition-all disabled:opacity-60 hover:shadow-md"
              style={{ backgroundColor: accent }}
            >
              <span className="flex items-center gap-2">
                {advancing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
                Advance{next ? ` → ${next.label}` : ''}
              </span>
              <span className="text-[11px] font-medium opacity-80">
                {safeIndex + 1}/{n}
              </span>
            </button>
          )}
          {advanceLabel && <p className="text-[10px] text-gray-400 mt-2 text-center">{advanceLabel}</p>}
        </div>
      )}
    </div>
  );
}
