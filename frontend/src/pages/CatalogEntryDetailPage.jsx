import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { getCatalogEntryById } from '../services/catalogEntry.service';
import { getOffersByCatalogEntry } from '../services/offer.service';
import { getReviewsByProduct } from '../services/review.service';
import ReviewCard from '../components/shared/ReviewCard';
import ReviewForm from '../components/shared/ReviewForm';
import CheckoutModal from '../components/shared/CheckoutModal';
import {
  Shield, ShoppingCart, ChevronLeft, ChevronRight,
  Star, Truck, Package, Award, Loader2, AlertCircle,
  Tag, Users, ExternalLink, CheckCircle, Zap,
} from 'lucide-react';
import { useCustomUser } from '../context/CustomUserContext';
import { createOrder } from '../services/order.service';

function StarRow({ rating = 0, count = 0 }) {
  return (
    <div className="flex items-center gap-1.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`w-4 h-4 ${i <= Math.round(rating) ? 'fill-[#FF9900] text-[#FF9900]' : 'text-zinc-700'}`}
        />
      ))}
      {count > 0 && <span className="text-xs text-zinc-400 ml-1">{count} ratings</span>}
    </div>
  );
}

// Image gallery
function ImageGallery({ images, title }) {
  const [active, setActive] = useState(0);
  if (!images || images.length === 0) {
    return (
      <div className="aspect-square bg-zinc-800 rounded-2xl flex items-center justify-center">
        <Package className="w-16 h-16 text-zinc-600" />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="aspect-square bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800">
        <motion.img
          key={active}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          src={images[active]}
          alt={title}
          className="w-full h-full object-contain p-4"
        />
      </div>
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((img, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              className={`flex-shrink-0 w-16 h-16 rounded-xl overflow-hidden border-2 transition-all ${
                active === i ? 'border-[#FF9900]' : 'border-zinc-800 hover:border-zinc-600'
              }`}
            >
              <img src={img} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Buy Box widget
function BuyBoxWidget({ offers, onBuyNow, isBuying }) {
  const winner = offers.find((o) => o.isBuyBoxWinner) || offers[0];
  if (!winner) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 text-center">
        <Package className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
        <p className="text-lg font-bold text-red-500 mb-1">Currently Unavailable</p>
        <p className="text-xs text-zinc-400">Out of Stock</p>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      {/* Buy Box header */}
      <div className="bg-[#FF9900]/10 border-b border-[#FF9900]/20 px-5 py-3 flex items-center gap-2">
        <Zap className="w-4 h-4 text-[#FF9900]" />
        <span className="text-xs font-bold text-[#FF9900]">Buy Box</span>
        <span className="text-xs text-zinc-500">— Best offer selected automatically</span>
      </div>

      <div className="p-5 space-y-4">
        {/* Price */}
        <div>
          <span className="text-3xl font-black text-white">${winner.price.toFixed(2)}</span>
        </div>

        {/* Seller info */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-white">
            {(winner.sellerId?.storeName || winner.sellerId?.firstName || '?')[0]?.toUpperCase()}
          </div>
          <div>
            <p className="text-xs text-zinc-400">Sold by <span className="text-white font-medium">{winner.sellerId?.storeName || `${winner.sellerId?.firstName} ${winner.sellerId?.lastName}`.trim()}</span></p>
          </div>
        </div>



        {/* Quantity */}
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Tag className="w-3.5 h-3.5" />
          {winner.quantity} in stock
        </div>

        {/* Buy button */}
        <button
          onClick={() => onBuyNow(winner)}
          disabled={isBuying}
          className="w-full bg-[#FF9900] text-black font-bold py-3.5 rounded-xl hover:bg-[#FFB347] active:scale-[0.99] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isBuying ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
          {isBuying ? 'Placing Order...' : 'Buy Now'}
        </button>

        {offers.length > 1 && (
          <p className="text-xs text-center text-zinc-500">
            {offers.length} sellers offer this product
          </p>
        )}
      </div>
    </div>
  );
}

// All offers table
function AllOffersSection({ offers, onBuyNow, isBuying }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      <div className="p-5 border-b border-zinc-800 flex items-center gap-2">
        <Users className="w-4 h-4 text-zinc-400" />
        <h2 className="font-bold text-sm">All Sellers ({offers.length})</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-zinc-800/50 text-xs text-zinc-400">
            <tr>
              <th className="px-4 py-3 font-medium">Seller</th>
              <th className="px-4 py-3 font-medium">Price</th>
              <th className="px-4 py-3 font-medium">Stock</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {offers.map((offer) => (
              <tr key={offer._id} className={`border-b border-zinc-800/50 transition-colors ${offer.isBuyBoxWinner ? 'bg-[#FF9900]/3' : 'hover:bg-zinc-800/20'}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {offer.isBuyBoxWinner && (
                      <span className="text-[10px] bg-[#FF9900]/10 text-[#FF9900] border border-[#FF9900]/20 px-1.5 py-0.5 rounded-full font-bold">Buy Box</span>
                    )}
                    <div>
                      <p className="text-sm font-medium text-white">
                        {offer.sellerId?.storeName || `${offer.sellerId?.firstName} ${offer.sellerId?.lastName}`.trim()}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm font-bold text-white">${offer.price.toFixed(2)}</span>
                </td>
                <td className="px-4 py-3 text-xs text-zinc-400">{offer.quantity}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => onBuyNow(offer)}
                    disabled={isBuying}
                    className="text-xs bg-[#FF9900] text-black font-bold px-3 py-1.5 rounded-lg hover:bg-[#FFB347] transition-colors disabled:opacity-50"
                  >
                    Buy from this seller
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CatalogEntryDetailPage() {
  const { entryId } = useParams();
  const navigate = useNavigate();
  const { isSignedIn, role, mongoUser } = useCustomUser();

  const [entry, setEntry] = useState(null);
  const [offers, setOffers] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [reviewMeta, setReviewMeta] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isBuying, setIsBuying] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(null);
  const [orderError, setOrderError] = useState('');
  
  const [showCheckout, setShowCheckout] = useState(false);
  const [selectedOffer, setSelectedOffer] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [entryRes, offersRes, reviewRes] = await Promise.all([
          getCatalogEntryById(entryId),
          getOffersByCatalogEntry(entryId),
          getReviewsByProduct(entryId, 1, 8),
        ]);
        if (entryRes.success) setEntry(entryRes.data);
        if (offersRes.success) setOffers(offersRes.data);
        if (reviewRes?.success) {
          setReviews(reviewRes.data.reviews);
          setReviewMeta(reviewRes.data);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [entryId]);

  const handleBuyNow = (offer) => {
    if (!isSignedIn) {
      navigate('/sign-in');
      return;
    }
    if (role !== 'buyer' && role !== 'admin') {
      setOrderError('Only buyer accounts can purchase items.');
      return;
    }
    setSelectedOffer(offer);
    setShowCheckout(true);
  };

  const handleConfirmPurchase = async (mockCreditCard) => {
    if (!selectedOffer) return;
    setIsBuying(true);
    setOrderError('');
    try {
      const res = await createOrder({ offerId: selectedOffer._id, quantity: 1, mockCreditCard });
      if (res.success) {
        setShowCheckout(false);
        setOrderSuccess(selectedOffer);
      }
    } catch (err) {
      setOrderError(err.response?.data?.message || 'Purchase failed');
      setShowCheckout(false);
    } finally {
      setIsBuying(false);
    }
  };

  const handleReviewSuccess = (newReview) => {
    setReviews((prev) => [newReview, ...prev]);
    setReviewMeta((prev) => ({ ...prev, total: (prev.total || 0) + 1 }));
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <Package className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">Product Not Found</h1>
          <Link to="/" className="text-[#FF9900] hover:underline text-sm">Return to marketplace</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white font-sans">

      {/* Order success banner */}
      <AnimatePresence>
        {orderSuccess && (
          <motion.div
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className="fixed top-0 left-0 right-0 z-50 bg-emerald-500 text-white py-4 px-6 flex items-center justify-between shadow-xl"
          >
            <div className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5" />
              <span className="font-semibold">Order placed successfully!</span>
              <span className="text-emerald-100 text-sm">From {orderSuccess.sellerId?.storeName || 'seller'} · ${orderSuccess.price.toFixed(2)}</span>
            </div>
            <button onClick={() => setOrderSuccess(null)} className="text-emerald-100 hover:text-white text-lg">×</button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-7xl mx-auto px-4 py-8">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-zinc-500 mb-6">
          <Link to="/" className="hover:text-white transition-colors">Marketplace</Link>
          <ChevronRight className="w-3 h-3" />
          {entry.brandId && (
            <>
              <Link to={`/brand-store/${entry.brandId._id}`} className="text-[#FF9900] hover:underline hover:text-[#FFB347]">{entry.brandId.name}</Link>
              <ChevronRight className="w-3 h-3" />
            </>
          )}
          <span className="text-zinc-300 truncate max-w-48">{entry.title}</span>
        </div>

        {/* Main content grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

          {/* Image gallery */}
          <div className="lg:col-span-4">
            <ImageGallery images={entry.officialImages} title={entry.title} />
          </div>

          {/* Product info */}
          <div className="lg:col-span-5 space-y-5">
            {/* Brand badge */}
            {entry.brandId && (
              <div className="flex items-center gap-2">
                <Link to={`/brand-store/${entry.brandId._id}`} className="hover:opacity-80 transition-opacity">
                  {entry.brandId.logoUrl ? (
                    <img src={entry.brandId.logoUrl} alt={entry.brandId.name} className="h-6 object-contain bg-white rounded px-1" />
                  ) : (
                    <span className="text-sm font-bold text-[#FF9900] flex items-center gap-1 hover:underline">
                      <Shield className="w-3.5 h-3.5" /> {entry.brandId.name}
                    </span>
                  )}
                </Link>
                {entry.brandId.isVerified && (
                  <span className="text-[10px] bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full">✓ Verified Brand</span>
                )}
              </div>
            )}

            <h1 className="text-2xl font-black text-white leading-tight">{entry.title}</h1>

            <div className="flex items-center gap-3">
              <StarRow rating={0} count={0} />
            </div>

            {/* Price summary from buy box */}
            {offers.length > 0 && (
              <div>
                <span className="text-3xl font-black">
                  ${(offers.find(o => o.isBuyBoxWinner) || offers[0])?.price.toFixed(2)}
                </span>
                {offers.length > 1 && (
                  <span className="ml-2 text-xs text-zinc-500">{offers.length} offers from ${Math.min(...offers.map(o => o.price)).toFixed(2)}</span>
                )}
              </div>
            )}

            {/* Bullet points */}
            {entry.bulletPoints?.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">About this item</p>
                <ul className="space-y-1.5">
                  {entry.bulletPoints.map((bp, i) => (
                    <li key={i} className="text-sm text-zinc-300 flex items-start gap-2">
                      <span className="text-[#FF9900] mt-1 flex-shrink-0">•</span>
                      {bp}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Description */}
            <div>
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">Description</p>
              <p className="text-sm text-zinc-400 leading-relaxed">{entry.description}</p>
            </div>

            {/* Tags */}
            {entry.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {entry.tags.map((tag) => (
                  <span key={tag} className="text-xs bg-zinc-800 text-zinc-400 px-2.5 py-1 rounded-full hover:bg-zinc-700 cursor-pointer transition-colors">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Brand content notice */}
            <div className="flex items-start gap-2 bg-blue-500/5 border border-blue-500/15 rounded-xl p-3">
              <Award className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-zinc-500 leading-relaxed">
                This product page is maintained exclusively by <span className="text-white font-medium">{entry.brandId?.name}</span>.
                Title, images, and description reflect official brand content — the AI ground truth for counterfeit detection.
              </p>
            </div>

            {orderError && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-400">{orderError}</p>
              </div>
            )}
          </div>

          {/* Buy Box */}
          <div className="lg:col-span-3">
            <BuyBoxWidget offers={offers} onBuyNow={handleBuyNow} isBuying={isBuying} />

            {/* Seller CTA */}
            {role === 'seller' && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 bg-zinc-900 border border-zinc-800 rounded-2xl p-4"
              >
                <p className="text-xs font-semibold text-zinc-300 mb-1">Are you a seller?</p>
                <p className="text-xs text-zinc-500 mb-3">Compete for the Buy Box by listing your offer on this product.</p>
                <Link
                  to="/seller/new-offer"
                  className="block text-center text-xs bg-zinc-800 hover:bg-zinc-700 text-white font-medium py-2.5 rounded-xl transition-colors"
                >
                  List Your Offer
                </Link>
              </motion.div>
            )}
          </div>
        </div>

        {/* All offers section */}
        {offers.length > 0 && (
          <div className="mt-10">
            <AllOffersSection offers={offers} onBuyNow={handleBuyNow} isBuying={isBuying} />
          </div>
        )}

        {/* Reviews section */}
        <div id="reviews" className="mt-10 bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
          <h2 className="text-xl font-bold text-white mb-6">Customer Reviews</h2>
          
          <div className="bg-white rounded-xl p-6 text-black">
            {reviews.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-8">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <StarRow rating={entry.averageRating || 0} count={0} />
                    <span className="text-2xl font-bold text-gray-900">{entry.averageRating?.toFixed(1) || '0.0'}</span>
                  </div>
                  <p className="text-sm text-gray-500">Based on {entry.reviewCount || reviews.length} reviews</p>
                </div>
                
                <div>
                  {reviews.map((review, i) => (
                    <ReviewCard key={review._id} review={review} index={i} />
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <Star className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-sm">No reviews yet. Be the first to review this product!</p>
              </div>
            )}

            {/* Review form */}
            {role === 'buyer' && (
              <div className="mt-8 border-t border-gray-200 pt-8">
                <h3 className="text-lg font-bold text-gray-900 mb-4">Write a Review</h3>
                <ReviewForm productId={entryId} onSuccess={handleReviewSuccess} />
              </div>
            )}
          </div>
        </div>
      </div>

      <CheckoutModal
        isOpen={showCheckout}
        onClose={() => setShowCheckout(false)}
        onConfirm={handleConfirmPurchase}
        productTitle={entry.title}
        price={selectedOffer?.price || 0}
        isProcessing={isBuying}
      />
    </div>
  );
}
