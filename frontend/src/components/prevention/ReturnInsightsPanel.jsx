import { useEffect, useState } from 'react';
import { getSellerInsights } from '../../services/prevention.service';
import { TrendingDown, TrendingUp, Minus, AlertTriangle, CheckCircle, Activity, RefreshCw } from 'lucide-react';

/**
 * <ReturnInsightsPanel /> — Phase 7 §9.5
 * Light theme matching the main marketplace site.
 */

const SIGNAL_BADGES = {
  runs_small:      { label: 'Runs Small',       cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  runs_large:      { label: 'Runs Large',        cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  true_to_size:    { label: 'True to Size',      cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  issues_reported: { label: 'Compat Issues',     cls: 'bg-red-50 text-red-700 border-red-200' },
  no_issues:       { label: 'No Compat Issues',  cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  too_large:       { label: 'Too Large',         cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  too_small:       { label: 'Too Small',         cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  color_mismatch:  { label: 'Color Mismatch',    cls: 'bg-purple-50 text-purple-700 border-purple-200' },
};

function RateBar({ rate }) {
  if (rate == null) return <span className="text-gray-400 text-sm">—</span>;
  const pct = Math.round(rate * 100);
  const barColor = pct >= 25 ? 'bg-red-500' : pct >= 15 ? 'bg-amber-500' : pct >= 8 ? 'bg-yellow-400' : 'bg-emerald-500';
  const textColor = pct >= 25 ? 'text-red-600' : pct >= 15 ? 'text-amber-600' : pct >= 8 ? 'text-yellow-600' : 'text-[#007600]';
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className={`text-sm font-bold tabular-nums ${textColor}`}>{pct}%</span>
    </div>
  );
}

function DirectionBadge({ direction, previousRate, currentRate }) {
  if (!direction) return null;
  if (direction === 'improved') return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
      <TrendingDown className="w-3 h-3" />
      {previousRate != null ? `${Math.round(previousRate * 100)}% → ${Math.round((currentRate || 0) * 100)}%` : 'Improving'}
    </span>
  );
  if (direction === 'worsened') return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
      <TrendingUp className="w-3 h-3" /> Worsening
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
      <Minus className="w-3 h-3" /> Stable
    </span>
  );
}

export default function ReturnInsightsPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    setError(null);
    getSellerInsights()
      .then((d) => setData(d))
      .catch((e) => setError(e?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (loading) return (
    <div className="flex items-center justify-center py-16 text-gray-500">
      <RefreshCw className="w-5 h-5 animate-spin mr-2 text-gray-400" /> Loading return insights…
    </div>
  );

  if (error) return (
    <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-sm">
      <AlertTriangle className="w-5 h-5 flex-shrink-0" /> Couldn't load insights: {error}
    </div>
  );

  if (!data?.items?.length) return (
    <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center shadow-sm">
      <Activity className="w-12 h-12 text-gray-300 mx-auto mb-3" />
      <p className="text-gray-900 font-medium">No return insights yet.</p>
      <p className="text-gray-500 text-sm mt-1">Run the prevention recompute after orders and returns accumulate.</p>
    </div>
  );

  // Summary stats
  const withData = data.items.filter((i) => i.unitsSold > 0);
  const avgRate = withData.length
    ? withData.reduce((s, i) => s + (i.returnRate || 0), 0) / withData.length
    : 0;
  const highRisk = withData.filter((i) => (i.returnRate || 0) >= 0.20).length;
  const improving = withData.filter((i) => i.rateChangeDirection === 'improved').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Return Intelligence</h2>
          <p className="text-gray-500 text-sm mt-0.5">Per-SKU return rates, root causes, and fit signals from buyer data.</p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 transition-colors border border-gray-200 hover:border-gray-400 bg-white px-3 py-1.5 rounded-lg shadow-sm"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-4">
        {[
          {
            label: 'Avg Return Rate',
            value: `${Math.round(avgRate * 100)}%`,
            valueColor: avgRate >= 0.20 ? 'text-red-600' : avgRate >= 0.10 ? 'text-amber-600' : 'text-[#007600]',
            sub: 'across all SKUs',
            bg: 'bg-white',
          },
          {
            label: 'High-Risk SKUs',
            value: highRisk,
            valueColor: highRisk > 0 ? 'text-orange-600' : 'text-[#007600]',
            sub: '≥ 20% return rate',
            bg: 'bg-white',
          },
          {
            label: 'Improving',
            value: improving,
            valueColor: improving > 0 ? 'text-[#007600]' : 'text-gray-400',
            sub: 'SKUs trending down',
            bg: 'bg-white',
          },
        ].map((s) => (
          <div key={s.label} className={`${s.bg} border border-gray-200 rounded-2xl p-4 shadow-sm`}>
            <p className="text-xs text-gray-500 font-medium">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.valueColor}`}>{s.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* SKU cards */}
      <div className="space-y-3">
        {data.items.map((item) => {
          const hasData = item.unitsSold > 0;
          const signals = [
            item.fitVerdict && !['unknown', null].includes(item.fitVerdict) ? SIGNAL_BADGES[item.fitVerdict] : null,
            item.compatVerdict === 'issues_reported' ? SIGNAL_BADGES['issues_reported'] : null,
            item.dimensionVerdict && !['unknown', 'no_issues', null].includes(item.dimensionVerdict)
              ? SIGNAL_BADGES[item.dimensionVerdict]
              : null,
          ].filter(Boolean);

          const riskLevel = !hasData
            ? null
            : (item.returnRate || 0) >= 0.25 ? 'high'
            : (item.returnRate || 0) >= 0.15 ? 'medium'
            : 'low';

          const borderColor =
            riskLevel === 'high' ? 'border-red-200' :
            riskLevel === 'medium' ? 'border-amber-200' :
            'border-gray-200';

          const headerBg =
            riskLevel === 'high' ? 'bg-red-50' :
            riskLevel === 'medium' ? 'bg-amber-50' :
            'bg-gray-50';

          return (
            <div key={item.productId} className={`bg-white border ${borderColor} rounded-2xl overflow-hidden shadow-sm`}>
              {/* Card header */}
              <div className={`${headerBg} border-b ${borderColor} px-5 py-3 flex items-center justify-between gap-3 flex-wrap`}>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm leading-tight truncate">{item.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5 capitalize">{item.category || '—'}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                  {item.rateChangeDirection && (
                    <DirectionBadge
                      direction={item.rateChangeDirection}
                      previousRate={item.previousReturnRate30d}
                      currentRate={item.returnRate}
                    />
                  )}
                  {riskLevel === 'high' && (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
                      <AlertTriangle className="w-3 h-3" /> High Risk
                    </span>
                  )}
                  {riskLevel === 'low' && hasData && (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <CheckCircle className="w-3 h-3" /> Healthy
                    </span>
                  )}
                </div>
              </div>

              {/* Stats */}
              <div className="px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Sold</p>
                  <p className="text-lg font-bold text-gray-900">{item.unitsSold ?? 0}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Returned</p>
                  <p className={`text-lg font-bold ${(item.unitsReturned || 0) > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                    {item.unitsReturned ?? 0}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Return Rate</p>
                  <RateBar rate={item.returnRate} />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Top Reason</p>
                  <p className="text-sm font-medium text-gray-700 capitalize">
                    {item.dominantReason ? item.dominantReason.replace(/_/g, ' ') : '—'}
                  </p>
                </div>
              </div>

              {/* Signal badges + summary */}
              {(signals.length > 0 || item.sellerSummary || item.rateChangeDirection === 'improved') && (
                <div className="px-5 pb-4 space-y-2 border-t border-gray-100 pt-3">
                  {signals.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {signals.map((sig, i) => (
                        <span key={i} className={`inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full border ${sig.cls}`}>
                          {sig.label}
                        </span>
                      ))}
                    </div>
                  )}

                  {item.sellerSummary && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                      <p className="text-xs text-amber-700 font-medium mb-1">💡 AI Insight</p>
                      <p className="text-sm text-gray-700 italic leading-relaxed">{item.sellerSummary}</p>
                    </div>
                  )}

                  {item.rateChangeDirection === 'improved' && item.previousReturnRate30d != null && (
                    <div className="flex items-center gap-2 text-xs text-[#007600] bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                      <TrendingDown className="w-3.5 h-3.5 flex-shrink-0" />
                      Return rate dropped from {Math.round(item.previousReturnRate30d * 100)}% to {Math.round((item.returnRate || 0) * 100)}% in the last 30 days. Keep it up!
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
