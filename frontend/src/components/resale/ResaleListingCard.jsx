import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShieldCheck, MapPin } from 'lucide-react';
import GradeBadge from './GradeBadge';

/**
 * Storefront grid card for a published resale listing (light marketplace theme).
 */
export default function ResaleListingCard({ listing, index = 0 }) {
  const img = listing.images?.[0] || 'https://picsum.photos/seed/resale/600/600';
  const hasDiscount = listing.originalPrice > 0 && listing.price < listing.originalPrice;
  const pctOff = hasDiscount
    ? Math.round((1 - listing.price / listing.originalPrice) * 100)
    : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.4) }}
    >
      <Link
        to={`/resale/${listing._id}`}
        className="group block bg-white rounded-md border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
      >
        <div className="relative aspect-square bg-[#F7F7F7] overflow-hidden">
          <img src={img} alt={listing.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
          <div className="absolute top-2 left-2">
            <GradeBadge grade={listing.grade} conditionLane={listing.conditionLane} size="sm" showLane={false} />
          </div>
          {listing.demandCount > 0 && (
            <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-black/70 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
              <MapPin className="w-3 h-3" /> {listing.demandCount} nearby
            </div>
          )}
        </div>
        <div className="p-3">
          <p className="text-sm text-gray-800 line-clamp-2 leading-tight group-hover:text-[#C7511F] min-h-[2.5rem]">
            {listing.title}
          </p>
          <div className="flex items-center gap-1 mt-1.5 text-[11px] text-emerald-700 font-medium">
            <ShieldCheck className="w-3.5 h-3.5" /> AI-graded {listing.grade} · {listing.qualityScore}/100
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-lg font-bold text-[#B12704]">₹{Number(listing.price).toLocaleString()}</span>
            {hasDiscount && (
              <>
                <span className="text-xs text-gray-400 line-through">₹{Number(listing.originalPrice).toLocaleString()}</span>
                <span className="text-[11px] text-emerald-700 font-semibold">{pctOff}% off</span>
              </>
            )}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
