import { useEffect, useState } from 'react';
import { getCheckoutRisk, updateNudgeEvent } from '../../services/prevention.service';

/**
 * <ReturnRiskNudge items onContinue onAdjust /> — Phase 7 §9.3
 *
 * Drops into a checkout / Buy Now confirm flow. Calls /checkout-risk before
 * finalising the order. The backend only ever returns FIT_NUDGE interventions
 * to the client (everything else is computed silently for refund timing).
 *
 * If the basket has an actionable fit hint, render a non-blocking banner
 * with a "Pick a larger / smaller size" CTA. Otherwise render nothing.
 *
 * Props:
 *   items:       [{ productId, quantity, sizeAdjusted? }]
 *   onContinue:  () => void   — buyer chose to proceed despite the nudge
 *   onAdjust:    (action) => void  — buyer chose to follow the suggestion
 *                                    (action: 'SIZE_UP' | 'SIZE_DOWN')
 *   children:    optional fallback render when nothing to show
 */

export default function ReturnRiskNudge({ items, onContinue, onAdjust, onNoNudge, children }) {
  const [risk, setRisk] = useState(null);
  const [loading, setLoading] = useState(true);
  const [acted, setActed] = useState(false);

  useEffect(() => {
    if (!items || items.length === 0) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getCheckoutRisk(items)
      .then((data) => {
        if (!cancelled) setRisk(data);
      })
      .catch(() => {
        if (!cancelled) setRisk(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [JSON.stringify(items || [])]);

  if (loading) return null;
  if (!risk || !risk.items || risk.items.length === 0) {
    // Nothing to show — tell the parent to proceed directly to checkout
    onNoNudge?.();
    return children || null;
  }

  // Only FIT_NUDGE survives to the client. Find the first item with one.
  const focus = risk.items.find(
    (i) => i.intervention && i.intervention.type === 'FIT_NUDGE'
  );
  if (!focus) {
    onNoNudge?.();
    return children || null;
  }

  const fitMessage = focus.fit?.message;
  const action = focus.intervention.action;

  const ctas = [];
  if (action === 'SIZE_UP') {
    ctas.push({
      label: 'Pick a larger size',
      action: () => {
        markActed(focus.nudgeEventId);
        onAdjust?.('SIZE_UP');
      },
    });
  } else if (action === 'SIZE_DOWN') {
    ctas.push({
      label: 'Pick a smaller size',
      action: () => {
        markActed(focus.nudgeEventId);
        onAdjust?.('SIZE_DOWN');
      },
    });
  }

  return (
    <div
      className="my-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
      role="alert"
      aria-live="polite"
    >
      <div className="mb-1 font-semibold text-amber-800">Fit hint</div>
      <ul className="space-y-1">
        {fitMessage && <li>{fitMessage}</li>}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        {ctas.map((c, idx) => (
          <button
            key={idx}
            type="button"
            onClick={c.action}
            disabled={acted}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {c.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onContinue?.()}
          className="rounded-md border border-current px-3 py-1.5 text-xs font-medium hover:bg-white/40"
        >
          Continue anyway
        </button>
      </div>
    </div>
  );

  function markActed(nudgeEventId) {
    setActed(true);
    if (nudgeEventId) {
      updateNudgeEvent(nudgeEventId, { acted: true }).catch(() => {});
    }
  }
}
