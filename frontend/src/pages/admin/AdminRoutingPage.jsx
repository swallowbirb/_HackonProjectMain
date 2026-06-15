import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ChevronLeft, Compass } from 'lucide-react';
import RoutingRationale from '../../components/routing/RoutingRationale';

/**
 * Admin-only routing decision view. The disposition decision (paths, refund
 * timing, warehouse selection) is internal logistics intelligence — it lives
 * here on the admin side, never on the buyer's item status page.
 */
export default function AdminRoutingPage() {
  const { itemId: paramId } = useParams();
  const [itemId, setItemId] = useState(paramId || '');
  const [active, setActive] = useState(paramId || '');

  return (
    <div className="min-h-screen bg-black text-white font-sans">
      {/* Header */}
      <div className="border-b border-zinc-900 bg-black/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <Link
            to="/admin/dashboard"
            className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <div className="w-9 h-9 rounded-xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
            <Compass className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">Disposition Decision</h1>
            <p className="text-xs text-zinc-500">Internal routing intelligence — admin only</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-6 space-y-5">
        {/* Item ID lookup */}
        <div className="flex gap-2">
          <input
            value={itemId}
            onChange={(e) => setItemId(e.target.value.trim())}
            placeholder="Paste an item ID…"
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500/40 font-mono"
          />
          <button
            onClick={() => setActive(itemId)}
            disabled={!itemId}
            className="bg-violet-500/20 text-violet-200 border border-violet-500/40 hover:bg-violet-500/30 disabled:opacity-40 px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors"
          >
            Load
          </button>
        </div>

        {/* Rationale (light component on a dark page — wrap for contrast) */}
        {active ? (
          <RoutingRationale itemId={active} autoCompute={false} />
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-10 text-center text-zinc-500 text-sm">
            Paste a graded item's ID above to view or run its routing decision.
          </div>
        )}
      </div>
    </div>
  );
}
