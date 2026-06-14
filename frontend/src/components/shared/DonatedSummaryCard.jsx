import { useEffect, useState } from 'react';
import { Gift, MapPin, Leaf, Droplets, Coins, FileText, Loader2 } from 'lucide-react';
import { getDonationDetails, getReceiptUrl } from '../../services/sustainability.service';

/**
 * Persistent "Donated" summary shown on the item status page once an item's
 * status is DONATED. Survives reload (data comes from the backend).
 */
export default function DonatedSummaryCard({ itemId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await getDonationDetails(itemId);
        if (alive && res.success) setData(res.data);
      } catch {
        /* non-fatal */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [itemId]);

  if (loading) {
    return (
      <div className="bg-teal-50 border border-teal-100 rounded-2xl p-6 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-teal-400" />
      </div>
    );
  }

  const ngoName = data?.ngo?.name || 'a local NGO';
  const credits = data?.creditsEarned ?? 25;
  const co2 = data?.co2SavedKg ?? 0;
  const water = data?.waterSavedLiters ?? 0;
  const donatedAt = data?.donatedAt ? new Date(data.donatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null;

  return (
    <div className="bg-gradient-to-br from-teal-50 to-emerald-50 border border-teal-200 rounded-2xl p-6 shadow-sm">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 rounded-2xl bg-teal-600 flex items-center justify-center">
          <Gift className="w-6 h-6 text-white" />
        </div>
        <div>
          <p className="font-black text-teal-900 text-lg leading-tight">Donated 🎁</p>
          <p className="text-sm text-teal-700 flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5" /> {ngoName}
            {data?.ngo?.city ? `, ${data.ngo.city}` : ''}
            {donatedAt ? ` · ${donatedAt}` : ''}
          </p>
        </div>
      </div>

      {/* Impact stats */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Stat icon={Coins} value={`+${credits}`} label="Green credits" accent="text-amber-600" />
        <Stat icon={Leaf} value={`${co2} kg`} label="CO₂ saved" accent="text-emerald-600" />
        <Stat icon={Droplets} value={`${water.toLocaleString()} L`} label="Water saved" accent="text-sky-600" />
      </div>

      {/* Receipt */}
      {data?.receiptAvailable ? (
        <a
          href={getReceiptUrl(itemId)}
          download={`donation-receipt-${itemId}.pdf`}
          className="inline-flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 rounded-full transition-colors"
        >
          <FileText className="w-4 h-4" /> Download tax receipt
        </a>
      ) : (
        <p className="text-xs text-teal-700/70">Tax receipt is being prepared.</p>
      )}

      {data?.factorSource && (
        <p className="text-[11px] text-teal-700/60 mt-3">Impact estimate source: {data.factorSource}</p>
      )}
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
