import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getSellerStore } from '../services/product.service';
import ProductCard from '../components/shared/ProductCard';
import StarRating from '../components/shared/StarRating';
import { Store, Calendar, Package, Star, AlertTriangle } from 'lucide-react';

export default function StorePage() {
  const { id } = useParams();
  const [storeData, setStoreData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const res = await getSellerStore(id);
        if (res.success) setStoreData(res.data);
      } catch (err) {
        setError(err.response?.data?.message || 'Store not found');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [id]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#EAEDED]">
        <div className="max-w-[1200px] mx-auto px-6 py-8 space-y-6">
          <div className="bg-white rounded-md h-40 animate-pulse" />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="bg-white rounded-md h-64 animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !storeData) {
    return (
      <div className="min-h-screen bg-[#EAEDED] flex items-center justify-center">
        <div className="bg-white p-12 rounded-md text-center border border-gray-200">
          <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-gray-800 mb-2">{error || 'Store Not Found'}</h2>
          <Link to="/" className="text-[#007185] text-sm hover:underline">Back to Home</Link>
        </div>
      </div>
    );
  }

  const { seller, products } = storeData;
  const storeName = seller.storeName || `${seller.firstName || ''} ${seller.lastName || ''}`.trim() || 'Marketplace Store';
  const memberSince = new Date(seller.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long' });

  const initials = storeName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div className="min-h-screen bg-[#EAEDED]">
      {/* Store header */}
      <div className="bg-gradient-to-r from-[#131921] to-[#232f3e] text-white">
        <div className="max-w-[1200px] mx-auto px-6 py-10">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col md:flex-row items-center md:items-start gap-6"
          >
            {/* Store avatar */}
            <div className="w-24 h-24 rounded-full bg-[#FF9900] flex items-center justify-center text-black font-black text-3xl flex-shrink-0 shadow-lg">
              {seller.avatarUrl || seller.profileImageUrl ? (
                <img
                  src={seller.avatarUrl || seller.profileImageUrl}
                  alt={storeName}
                  className="w-full h-full rounded-full object-cover"
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              ) : (
                initials
              )}
            </div>

            {/* Store info */}
            <div className="text-center md:text-left flex-1">
              <div className="flex items-center gap-2 justify-center md:justify-start mb-1">
                <Store className="w-5 h-5 text-[#FF9900]" />
                <h1 className="text-2xl font-black">{storeName}</h1>
              </div>

              {seller.averageRating > 0 && (
                <div className="flex items-center gap-2 justify-center md:justify-start mb-2">
                  <StarRating rating={seller.averageRating} count={seller.totalReviewsReceived} size="md" />
                </div>
              )}

              {seller.storeDescription && (
                <p className="text-sm text-white/70 max-w-xl">{seller.storeDescription}</p>
              )}

              <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-white/60 justify-center md:justify-start">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" /> Member since {memberSince}
                </span>
                <span className="flex items-center gap-1">
                  <Package className="w-3.5 h-3.5" /> {products.length} product{products.length !== 1 ? 's' : ''}
                </span>
                {seller.reviewCount > 0 && (
                  <span className="flex items-center gap-1">
                    <Star className="w-3.5 h-3.5 text-[#FF9900]" /> {seller.totalReviewsReceived} reviews received
                  </span>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Products section */}
      <div className="max-w-[1200px] mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-bold text-gray-900">Products by {storeName}</h2>
          <span className="text-sm text-gray-500">{products.length} results</span>
        </div>

        {products.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white border border-gray-200 rounded-md p-16 text-center"
          >
            <Package className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-gray-800 mb-2">No Products Yet</h3>
            <p className="text-gray-500 text-sm">This seller hasn't listed any products yet.</p>
          </motion.div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {products.map((product, i) => (
              <ProductCard key={product._id} product={{ ...product, sellerId: seller }} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
