import { motion } from 'framer-motion';
import StarRating from './StarRating';
import { CheckCircle, Flag } from 'lucide-react';

export default function ReviewCard({ review, index = 0 }) {
  const buyer = review.buyerId;
  const buyerName = buyer
    ? `${buyer.firstName || ''} ${buyer.lastName || ''}`.trim() || 'Anonymous'
    : 'Anonymous';

  const initials = buyerName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const date = new Date(review.createdAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
      className="border-b border-gray-200 pb-5 mb-5 last:border-0 last:mb-0"
    >
      {/* Buyer avatar + name */}
      <div className="flex items-center gap-2 mb-2">
        <div className="w-8 h-8 rounded-full bg-[#FF9900] flex items-center justify-center text-black font-bold text-xs">
          {initials || '?'}
        </div>
        <span className="text-sm font-semibold text-gray-800">{buyerName}</span>
      </div>

      {/* Stars + title */}
      <div className="flex items-center gap-2 mb-1">
        <StarRating rating={review.rating} size="sm" />
        {review.title && (
          <span className="text-sm font-bold text-gray-900">{review.title}</span>
        )}
      </div>

      {/* Badges */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-[11px] text-gray-500">{date}</span>
        {review.isVerifiedPurchase && (
          <span className="inline-flex items-center gap-1 text-[11px] text-[#C7511F] font-medium">
            <CheckCircle className="w-3 h-3" /> Verified Purchase
          </span>
        )}
        {review.isFlagged && (
          <span className="inline-flex items-center gap-1 text-[11px] text-red-500 font-medium bg-red-50 px-1.5 py-0.5 rounded">
            <Flag className="w-3 h-3" /> Flagged
          </span>
        )}
      </div>

      {/* Review text */}
      <p className="text-sm text-gray-700 leading-relaxed">{review.text}</p>

      {/* Flag reasons if any */}
      {review.flagReasons?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {review.flagReasons.map((reason) => (
            <span key={reason} className="text-[10px] bg-red-50 text-red-600 border border-red-200 px-2 py-0.5 rounded">
              {reason.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      )}
    </motion.div>
  );
}
