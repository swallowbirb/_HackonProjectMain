import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Recycle, Loader2, TrendingUp, Package, Tag, Handshake, Leaf, Users,
  Route, ArrowRight, ShoppingBag, Sparkles,
} from 'lucide-react';
import { getMyResaleListings } from '../../services/resale.service';
import { inr } from '../../lib/routingDemo';
import ResaleRouteDetail from '../../components/reseller/ResaleRouteDetail';

const STATUS_PILL = {
  DRAFT: 'bg-gray-100 text-gray-600',
  PUBLISHED: 'bg-emerald-100 text-emerald-700',
  UNLISTED: 'bg-amber-100 text-amber-700',
  SOLD: 'bg-indigo-100 text-indigo-700',
};

const GRADE_BG = { A: 'bg-emerald-500', B: 'bg-blue-500', C: 'bg-orange-500', D: 'bg-red-500' };

export default function ResellerDashboardPage() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await getMyResaleListings();
        if (res.success) setListings(res.data);
      } catch (err) {
        console.error('Failed to load resale listings', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const stats = useMemo(() => {
    const n = listings.length;
    const live = listings.filter((l) => l.status === 'PUBLISHED').length;
    const sold = listings.filter((l) => l.status === 'SOLD').length;
    const peers = listings.filter((l) => l.peerRedistribute).length;
    const recovery = listings.reduce((s, l) => s + (l.price || l.suggestedPrice || 0), 0);
    const demand = listings.reduce((s, l) => s + (l.demandCount || 0), 0);
    const avgScore = n ? Math.round(listings.reduce((s, l) => s + (l.qualityScore || 0), 0) / n) : 0;
    const co2 = (n * 3.4).toFixed(1); // ~3.4 kg CO₂e avoided per diverted item (demo estimate)
    return { n, live, sold, peers, recovery, demand, avgScore, co2 };
  }, [listings]);

  const statCards = [
    { label: 'Items diverted', value: stats.n, icon: Recycle, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Live listings', value: stats.live, icon: Tag, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Recovery value', value: inr(stats.recovery), icon: TrendingUp, color: 'text-indigo-600', bg: 'bg-indigo-50' },
    { label: 'Peer handoffs', value: stats.peers, icon: Handshake, color: 'text-violet-600', bg: 'bg-violet-50' },
    { label: 'Buyers reached', value: stats.demand, icon: Users, color: 'text-amber-600', bg: 'bg-amber-50' },
    { label: 'CO₂e avoided', value: `${stats.co2} kg`, icon: Leaf, color: 'text-green-600', bg: 'bg-green-50' },
  ];

  return (
    <div className="min-h-screen bg-[#EAEDED] p-6 md:p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }}
          className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white border border-gray-200 p-6 rounded-2xl shadow-sm"
        >
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
              <Recycle className="w-6 h-6 text-emerald-600" /> Reseller Dashboard
            </h1>
            <p className="text-gray-500 mt-1 text-sm">
              Track every returned & resold item from the customer's door to its second life.
            </p>
          </div>
          <Link
            to="/seller/dashboard"
            className="inline-flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2.5 rounded-full font-medium text-sm transition-colors"
          >
            <ShoppingBag className="w-4 h-4" /> Seller Dashboard
          </Link>
        </motion.div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {statCards.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              className="bg-white border border-gray-200 p-4 rounded-2xl shadow-sm"
            >
              <div className={`w-9 h-9 rounded-xl ${s.bg} ${s.color} flex items-center justify-center mb-2`}>
                <s.icon className="w-5 h-5" />
              </div>
              <p className="text-lg font-bold text-gray-900 leading-none">{s.value}</p>
              <p className="text-[11px] text-gray-500 mt-1">{s.label}</p>
            </motion.div>
          ))}
        </div>

        {/* List */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-5 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Route className="w-5 h-5 text-gray-400" /> Resale Routes
            </h2>
            <span className="text-xs text-gray-400">{stats.n} item{stats.n !== 1 ? 's' : ''}</span>
          </div>

          {loading ? (
            <div className="p-16 flex items-center justify-center">
              <Loader2 className="w-7 h-7 animate-spin text-gray-400" />
            </div>
          ) : listings.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Recycle className="w-8 h-8 text-gray-300" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-1">No resale routes yet</h3>
              <p className="text-gray-500 text-sm max-w-md mx-auto">
                When a returned or sold-used item is routed for resale, it shows up here with its full journey.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-gray-100">
              {listings.map((l, i) => {
                const img = l.images?.[0] || 'https://picsum.photos/seed/resale/200/200';
                return (
                  <motion.button
                    key={l._id}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.03, 0.3) }}
                    onClick={() => setSelected(l)}
                    className="text-left bg-white hover:bg-indigo-50/40 transition-colors p-4 flex items-center gap-4 group"
                  >
                    <div className="relative flex-shrink-0">
                      <img src={img} alt={l.title} className="w-16 h-16 rounded-xl object-cover border border-gray-200" />
                      <span className={`absolute -top-1.5 -left-1.5 w-6 h-6 rounded-lg text-white text-xs font-black flex items-center justify-center ${GRADE_BG[l.grade] || 'bg-zinc-400'}`}>
                        {l.grade}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-gray-900 text-sm truncate group-hover:text-indigo-700">{l.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_PILL[l.status] || 'bg-gray-100 text-gray-600'}`}>
                          {l.status}
                        </span>
                        {l.peerRedistribute && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 inline-flex items-center gap-1">
                            <Handshake className="w-2.5 h-2.5" /> Peer
                          </span>
                        )}
                        <span className="text-xs text-gray-400">{inr(l.price)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-indigo-600 text-xs font-semibold flex-shrink-0">
                      Track <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  </motion.button>
                );
              })}
            </div>
          )}
        </div>

        <p className="text-center text-[11px] text-gray-400 flex items-center justify-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" /> Routing uses the same "best warehouse, not nearest" engine as production.
        </p>
      </div>

      <AnimatePresence>
        {selected && <ResaleRouteDetail listing={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  );
}
