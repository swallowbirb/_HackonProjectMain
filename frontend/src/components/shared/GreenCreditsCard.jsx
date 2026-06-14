import { useEffect, useState } from 'react';
import { Leaf, Droplets, Coins, Loader2 } from 'lucide-react';
import { getUserImpact } from '../../services/sustainability.service';

/**
 * Compact sustainability summary — green-credit balance + CO2/water saved.
 * Used on the buyer dashboard / orders page.
 */
export default function GreenCreditsCard({ userId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    if (!userId) return;
    (async () => {
      try {
        const res = await getUserImpact(userId);
        if (alive && res.success) setData(res.data);
      } catch {
        /* non-fatal */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [userId]);

  if (loading) {
    return (
      <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
      </div>
    );
  }

  const credits = data?.creditBalance ?? 0;
  const co2 = data?.totalCo2Kg ?? 0;
  const water = data?.totalWaterL ?? 0;

  return (
    <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Leaf className="w-4 h-4 text-emerald-600" />
        <h2 className="text-sm font-bold text-emerald-900">Your Green Impact</h2>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat icon={Coins} value={credits} label="Green credits" accent="text-amber-600" />
        <Stat icon={Leaf} value={`${co2} kg`} label="CO₂ saved" accent="text-emerald-600" />
        <Stat icon={Droplets} value={`${water.toLocaleString()} L`} label="Water saved" accent="text-sky-600" />
      </div>
      <p className="text-[11px] text-emerald-700/70 mt-3">
        Credits are redeemable as a checkout discount (1 credit = ₹10). Figures are estimates with cited sources.
      </p>
    </div>
  );
}

function Stat({ icon: Icon, value, label, accent }) {
  return (
    <div className="bg-white/70 rounded-xl p-3 text-center">
      <Icon className={`w-4 h-4 mx-auto mb-1 ${accent}`} />
      <p className="text-lg font-black text-gray-900 leading-tight">{value}</p>
      <p className="text-[10px] text-gray-500 font-medium">{label}</p>
    </div>
  );
}
