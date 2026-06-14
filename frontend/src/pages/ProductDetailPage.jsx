import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { getProductById } from '../services/product.service';
import { getReviewsByProduct } from '../services/review.service';
import { createOrder } from '../services/order.service';
import { useCustomUser } from '../context/CustomUserContext';
import StarRating from '../components/shared/StarRating';
import ReviewCard from '../components/shared/ReviewCard';
import ReviewForm from '../components/shared/ReviewForm';
import CheckoutModal from '../components/shared/CheckoutModal';
import FitReturnNote from '../components/prevention/FitReturnNote';
import { useCart } from '../context/CartContext';
import { updateNudgeEvent } from '../services/prevention.service';
import {
  ShoppingCart, Zap, Shield, Store, ChevronRight, Package,
  CheckCircle, AlertTriangle, ChevronLeft, ChevronRight as ChevRight, Star
} from 'lucide-react';const PLACEHOLDER_IMAGE = 'https://placehold.co/600x600/EAEDED/555?text=No+Image';

export default function ProductDetailPage() {
  const { id } = useParams();
  const { role, mongoUser } = useCustomUser();
  const { cart, addToCart, keepOneOf } = useCart();
  const [product, setProduct] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [reviewMeta, setReviewMeta] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isOrdering, setIsOrdering] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [orderError, setOrderError] = useState('');
  const [showCheckout, setShowCheckout] = useState(false);
  const [activeImage, setActiveImage] = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        const [productRes, reviewRes] = await Promise.all([
          getProductById(id),
          getReviewsByProduct(id, 1, 8),
        ]);
        if (productRes.success) setProduct(productRes.data);
        if (reviewRes.success) {
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
  }, [id]);

  const handleBuyNowClick = () => {
    if (!mongoUser) return;
    addToCart(id, 1, { title: product?.title, price: product?.price, image: product?.images?.[0] });
    // Fit hint is already shown on the PDP via <FitReturnNote> — no need to repeat
    // it at checkout. Go straight to the payment modal.
    setShowCheckout(true);
  };

  const handleRiskNudgeContinue = () => {
    setShowCheckout(true);
  };

  const handleRiskNudgeAdjust = (action) => {
    if (lastNudgeEventId) {
      updateNudgeEvent(lastNudgeEventId, { acted: true }).catch(() => {});
    }
    setShowCheckout(true);
  };

  const handleConfirmPurchase = async (mockCreditCard, paymentMethod = 'prepaid') => {
    setIsOrdering(true);
    setOrderError('');
    try {
      const res = await createOrder({ productId: id, quantity: 1, mockCreditCard, paymentMethod });
      if (res.success) {
        setShowCheckout(false);
        setOrderSuccess(true);
        // Mark the nudge event as purchased for analytics (§15)
        if (lastNudgeEventId) {
          updateNudgeEvent(lastNudgeEventId, { purchased: true }).catch(() => {});
        }
        // Refresh product to update totalSales
        const productRes = await getProductById(id);
        if (productRes.success) setProduct(productRes.data);
      }
    } catch (err) {
      if (err.response?.data?.code === 'COD_NOT_AVAILABLE') {
        setOrderError('Cash on Delivery isn’t available for this order during the festive sale. Please pay by card.');
        return; // keep the modal open so the buyer can switch to card
      }
      const errorMsg = err.response?.data?.errors 
        ? err.response.data.errors.join(', ')
        : err.response?.data?.message || 'Failed to place order. Please try again.';
      setOrderError(errorMsg);
      setShowCheckout(false);
    } finally {
      setIsOrdering(false);
    }
  };

  const handleReviewSuccess = (newReview) => {
    setReviews((prev) => [newReview, ...prev]);
    setReviewMeta((prev) => ({ ...prev, total: (prev.total || 0) + 1 }));
    // Refresh product for updated rating
    getProductById(id).then((res) => { if (res.success) setProduct(res.data); });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#EAEDED]">
        <div className="max-w-[1200px] mx-auto px-6 py-8 grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-white rounded-md aspect-square animate-pulse" />
          <div className="space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white rounded h-8 animate-pulse" style={{ width: `${80 - i * 8}%` }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-[#EAEDED] flex items-center justify-center">
        <div className="bg-white p-12 rounded-md text-center border border-gray-200">
          <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-gray-800 mb-2">Product Not Found</h2>
          <Link to="/" className="text-[#007185] text-sm hover:underline">Back to Home</Link>
        </div>
      </div>
    );
  }

  const images = product.images?.length > 0 ? product.images : [PLACEHOLDER_IMAGE];
  const seller = product.sellerId;
  const sellerName = seller?.storeName || `${seller?.firstName || ''} ${seller?.lastName || ''}`.trim() || 'Marketplace Seller';

  // Rating distribution (simplified)
  const ratingBars = [5, 4, 3, 2, 1].map((stars) => ({
    stars,
    count: reviews.filter((r) => r.rating === stars).length,
    pct: reviews.length > 0 ? (reviews.filter((r) => r.rating === stars).length / reviews.length) * 100 : 0,
  }));

  return (
    <div className="min-h-screen bg-[#EAEDED]">
      {/* Breadcrumb */}
      <div className="bg-white border-b border-gray-200 px-6 py-2">
        <div className="max-w-[1200px] mx-auto flex items-center gap-1 text-xs text-[#007185]">
          <Link to="/" className="hover:underline hover:text-[#C7511F]">Home</Link>
          <ChevronRight className="w-3 h-3 text-gray-400" />
          <Link to={`/search?category=${encodeURIComponent(product.category)}`} className="hover:underline hover:text-[#C7511F]">
            {product.category}
          </Link>
          <ChevronRight className="w-3 h-3 text-gray-400" />
          <span className="text-gray-500 truncate max-w-[200px]">{product.title}</span>
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto px-4 md:px-6 py-6">
        {/* Main product layout */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.5fr_320px] gap-6">
          {/* Image gallery */}
          <div className="flex flex-col gap-3">
            <div className="bg-white border border-gray-200 rounded-md overflow-hidden aspect-square flex items-center justify-center p-6 relative">
              <AnimatePresence mode="wait">
                <motion.img
                  key={activeImage}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  src={images[activeImage]}
                  alt={product.title}
                  className="max-w-full max-h-full object-contain"
                  onError={(e) => { e.target.src = PLACEHOLDER_IMAGE; }}
                />
              </AnimatePresence>
              {images.length > 1 && (
                <>
                  <button
                    onClick={() => setActiveImage((a) => Math.max(0, a - 1))}
                    className="absolute left-2 top-1/2 -translate-y-1/2 bg-white border border-gray-300 rounded-full w-8 h-8 flex items-center justify-center shadow hover:bg-gray-50 transition-all"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setActiveImage((a) => Math.min(images.length - 1, a + 1))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-white border border-gray-300 rounded-full w-8 h-8 flex items-center justify-center shadow hover:bg-gray-50 transition-all"
                  >
                    <ChevRight className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>

            {/* Thumbnail strip */}
            {images.length > 1 && (
              <div className="flex gap-2 overflow-x-auto">
                {images.map((img, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveImage(i)}
                    className={`w-14 h-14 border-2 rounded flex-shrink-0 overflow-hidden transition-all ${
                      i === activeImage ? 'border-[#FF9900]' : 'border-gray-200 hover:border-gray-400'
                    }`}
                  >
                    <img src={img} alt="" className="w-full h-full object-contain p-1" onError={(e) => { e.target.src = PLACEHOLDER_IMAGE; }} />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Product details */}
          <div className="bg-white border border-gray-200 rounded-md p-5 space-y-4">
            {/* Title */}
            <h1 className="text-xl font-bold text-gray-900 leading-tight">{product.title}</h1>

            {/* Seller */}
            <p className="text-sm">
              by{' '}
              <Link to={`/seller/${seller?._id}/store`} className="text-[#007185] hover:text-[#C7511F] hover:underline">
                {sellerName}
              </Link>
              {product.brand && <span className="text-gray-500"> | Brand: <span className="font-medium">{product.brand}</span></span>}
            </p>

            {/* Stars */}
            {product.reviewCount > 0 && (
              <div className="flex items-center gap-2">
                <StarRating rating={product.averageRating} count={product.reviewCount} size="md" />
                <a href="#reviews" className="text-xs text-[#007185] hover:underline">See all reviews</a>
              </div>
            )}

            <hr className="border-gray-200" />

            {/* Price */}
            <div>
              <span className="text-sm text-gray-500">Price: </span>
              <span className="text-3xl font-bold text-[#B12704]">${product.price.toFixed(2)}</span>
            </div>

            {/* Description */}
            <div>
              <h3 className="font-bold text-sm text-gray-800 mb-2">About this item</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{product.description}</p>
            </div>

            {/* Phase 7 — fit/return note from RIKB */}
            <FitReturnNote productId={id} />

            {/* Stats */}
            <div className="flex flex-wrap gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1"><Package className="w-3.5 h-3.5" /> {product.totalSales || 0} sold</span>
              <span>{product.category}</span>
              {product.condition && (
                <span className={`px-2 py-0.5 rounded-full font-medium border ${
                  product.condition === 'Used'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-blue-50 text-blue-700 border-blue-200'
                }`}>
                  {product.condition}
                </span>
              )}
            </div>
          </div>

          {/* Buy box */}
          <div className="bg-white border border-gray-200 rounded-md p-5 space-y-4 self-start sticky top-20">
            <div>
              <span className="text-2xl font-bold text-[#B12704]">${product.price.toFixed(2)}</span>
            </div>
            
            <div className="text-sm text-[#007600] font-medium flex items-center gap-1">
              <CheckCircle className="w-4 h-4" /> In Stock
            </div>

            <div className="text-xs text-gray-600 space-y-1">
              <p>Ships to: <span className="font-medium">India</span></p>
              <p>Sold by: <Link to={`/seller/${seller?._id}/store`} className="text-[#007185] hover:underline">{sellerName}</Link></p>
            </div>

            {/* Order buttons */}
            {role === 'buyer' ? (
              <>
                {orderSuccess ? (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-green-50 border border-green-200 rounded p-3 text-sm text-green-700 flex items-center gap-2"
                  >
                    <CheckCircle className="w-4 h-4" /> Order placed successfully!
                  </motion.div>
                ) : (
                  <>
                    <button
                      onClick={handleBuyNowClick}
                      disabled={isOrdering}
                      className="w-full amz-btn-primary py-2.5 rounded-full text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isOrdering ? (
                        <span className="flex items-center gap-2"><span className="animate-spin w-4 h-4 border-2 border-black/30 border-t-black rounded-full inline-block" />Processing...</span>
                      ) : (
                        <><Zap className="w-4 h-4" /> Buy Now</>
                      )}
                    </button>
                    <button
                      onClick={() => addToCart(id, 1, { title: product?.title, price: product?.price, image: product?.images?.[0] })}
                      className="w-full amz-btn-secondary py-2.5 rounded-full text-sm font-semibold flex items-center justify-center gap-2"
                    >
                      <ShoppingCart className="w-4 h-4" /> Add to Cart
                    </button>
                    {orderError && <p className="text-xs text-red-600">{orderError}</p>}
                  </>
                )}
              </>
            ) : (
              <div className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded p-3 text-center">
                {!mongoUser ? 'Sign in as a buyer to purchase.' : 'Only buyers can purchase products.'}
              </div>
            )}

            {/* Security assurances */}
            <div className="border-t border-gray-200 pt-3 space-y-1.5 text-xs text-gray-500">
              <div className="flex items-center gap-1.5"><Shield className="w-3.5 h-3.5 text-[#007600]" /> Fraud-protected transaction</div>
              <div className="flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-[#007600]" /> Verified purchase review eligible</div>
            </div>
          </div>
        </div>

        {/* Reviews section */}
        <div id="reviews" className="mt-8 bg-white border border-gray-200 rounded-md p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-6">Customer Reviews</h2>

          {reviews.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-8">
              {/* Rating summary */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <StarRating rating={product.averageRating} size="lg" />
                  <span className="text-2xl font-bold text-gray-900">{product.averageRating?.toFixed(1)}</span>
                </div>
                <p className="text-sm text-gray-500">Based on {product.reviewCount} reviews</p>

                {/* Distribution bars */}
                <div className="space-y-1.5">
                  {ratingBars.map(({ stars, count, pct }) => (
                    <div key={stars} className="flex items-center gap-2 text-xs">
                      <span className="w-8 text-[#007185] hover:underline cursor-pointer">{stars} star</span>
                      <div className="flex-1 bg-gray-200 rounded-full h-2.5 overflow-hidden">
                        <div
                          className="bg-[#FF9900] h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-7 text-right text-gray-500">{Math.round(pct)}%</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Review list */}
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

          {/* Review form — buyers only, and only if not already reviewed */}
          {role === 'buyer' && (
            <div className="mt-8 border-t border-gray-200 pt-8">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Write a Review</h3>
              <ReviewForm productId={id} onSuccess={handleReviewSuccess} />
            </div>
          )}
        </div>

        {/* Seller info strip */}
        {seller && (
          <div className="mt-4 bg-white border border-gray-200 rounded-md p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#232f3e] rounded-full flex items-center justify-center flex-shrink-0">
                <Store className="w-5 h-5 text-[#FF9900]" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">{sellerName}</p>
                {/* Seller rating removed to show only the product's rating */}
              </div>
            </div>
            <Link
              to={`/seller/${seller._id}/store`}
              className="amz-btn-secondary px-4 py-1.5 rounded text-sm flex items-center gap-1.5"
            >
              Visit Store <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}
      </div>

      {/* Checkout Modal */}
      <CheckoutModal
        isOpen={showCheckout}
        onClose={() => setShowCheckout(false)}
        onConfirm={handleConfirmPurchase}
        productTitle={product.title}
        price={product.price}
        isProcessing={isOrdering}
      />
    </div>
  );
}
