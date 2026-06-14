import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import StarRating from './StarRating';
import { Package } from 'lucide-react';

const PLACEHOLDER_IMAGE = 'https://placehold.co/300x300/EAEDED/555?text=No+Image';

export default function ProductCard({ product, index = 0 }) {
  const image = product.images?.[0] || product.officialImages?.[0] || PLACEHOLDER_IMAGE;
  const sellerName = product.sellerId?.storeName ||
    `${product.sellerId?.firstName || ''} ${product.sellerId?.lastName || ''}`.trim() ||
    'Marketplace Seller';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
    >
      <Link to={product.isCatalogEntry ? `/p/${product._id}` : `/products/${product._id}`} className="block group">
        <div className="amz-card rounded-md overflow-hidden h-full flex flex-col cursor-pointer">
          {/* Product image */}
          <div className="relative bg-white aspect-square overflow-hidden">
            <img
              src={image}
              alt={product.title}
              className="w-full h-full object-contain p-4 group-hover:scale-105 transition-transform duration-300"
              onError={(e) => { e.target.src = PLACEHOLDER_IMAGE; }}
            />
            {product.totalSales > 50 && (
              <div className="absolute top-2 left-2 bg-[#CC0C39] text-white text-[10px] font-bold px-2 py-0.5 rounded">
                Best Seller
              </div>
            )}
          </div>

          {/* Product info */}
          <div className="p-3 flex flex-col gap-1 flex-1">
            <h3 className="text-sm font-medium text-gray-900 line-clamp-2 group-hover:text-[#C7511F] transition-colors">
              {product.title}
            </h3>

            {/* Star rating */}
            {product.reviewCount > 0 && (
              <StarRating rating={product.averageRating} count={product.reviewCount} size="sm" />
            )}

            {/* Price */}
            <div className="mt-auto pt-1">
              {product.price !== undefined && product.price !== null ? (
                <span className="text-lg font-bold text-[#B12704]">
                  ₹{Number(product.price).toFixed(2)}
                </span>
              ) : (
                <span className="text-sm font-medium text-gray-500">
                  View Offers
                </span>
              )}
            </div>

            {/* Seller / Brand Link */}
            {product.isCatalogEntry ? (
              <p className="text-[11px] text-gray-500 truncate flex items-center gap-1 mt-auto">
                by <Link to={`/brand-store/${product.brandId || product.brand?._id}`} className="text-[#007185] hover:underline hover:text-[#C7511F]">{product.brandName || 'Verified Brand'}</Link>
                <span className="inline-flex items-center justify-center bg-[#10b981] text-white text-[8px] font-bold px-1 py-0.5 rounded ml-1" title="Verified Brand Catalog Entry">✓ Verified</span>
              </p>
            ) : (
              <p className="text-[11px] text-gray-500 truncate mt-auto">
                by <Link to={`/seller/${product.sellerId?._id}/store`} className="text-[#007185] hover:underline hover:text-[#C7511F]">{sellerName}</Link>
              </p>
            )}

            {/* Verified seller badge */}
            {product.sellerId?.averageRating >= 4 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-[#007600] font-medium">
                <Package className="w-3 h-3" /> Prime-eligible
              </span>
            )}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
