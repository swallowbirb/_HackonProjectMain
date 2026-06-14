import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SlidersHorizontal, X } from 'lucide-react';
import StarRating from './StarRating';

const CATEGORIES = [
  'Electronics', 'Clothing', 'Home & Garden', 'Sports', 'Toys', 'Books', 'Automotive', 'Health & Beauty',
];

const PRICE_RANGES = [
  { label: 'Under $25', min: 0, max: 25 },
  { label: '$25 – $50', min: 25, max: 50 },
  { label: '$50 – $100', min: 50, max: 100 },
  { label: '$100 – $250', min: 100, max: 250 },
  { label: 'Over $250', min: 250, max: undefined },
];

export default function FilterSidebar({ filters, onFilterChange, onClear }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleCategory = (cat) => {
    onFilterChange({ category: filters.category === cat ? '' : cat });
  };

  const setPriceRange = (range) => {
    onFilterChange({
      minPrice: filters.minPrice === range.min && filters.maxPrice === range.max ? undefined : range.min,
      maxPrice: filters.minPrice === range.min && filters.maxPrice === range.max ? undefined : range.max,
    });
  };

  const setMinRating = (rating) => {
    onFilterChange({ minRating: filters.minRating === rating ? undefined : rating });
  };

  const hasActiveFilters = filters.category || filters.minPrice !== undefined || filters.minRating !== undefined || filters.verifiedOnly;

  const SidebarContent = () => (
    <div className="space-y-5">
      {hasActiveFilters && (
        <button
          onClick={onClear}
          className="flex items-center gap-1.5 text-sm text-[#C7511F] hover:underline font-medium"
        >
          <X className="w-3.5 h-3.5" /> Clear all filters
        </button>
      )}

      {/* Listing Type / Verification */}
      <div className="border-b border-gray-200 pb-4">
        <h3 className="font-bold text-sm text-gray-900 mb-2">Listing Type</h3>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!!filters.verifiedOnly}
            onChange={(e) => onFilterChange({ verifiedOnly: e.target.checked ? 'true' : undefined })}
            className="rounded border-gray-300 text-[#FF9900] focus:ring-[#FF9900] w-4 h-4 cursor-pointer"
          />
          <span className="text-sm text-gray-700 flex items-center gap-1">
            Verified Brands Only
            <span className="inline-flex items-center justify-center bg-[#10b981] text-white text-[8px] font-bold px-1.5 py-0.5 rounded ml-1" title="Verified Brand Catalog Entry">✓ Verified</span>
          </span>
        </label>
      </div>

      {/* Category */}
      <div className="border-b border-gray-200 pb-4">
        <h3 className="font-bold text-sm text-gray-900 mb-2">Department</h3>
        <ul className="space-y-1.5">
          {CATEGORIES.map((cat) => (
            <li key={cat}>
              <button
                onClick={() => toggleCategory(cat)}
                className={`text-sm text-left w-full hover:text-[#C7511F] transition-colors ${
                  filters.category === cat ? 'font-bold text-[#C7511F]' : 'text-[#007185]'
                }`}
              >
                {filters.category === cat && '▸ '}
                {cat}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Price range */}
      <div className="border-b border-gray-200 pb-4">
        <h3 className="font-bold text-sm text-gray-900 mb-2">Price</h3>
        <ul className="space-y-1.5">
          {PRICE_RANGES.map((range) => {
            const isActive = filters.minPrice === range.min && filters.maxPrice === range.max;
            return (
              <li key={range.label}>
                <button
                  onClick={() => setPriceRange(range)}
                  className={`text-sm text-left w-full hover:text-[#C7511F] transition-colors ${
                    isActive ? 'font-bold text-[#C7511F]' : 'text-[#007185]'
                  }`}
                >
                  {isActive && '▸ '}{range.label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Rating */}
      <div>
        <h3 className="font-bold text-sm text-gray-900 mb-2">Avg. Customer Review</h3>
        <div className="space-y-1.5">
          {[4, 3, 2, 1].map((stars) => (
            <button
              key={stars}
              onClick={() => setMinRating(stars)}
              className={`flex items-center gap-1.5 w-full hover:opacity-80 transition-opacity ${
                filters.minRating === stars ? 'opacity-100' : 'opacity-70'
              }`}
            >
              <StarRating rating={stars} size="sm" />
              <span className="text-xs text-[#007185] hover:text-[#C7511F]">& Up</span>
              {filters.minRating === stars && <span className="text-[#C7511F] font-bold text-xs ml-1">✓</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile toggle button */}
      <button
        className="md:hidden flex items-center gap-2 text-sm font-medium bg-white border border-gray-300 px-4 py-2 rounded"
        onClick={() => setMobileOpen(true)}
      >
        <SlidersHorizontal className="w-4 h-4" /> Filters
        {hasActiveFilters && <span className="w-4 h-4 bg-[#FF9900] rounded-full text-[10px] text-black flex items-center justify-center font-bold">!</span>}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="bg-black/50 flex-1" onClick={() => setMobileOpen(false)} />
          <div className="bg-white w-72 p-5 overflow-y-auto relative">
            <button className="absolute top-3 right-3" onClick={() => setMobileOpen(false)}>
              <X className="w-5 h-5 text-gray-500" />
            </button>
            <h2 className="font-bold text-base mb-4">Filters</h2>
            <SidebarContent />
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <div className="hidden md:block w-56 flex-shrink-0">
        <div className="bg-white border border-gray-200 rounded-md p-4 sticky top-20">
          <h2 className="font-bold text-base mb-4 flex items-center gap-1.5">
            <SlidersHorizontal className="w-4 h-4" /> Filters
          </h2>
          <SidebarContent />
        </div>
      </div>
    </>
  );
}
