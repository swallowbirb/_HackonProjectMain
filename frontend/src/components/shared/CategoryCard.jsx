import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

const CATEGORY_STYLES = {
  'Electronics': { bg: 'bg-blue-50', icon: '⚡', color: 'text-blue-600' },
  'Clothing': { bg: 'bg-pink-50', icon: '👗', color: 'text-pink-600' },
  'Home & Garden': { bg: 'bg-green-50', icon: '🏡', color: 'text-green-600' },
  'Sports': { bg: 'bg-orange-50', icon: '⚽', color: 'text-orange-600' },
  'Toys': { bg: 'bg-yellow-50', icon: '🧸', color: 'text-yellow-600' },
  'Books': { bg: 'bg-amber-50', icon: '📚', color: 'text-amber-600' },
  'Automotive': { bg: 'bg-slate-50', icon: '🚗', color: 'text-slate-600' },
  'Health & Beauty': { bg: 'bg-rose-50', icon: '💊', color: 'text-rose-600' },
};

export default function CategoryCard({ category, index = 0 }) {
  const style = CATEGORY_STYLES[category] || { bg: 'bg-gray-50', icon: '🛍️', color: 'text-gray-600' };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, delay: index * 0.07 }}
    >
      <Link
        to={`/search?category=${encodeURIComponent(category)}`}
        className={`block ${style.bg} rounded-md p-4 text-center group hover:shadow-md transition-all duration-200 border border-transparent hover:border-gray-200 amz-card`}
      >
        <div className="text-3xl mb-2 group-hover:scale-110 transition-transform duration-200">
          {style.icon}
        </div>
        <p className={`text-sm font-semibold ${style.color} group-hover:underline`}>
          {category}
        </p>
      </Link>
    </motion.div>
  );
}
