import { Star } from 'lucide-react';

/**
 * StarRating — renders stars filled to the given rating.
 * @param {number} rating - value from 0 to 5
 * @param {number} count - number of reviews (optional)
 * @param {boolean} interactive - show as clickable (for review forms)
 * @param {function} onChange - called with new rating when clicked
 * @param {string} size - 'sm' | 'md' | 'lg'
 */
export default function StarRating({ rating = 0, count, interactive = false, onChange, size = 'sm' }) {
  const sizes = { sm: 'w-3.5 h-3.5', md: 'w-4 h-4', lg: 'w-5 h-5' };
  const iconSize = sizes[size] || sizes.sm;

  const stars = [1, 2, 3, 4, 5];

  return (
    <div className="flex items-center gap-1">
      <div className="flex items-center">
        {stars.map((star) => (
          <button
            key={star}
            type="button"
            disabled={!interactive}
            onClick={() => interactive && onChange && onChange(star)}
            className={`${interactive ? 'cursor-pointer hover:scale-110 transition-transform' : 'cursor-default'} p-0.5`}
          >
            <Star
              className={`${iconSize} ${star <= Math.round(rating) ? 'text-[#FF9900] fill-[#FF9900]' : 'text-gray-300 fill-gray-100'} transition-colors`}
            />
          </button>
        ))}
      </div>
      {count !== undefined && (
        <span className="text-xs text-[#007185] hover:text-[#C7511F] cursor-pointer transition-colors">
          ({count.toLocaleString()})
        </span>
      )}
    </div>
  );
}
