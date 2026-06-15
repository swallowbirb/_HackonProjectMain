import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, AlertCircle, ShieldCheck, Recycle, CheckCircle2, MapPin, X, Zap, FileText, ChevronDown, Leaf, Coins, Code,
} from 'lucide-react';
import { getResaleListing, getDevLogs } from '../services/resale.service';
import { createOrder } from '../services/order.service';
import { getUserImpact, redeemCredits } from '../services/sustainability.service';
import { useCustomUser } from '../context/CustomUserContext';
import GradeBadge from '../components/resale/GradeBadge';

const DELIVERY_CITIES = ['Raipur', 'Bhilai', 'Durg', 'Bilaspur', 'Korba', 'Raigarh', 'Jagdalpur'];

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
  const [deliveryCity, setDeliveryCity] = useState(DELIVERY_CITIES[0]);
  const [card, setCard] = useState('');
  const [isOrdering, setIsOrdering] = useState(false);
  const [orderError, setOrderError] = useState('');
  const [orderSuccess, setOrderSuccess] = useState(false);

  // Phase 8 — green credits.
  const [creditBalance, setCreditBalance] = useState(0);
  const [useCredits, setUseCredits] = useState(false);
  const [creditsRedeemed, setCreditsRedeemed] = useState(0);

  // Dev Logs modal
  const [showDevLogs, setShowDevLogs] = useState(false);
  const [devLogs, setDevLogs] = useState(null);
  const [devLogsLoading, setDevLogsLoading] = useState(false);

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

  // Load the buyer's credit balance for the checkout redeem option.
  useEffect(() => {
    if (!mongoUser?._id) return;
    getUserImpact(mongoUser._id)
      .then((res) => { if (res.success) setCreditBalance(res.data.creditBalance || 0); })
      .catch(() => {});
  }, [mongoUser]);

  const price = Number(listing?.price || 0);
  const RUPEE_PER_CREDIT = 10;
  const maxRedeemCredits = Math.min(creditBalance, Math.floor((price - 1) / RUPEE_PER_CREDIT)); // keep ₹1 minimum payable
  const discount = useCredits ? maxRedeemCredits * RUPEE_PER_CREDIT : 0;
  const payable = Math.max(0, price - discount);

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
        // Redeem credits against this order if the buyer chose to.
        if (useCredits && discount > 0) {
          try {
            const r = await redeemCredits(maxRedeemCredits, res.data?._id);
            if (r.success) setCreditsRedeemed(r.data.creditsSpent || maxRedeemCredits);
          } catch { /* redemption non-fatal */ }
        }
        setShowCheckout(false);
        setOrderSuccess(true);
      }
    } catch (err) {
      setOrderError(err.response?.data?.message || 'Failed to place order. Please try again.');
    } finally {
      setIsOrdering(false);
    }
  };

  const handleShowDevLogs = async () => {
    setShowDevLogs(true);
    if (!devLogs) {
      setDevLogsLoading(true);
      try {
        const res = await getDevLogs(id);
        if (res.success) setDevLogs(res.data);
      } catch (err) {
        console.error('Failed to load dev logs:', err);
      } finally {
        setDevLogsLoading(false);
      }
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

            {/* Green-credits incentive (Phase 8) */}
            <div className="mt-3 inline-flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-full px-3 py-1.5">
              <Coins className="w-3.5 h-3.5 text-amber-600" />
              <span className="text-xs font-semibold text-emerald-800">Earn 10 green credits</span>
              <span className="text-emerald-300">·</span>
              <Leaf className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-xs text-emerald-700">buying second-hand saves CO₂</span>
            </div>

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
                  <p className="text-sm text-emerald-700 mt-1 flex items-center justify-center gap-1">
                    <Coins className="w-4 h-4 text-amber-600" /> +10 green credits earned
                  </p>
                  {creditsRedeemed > 0 && (
                    <p className="text-xs text-emerald-700 mt-0.5">
                      Redeemed {creditsRedeemed} credit{creditsRedeemed === 1 ? '' : 's'} (−₹{creditsRedeemed * RUPEE_PER_CREDIT}) on this order.
                    </p>
                  )}
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

        {/* Dev Logs Button - Bottom Left */}
        <div className="fixed bottom-6 left-6 z-40">
          <button
            onClick={handleShowDevLogs}
            className="flex items-center gap-2 bg-gray-700 hover:bg-gray-800 text-white px-4 py-2.5 rounded-lg shadow-lg text-sm font-semibold transition-all"
          >
            <Code className="w-4 h-4" />
            Dev Logs
          </button>
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
              {/* Delivery city */}
              <label className="block text-xs font-semibold text-gray-600 mb-1 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" /> Delivery City
              </label>
              <div className="relative mb-4">
                <select
                  value={deliveryCity}
                  onChange={(e) => setDeliveryCity(e.target.value)}
                  className="w-full appearance-none bg-gray-50 border border-gray-300 rounded-lg px-3 py-2.5 pr-9 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#FF9900] cursor-pointer"
                >
                  {DELIVERY_CITIES.map((c) => (
                    <option key={c} value={c}>{c}, Chhattisgarh</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>

              {/* Redeem green credits (Phase 8) */}
              {creditBalance > 0 && maxRedeemCredits > 0 && (
                <label className="flex items-start gap-2 bg-emerald-50 border border-emerald-100 rounded-xl p-3 mb-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useCredits}
                    onChange={(e) => setUseCredits(e.target.checked)}
                    className="mt-0.5 accent-emerald-600"
                  />
                  <span className="text-xs text-emerald-900">
                    Use <span className="font-bold">{maxRedeemCredits}</span> of your {creditBalance} green credits
                    <span className="font-semibold"> (−₹{maxRedeemCredits * RUPEE_PER_CREDIT})</span>
                    <span className="block text-emerald-700/60">1 credit = ₹{RUPEE_PER_CREDIT}</span>
                    {useCredits && (
                      <span className="block mt-1 text-emerald-700 font-semibold">You pay ₹{payable.toLocaleString()}</span>
                    )}
                  </span>
                </label>
              )}

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

      {/* Dev Logs Modal */}
      <AnimatePresence>
        {showDevLogs && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-5xl bg-gray-900 text-gray-100 rounded-2xl shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
            >
              <div className="flex items-center justify-between p-5 border-b border-gray-700">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Code className="w-5 h-5 text-emerald-400" />
                  Developer Logs - Algorithm & Calculations
                </h2>
                <button onClick={() => setShowDevLogs(false)} className="text-gray-400 hover:text-gray-200">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="overflow-y-auto p-5 space-y-5">
                {devLogsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
                  </div>
                ) : devLogs ? (
                  <>
                    {/* Summary */}
                    <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                      <h3 className="text-sm font-bold text-emerald-400 mb-3">Listing Summary</h3>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div><span className="text-gray-400">Item ID:</span> <code className="text-gray-200">{devLogs.itemId}</code></div>
                        <div><span className="text-gray-400">Intake Path:</span> <code className="text-amber-300">{devLogs.intakePath}</code></div>
                        <div><span className="text-gray-400">Status:</span> <code className="text-emerald-300">{devLogs.status}</code></div>
                        <div><span className="text-gray-400">Auto-Listed:</span> <code className="text-cyan-300">{devLogs.autoListed ? 'Yes' : 'No'}</code></div>
                        <div><span className="text-gray-400">Created:</span> <code className="text-gray-200">{new Date(devLogs.createdAt).toLocaleString()}</code></div>
                        {devLogs.publishedAt && (
                          <div><span className="text-gray-400">Published:</span> <code className="text-gray-200">{new Date(devLogs.publishedAt).toLocaleString()}</code></div>
                        )}
                      </div>
                    </div>

                    {/* Grading Details */}
                    {devLogs.gradeDetails && (
                      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                        <h3 className="text-sm font-bold text-emerald-400 mb-3">AI Grading Analysis</h3>
                        <div className="space-y-2 text-sm">
                          <div className="grid grid-cols-3 gap-3">
                            <div><span className="text-gray-400">Grade:</span> <span className="font-bold text-xl text-emerald-300">{devLogs.gradeDetails.grade}</span></div>
                            <div><span className="text-gray-400">Quality Score:</span> <span className="font-bold text-xl text-cyan-300">{devLogs.gradeDetails.qualityScore}/100</span></div>
                            <div><span className="text-gray-400">Confidence:</span> <code className="text-amber-300">{devLogs.gradeDetails.confidence}</code></div>
                          </div>
                          <div><span className="text-gray-400">Estimated Resale %:</span> <code className="text-emerald-300">{(devLogs.gradeDetails.estimatedResalePct * 100).toFixed(1)}%</code></div>
                          <div><span className="text-gray-400">Routing Hint:</span> <code className="text-cyan-300">{devLogs.gradeDetails.routingHint}</code></div>
                          <div><span className="text-gray-400">Return Claim Verified:</span> <code className="text-amber-300">{devLogs.gradeDetails.returnClaimVerified ? 'Yes' : 'No'}</code></div>
                          {devLogs.gradeDetails.rationale && (
                            <div className="mt-2 pt-2 border-t border-gray-700">
                              <span className="text-gray-400 block mb-1">AI Rationale:</span>
                              <p className="text-gray-200 text-sm leading-relaxed">{devLogs.gradeDetails.rationale}</p>
                            </div>
                          )}
                          {devLogs.gradeDetails.defects?.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-gray-700">
                              <span className="text-gray-400 block mb-2">Detected Defects:</span>
                              <ul className="space-y-1">
                                {devLogs.gradeDetails.defects.map((d, i) => (
                                  <li key={i} className="text-orange-300 text-xs">• {d.severity} {d.type} {d.location && `(${d.location})`}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Pricing Calculation */}
                    {devLogs.pricingCalculation && (
                      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                        <h3 className="text-sm font-bold text-emerald-400 mb-3">Pricing Algorithm</h3>
                        <div className="space-y-2 text-sm font-mono">
                          <div className="text-gray-400 mb-2">Formula: <code className="text-cyan-300">{devLogs.pricingCalculation.formula}</code></div>
                          <div className="grid grid-cols-2 gap-3">
                            <div><span className="text-gray-400">Original Price:</span> <code className="text-emerald-300">₹{devLogs.pricingCalculation.originalPrice.toLocaleString()}</code></div>
                            <div><span className="text-gray-400">Resale %:</span> <code className="text-cyan-300">{(devLogs.pricingCalculation.estimatedResalePct * 100).toFixed(1)}%</code></div>
                            <div><span className="text-gray-400">Demand Count:</span> <code className="text-amber-300">{devLogs.pricingCalculation.demandCount}</code></div>
                            <div><span className="text-gray-400">Demand Multiplier:</span> <code className="text-amber-300">{devLogs.pricingCalculation.demandMultiplier.toFixed(2)}x</code></div>
                          </div>
                          <div className="mt-3 pt-3 border-t border-gray-700 text-gray-300">
                            Calculation: <code className="text-gray-100">{devLogs.pricingCalculation.calculation}</code>
                          </div>
                          <div className="grid grid-cols-2 gap-3 mt-2">
                            <div><span className="text-gray-400">Suggested Price:</span> <code className="text-lg font-bold text-emerald-300">₹{devLogs.pricingCalculation.suggestedPrice.toLocaleString()}</code></div>
                            <div><span className="text-gray-400">Final Price:</span> <code className="text-lg font-bold text-cyan-300">₹{devLogs.pricingCalculation.finalPrice.toLocaleString()}</code></div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Routing Decision */}
                    {devLogs.routingDetails && (
                      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                        <h3 className="text-sm font-bold text-emerald-400 mb-3">Routing Decision</h3>
                        <div className="space-y-2 text-sm">
                          <div><span className="text-gray-400">Chosen Path:</span> <code className="text-lg font-bold text-emerald-300">{devLogs.routingDetails.chosenPath}</code></div>
                          <div><span className="text-gray-400">Refund Timing:</span> <code className="text-cyan-300">{devLogs.routingDetails.refundTiming}</code></div>
                          {devLogs.routingDetails.chosenWarehouse && (
                            <div><span className="text-gray-400">Warehouse:</span> <code className="text-amber-300">{devLogs.routingDetails.chosenWarehouse.name} ({devLogs.routingDetails.chosenWarehouse.city})</code></div>
                          )}
                          <div><span className="text-gray-400">Demand Signal:</span> <code className="text-cyan-300">{devLogs.routingDetails.demandSignal.count || 0} buyers within {devLogs.routingDetails.demandSignal.radiusKm || 25}km</code></div>
                          {devLogs.routingDetails.hardGatesApplied?.length > 0 && (
                            <div><span className="text-gray-400">Hard Gates Applied:</span> <code className="text-red-300">{devLogs.routingDetails.hardGatesApplied.join(', ')}</code></div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Complete Pipeline Logs */}
                    {devLogs.logs?.length > 0 && (
                      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                        <h3 className="text-sm font-bold text-emerald-400 mb-3">Complete Pipeline Logs ({devLogs.logs.length} events)</h3>
                        <div className="space-y-1 max-h-96 overflow-y-auto text-xs font-mono">
                          {devLogs.logs.map((log, i) => (
                            <div key={i} className={`py-1 px-2 rounded ${
                              log.level === 'error' ? 'bg-red-900/30 text-red-300' :
                              log.level === 'warn' ? 'bg-amber-900/30 text-amber-300' :
                              log.level === 'success' ? 'bg-emerald-900/30 text-emerald-300' :
                              'bg-gray-700/50 text-gray-300'
                            }`}>
                              <span className="text-gray-500">{new Date(log.timestamp).toLocaleTimeString()}</span>
                              {' | '}
                              <span className="text-cyan-400">{log.phase}</span>
                              {' | '}
                              <span className="font-semibold">{log.step}</span>
                              {' | '}
                              <span>{log.message}</span>
                              {log.durationMs && <span className="text-gray-500"> ({log.durationMs}ms)</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-12 text-gray-400">
                    <AlertCircle className="w-12 h-12 mx-auto mb-3 text-gray-600" />
                    <p>Could not load developer logs.</p>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
