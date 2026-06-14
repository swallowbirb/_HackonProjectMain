import { useState } from 'react';
import { Gift, Loader2, CheckCircle2, FileText, MapPin } from 'lucide-react';
import { donateItem, getReceiptUrl } from '../../services/sustainability.service';

/**
 * "Donate instead" action for an owner's graded item. Triggers the donation
 * flow (NGO match + 25 credits + tax receipt) and shows the result inline.
 */
export default function DonateItemCard({ itemId, onDonated }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleDonate = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await donateItem(itemId);
      if (res.success) {
        setResult(res.data);
        onDonated?.(res.data);
      } else {
        setError('Could not complete the donation.');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Could not complete the donation.');
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    const ngoName = result.ngo?.name || 'a local NGO';
    return (
      <div className="bg-teal-50 border border-teal-200 rounded-2xl p-5 mt-6">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle2 className="w-5 h-5 text-teal-600" />
          <p className="font-bold text-teal-900 text-sm">Donation complete 🎁</p>
        </div>
        <p className="text-sm text-teal-800 flex items-center gap-1.5 mb-1">
          <MapPin className="w-3.5 h-3.5" /> Routed to <span className="font-semibold">{ngoName}</span>
        </p>
        <p className="text-sm text-teal-800 mb-1">
          You earned <span className="font-bold">+{result.creditsEarned} green credits</span>.
        </p>
        <p className="text-xs text-teal-700/80 mb-3">
          ~{result.impact?.co2SavedKg} kg CO₂ and {Number(result.impact?.waterSavedLiters || 0).toLocaleString()} L water saved.
        </p>
        <a
          href={getReceiptUrl(itemId)}
          download={`donation-receipt-${itemId}.pdf`}
          className="inline-flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 rounded-full transition-colors"
        >
          <FileText className="w-4 h-4" /> Download tax receipt
        </a>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 mt-6">
      <div className="flex items-center gap-2 mb-2">
        <Gift className="w-4 h-4 text-teal-600" />
        <p className="font-bold text-gray-900 text-sm">Prefer to donate?</p>
      </div>
      <p className="text-xs text-gray-500 mb-4 leading-relaxed">
        Give this item to a nearby NGO instead of reselling. You'll get a tax receipt and earn
        <span className="font-semibold text-teal-700"> 25 green credits</span> — the highest reward,
        because donating has the greatest impact.
      </p>

      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="inline-flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white font-semibold px-4 py-2 rounded-full text-sm transition-colors"
        >
          <Gift className="w-4 h-4" /> Donate instead
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <button
            onClick={handleDonate}
            disabled={loading}
            className="inline-flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white font-semibold px-4 py-2 rounded-full text-sm disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Confirm donation
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={loading}
            className="text-sm text-gray-500 font-medium px-3 py-2"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
