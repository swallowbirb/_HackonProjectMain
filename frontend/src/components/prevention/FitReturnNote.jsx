import { useEffect, useState } from 'react';
import { getProductInsight } from '../../services/prevention.service';

/**
 * <FitReturnNote productId /> — Phase 7 §9.2
 *
 * Drops onto the PDP after the description. Renders the honest one-liner
 * from the RIKB when present; renders nothing when verdict='unknown' AND
 * the SKU's return rate is unremarkable. Never scolds.
 *
 * Confidence floor enforced both server-side (§19) and client-side here.
 */

const FIT_CONFIDENCE_FLOOR = 0.5;

export default function FitReturnNote({ productId }) {
  const [insight, setInsight] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    setLoading(true);
    getProductInsight(productId)
      .then((data) => {
        if (!cancelled) setInsight(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || 'Failed to load insight');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  if (loading || error || !insight) return null;

  const fit = insight.fitSignal || {};
  const compat = insight.compatSignal || {};
  const dim = insight.dimensionSignal || {};
  const returnRate = insight.returnRate || 0;

  const messages = [];

  // Apparel/footwear — fit verdict (gated by confidence floor)
  if (
    fit.verdict &&
    fit.verdict !== 'unknown' &&
    (fit.confidence || 0) >= FIT_CONFIDENCE_FLOOR
  ) {
    if (fit.verdict === 'runs_small') {
      messages.push({
        icon: '🧵',
        text: 'Runs small — most returns cite tightness. Consider sizing up.',
      });
    } else if (fit.verdict === 'runs_large') {
      messages.push({
        icon: '🧵',
        text: 'Runs large — most returns cite looseness. Consider sizing down.',
      });
    }
  }

  // Electronics — compatibility
  if (compat.verdict === 'issues_reported' && (compat.confidence || 0) >= FIT_CONFIDENCE_FLOOR) {
    messages.push({
      icon: '🔌',
      text: 'Buyers commonly report compatibility issues. Check if it works with your device before purchasing.',
    });
  }

  // Furniture/home — dimension or color
  if (
    ['too_large', 'too_small', 'color_mismatch'].includes(dim.verdict) &&
    (dim.confidence || 0) >= FIT_CONFIDENCE_FLOOR
  ) {
    if (dim.verdict === 'too_large') {
      messages.push({
        icon: '📐',
        text: 'Returns frequently cite size — confirm dimensions before you order.',
      });
    } else if (dim.verdict === 'too_small') {
      messages.push({
        icon: '📐',
        text: 'Buyers report this is smaller than expected. Check dimensions in the listing.',
      });
    } else if (dim.verdict === 'color_mismatch') {
      messages.push({
        icon: '🎨',
        text: 'Some buyers report the color appears different in person than in photos.',
      });
    }
  }

  // Note: a previous build also surfaced a generic "returned more often than
  // average (~XX%)" line when no specific fit/compat/dimension signal fired.
  // That copy was removed because product-level return-rate disclosure
  // discouraged purchases without giving the buyer something actionable to do.
  // We now only surface signals tied to a concrete pre-purchase action
  // (sizing, compat check, dimension check, color expectation).

  if (messages.length === 0) return null;

  return (
    <div
      className="my-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
      role="note"
      aria-label="Honest product insight"
    >
      <div className="mb-1 font-semibold text-amber-800">Heads up — from past buyers</div>
      <ul className="space-y-1">
        {messages.map((m, idx) => (
          <li key={idx} className="flex items-start gap-2">
            <span aria-hidden="true">{m.icon}</span>
            <span>{m.text}</span>
          </li>
        ))}
      </ul>
      {insight.isPrior && (
        <div className="mt-2 text-xs italic text-amber-700">
          Estimate based on category averages — this product doesn't have enough sales data yet.
        </div>
      )}
    </div>
  );
}
