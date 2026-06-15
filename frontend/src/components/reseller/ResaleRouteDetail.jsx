import { motion } from 'framer-motion';
import { X, MapPin, Truck, Tag, Package } from 'lucide-react';

/**
 * ResaleRouteDetail — modal showing routing details for a resale listing.
 */
export default function ResaleRouteDetail({ listing, onClose }) {
  if (!listing) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 relative"
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <Package className="w-5 h-5 text-indigo-500" />
          Route Details
        </h2>

        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-gray-400" />
            <span className="text-gray-600">Title:</span>
            <span className="font-medium text-gray-900">{listing.title || '—'}</span>
          </div>

          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-gray-400" />
            <span className="text-gray-600">Condition Lane:</span>
            <span className="font-medium text-gray-900">{listing.conditionLane || '—'}</span>
          </div>

          <div className="flex items-center gap-2">
            <Truck className="w-4 h-4 text-gray-400" />
            <span className="text-gray-600">Chosen Path:</span>
            <span className="font-medium text-gray-900 capitalize">{listing.chosenPath || listing.status || '—'}</span>
          </div>

          {listing.grade && (
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 text-gray-400 text-center font-bold text-xs">G</span>
              <span className="text-gray-600">Grade:</span>
              <span className="font-bold text-gray-900">{listing.grade}</span>
            </div>
          )}

          {listing.price != null && (
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 text-gray-400 text-center font-bold text-xs">₹</span>
              <span className="text-gray-600">Price:</span>
              <span className="font-bold text-gray-900">₹{Number(listing.price).toLocaleString('en-IN')}</span>
            </div>
          )}

          {listing.demandCount != null && (
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 text-gray-400 text-center font-bold text-xs">#</span>
              <span className="text-gray-600">Nearby Demand:</span>
              <span className="font-medium text-gray-900">{listing.demandCount}</span>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
