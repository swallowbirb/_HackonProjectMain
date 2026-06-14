import { useEffect, useState } from 'react';
import { getPreventionAnalytics } from '../../services/prevention.service';

/**
 * <PreventionAnalytics /> — Phase 7 §20
 *
 * Admin-only dashboard card. Shows the "proof it works" funnel:
 * shown → acted → purchased → kept (returns prevented).
 *
 * Per-nudge-type breakdown and top-5 ignored SKUs.
 */

const INEFFECTIVE_THRESHOLD = 0.10;

export default function PreventionAnalytics({ days = 7 }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPreventionAnalytics(days)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  if (loading) return <div className="text-sm text-zinc-500">Loading prevention metrics…</div>;
  if (error) return <div className="text-sm text-red-600">Couldn't load metrics: {error}</div>;
  if (!data) return null;

  const conversion = data.conversionRate ? (data.conversionRate * 100).toFixed(1) : '0.0';
  const prevention = data.preventionRate ? (data.preventionRate * 100).toFixed(1) : '0.0';

  return (
    <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-base font-semibold">Prevention impact ({data.period})</h3>
        <span className="text-xs text-zinc-500">last {days} days</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Nudges shown" value={data.nudgesShown} />
        <Metric label="Acted on" value={data.nudgesActedOn} />
        <Metric label="Conversion" value={`${conversion}%`} accent="emerald" />
        <Metric label="Prevention" value={`${prevention}%`} accent="emerald" />
      </div>

      {data.byNudgeType && Object.keys(data.byNudgeType).length > 0 && (
        <div>
          <div className="mb-2 text-sm font-medium text-zinc-700">By nudge type</div>
          <div className="space-y-1.5">
            {Object.entries(data.byNudgeType).map(([type, t]) => {
              const ineffective = t.shown >= 50 && t.conversion < INEFFECTIVE_THRESHOLD;
              return (
                <div
                  key={type}
                  className="flex items-center justify-between rounded-md bg-zinc-50 px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{type}</span>
                    {ineffective && (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">
                        ⚠ ineffective
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-600">
                    {t.acted}/{t.shown} acted —{' '}
                    <span className="font-medium">{(t.conversion * 100).toFixed(1)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data.topIgnoredSKUs && data.topIgnoredSKUs.length > 0 && (
        <div>
          <div className="mb-1 text-sm font-medium text-zinc-700">
            Top ignored SKUs (candidates for re-wording)
          </div>
          <ul className="space-y-1 text-xs text-zinc-600">
            {data.topIgnoredSKUs.map((s) => (
              <li key={s.productId} className="font-mono">
                {s.productId} — {s.ignoredCount} ignored
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, accent }) {
  const cls =
    accent === 'emerald'
      ? 'text-emerald-700'
      : 'text-zinc-900';
  return (
    <div className="rounded-md bg-zinc-50 p-3">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`text-xl font-semibold ${cls}`}>{value ?? '—'}</div>
    </div>
  );
}
