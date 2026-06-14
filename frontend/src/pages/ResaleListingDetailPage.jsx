import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, AlertCircle, ShieldCheck, Recycle, CheckCircle2, MapPin, X, Zap, FileText,
} from 'lucide-react';
import { getResaleListing } from '../services/resale.service';
import { createOrder } from '../services/order.service';
import { useCustomUser } from '../context/CustomUserContext';
import GradeBadge from '../components/resale/GradeBadge';

const SEVERITY_STYLE = {
  minor: 'bg-yellow-50 text-yellow-700',
  moderate: 'bg-orange-50 text-orange-700',
  major: 'bg-red-50 text-red-700',
};

export default function ResaleListingDetailPage() {
  const { id } = useParams();
  const { mongoUser } = useCustomUser();
  const [listing, setListing] = useState(null);
  const [activeImg, setActiveImg] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [showCheckout, setShowCheckout] = useState(false);
  const [card, setCard] = useState('');
  const [isOrdering, setIsOrdering] = useState(false);
  const [orderError, setOrderError] = useState('');
  const [orderSuccess, setOrderSuccess] = useState(false);

  const fetchListing = useCallback(async () => {
    try {
      const res = await getResaleListing(id);
      if (res.success) setListing(res.data);
      else setError('Listing not found.');
    } catch {
      setError('Could not load this listing.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchListing(); }, [fetchListing]);

  const handleConfirmPurchase = async () => {
    if (!listing?.marketplaceProductId) {
      setOrderError('This listing is not yet available for purchase.');
      return;
    }
    setIsOrdering(true);
    setOrderError('');
    try {
      const res = await createOrder({ productId: listing.marketplaceProductId, quantity: 1, mockCreditCard: card });
      if (res.success) {
        setShowCheckout(false);
        setOrderSuccess(true);
      }
    } catch (err) {
      setOrderError(err.response?.data?.message || 'Failed to place order. Please try again.');
    } finally {
      setIsOrdering(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#EAEDED] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="min-h-screen bg-[#EAEDED] flex flex-col items-center justify-center text-center px-4">
        <AlertCircle className="w-12 h-12 text-red-400 mb-4" />
        <p className="text-gray-600">{error || 'Listing not found.'}</p>
        <Link to="/resale" className="mt-4 text-sm text-[#007185] underline">Back to second-life marketplace</Link>
      </div>
    );
  }

  const images = listing.images?.length ? listing.images : ['https://picsum.photos/seed/resale/600/600'];
  const isPublished = listing.status === 'PUBLISHED';
  const isSold = listing.status === 'SOLD';

  return (
    <div className="min-h-screen bg-[#EAEDED]">
      <div className="max-w-[1200px] mx-auto px-4 md:px-6 py-6">
        <Link to="/resale" className="text-sm text-[#007185] hover:text-[#C7511F]">← Second-Life Marketplace</Link>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-4">
          {/* Gallery */}
          <div>
            <div className="bg-white rounded-md border border-gray-200 aspect-square overflow-hidden">
              <img src={images[activeImg]} alt={listing.title} className="w-full h-full object-contain" />
            </div>
            {images.length > 1 && (
              <div className="flex gap-2 mt-3">
                {images.map((img, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveImg(i)}
                    className={`w-16 h-16 rounded border overflow-hidden ${i === activeImg ? 'border-[#FF9900] ring-1 ring-[#FF9900]' : 'border-gray-200'}`}
                  >
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Details */}
          <div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-1 rounded">
              <Recycle className="w-3.5 h-3.5" /> Certified Pre-Owned
            </span>
            <h1 className="text-2xl font-bold text-gray-900 mt-2 leading-tight">{listing.title}</h1>

            <div className="flex items-baseline gap-3 mt-3">
              <span className="text-3xl font-bold text-[#B12704]">₹{Number(listing.price).toLocaleString()}</span>
              {listing.originalPrice > listing.price && (
                <span className="text-sm text-gray-400 line-through">₹{Number(listing.originalPrice).toLocaleString()}</span>
              )}
            </div>

            {listing.demandCount > 0 && (
              <p className="flex items-center gap-1 text-xs text-gray-600 mt-2">
                <MapPin className="w-3.5 h-3.5 text-emerald-600" /> {listing.demandCount} buyer{listing.demandCount === 1 ? '' : 's'} nearby want this
              </p>
            )}

            {/* Grade card */}
            <div className="mt-5 bg-white border border-gray-200 rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <GradeBadge grade={listing.grade} size="lg" showLane={false} />
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-400 font-semibold">AI Quality Score</p>
                    <p className="text-2xl font-black text-gray-900">{listing.qualityScore ?? '—'}<span className="text-base text-gray-400">/100</span></p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
                  <ShieldCheck className="w-4 h-4" /> Condition: {listing.conditionLane}
                </span>
              </div>

              {/* Defects */}
              {listing.defects?.length > 0 ? (
                <div className="mt-4">
                  <p className="text-xs font-semibold text-gray-600 mb-2">Condition details</p>
                  <ul className="space-y-1.5">
                    {listing.defects.map((d, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${SEVERITY_STYLE[d.severity] || 'bg-gray-100 text-gray-600'}`}>
                          {d.severity}
                        </span>
                        <span className="text-gray-700">
                          {d.type}{d.location ? ` (${d.location})` : ''}{d.description ? ` — ${d.description}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-4 flex items-center gap-2 text-sm text-emerald-700">
                  <CheckCircle2 className="w-4 h-4" /> No significant defects detected during grading.
                </p>
              )}

              {/* AI rationale */}
              {listing.gradeRationale && (
                <div className="mt-4 border-t border-gray-100 pt-3">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 mb-1">
                    <FileText className="w-3.5 h-3.5" /> Why this grade?
                  </p>
                  <p className="text-sm text-gray-600 leading-relaxed">{listing.gradeRationale}</p>
                </div>
              )}
            </div>

            {/* Previous-owner notes */}
            {listing.previousOwnerNotes && (
              <div className="mt-4 bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <p className="text-xs font-semibold text-amber-800 mb-1">Note from the previous owner</p>
                <p className="text-sm text-amber-900/90 leading-relaxed whitespace-pre-line">{listing.previousOwnerNotes}</p>
              </div>
            )}

            {/* Description */}
            {listing.description && (
              <div className="mt-4">
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{listing.description}</p>
              </div>
            )}

            {/* Buy */}
            <div className="mt-6">
              {orderSuccess ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                  <p className="font-semibold text-emerald-800">Order placed!</p>
                  <Link to="/orders" className="text-sm text-[#007185] underline mt-1 inline-block">View your orders</Link>
                </div>
              ) : isSold ? (
                <button disabled className="w-full bg-gray-200 text-gray-500 py-2.5 rounded-full text-sm font-semibold">Sold</button>
              ) : !isPublished ? (
                <p className="text-sm text-gray-500">This listing is not currently available for purchase.</p>
              ) : !mongoUser ? (
                <Link to="/sign-in" className="block w-full amz-btn-primary py-2.5 rounded-full text-sm font-semibold text-center">
                  Sign in to buy
                </Link>
              ) : (
                <button
                  onClick={() => { setOrderError(''); setShowCheckout(true); }}
                  className="w-full amz-btn-primary py-2.5 rounded-full text-sm font-semibold flex items-center justify-center gap-2"
                >
                  <Zap className="w-4 h-4" /> Buy Now
                </button>
              )}
              {orderError && <p className="text-xs text-red-600 mt-2">{orderError}</p>}
            </div>
          </div>
        </div>
      </div>

      {/* Checkout modal */}
      <AnimatePresence>
        {showCheckout && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-900">Checkout</h2>
                <button onClick={() => setShowCheckout(false)} className="text-gray-400 hover:text-gray-700">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm text-gray-600 mb-1">{listing.title}</p>
              <p className="text-2xl font-bold text-[#B12704] mb-4">₹{Number(listing.price).toLocaleString()}</p>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Mock card number (simulated)</label>
              <input
                value={card}
                onChange={(e) => setCard(e.target.value)}
                placeholder="4242 4242 4242 4242"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-[#FF9900]"
              />
              {orderError && <p className="text-xs text-red-600 mb-2">{orderError}</p>}
              <button
                onClick={handleConfirmPurchase}
                disabled={isOrdering || card.trim().length < 4}
                className="w-full amz-btn-primary py-2.5 rounded-full text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isOrdering ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Place Order'}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
