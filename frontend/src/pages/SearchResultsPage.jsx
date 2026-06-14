import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { searchProducts } from '../services/product.service';
import ProductCard from '../components/shared/ProductCard';
import FilterSidebar from '../components/shared/FilterSidebar';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';

const SORT_OPTIONS = [
  { value: 'newest', label: 'Featured' },
  { value: 'price_asc', label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
  { value: 'rating', label: 'Avg. Customer Review' },
  { value: 'popularity', label: 'Best Sellers' },
];

export default function SearchResultsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  const q = searchParams.get('q') || '';
  const category = searchParams.get('category') || '';
  const minPrice = searchParams.get('minPrice');
  const maxPrice = searchParams.get('maxPrice');
  const minRating = searchParams.get('minRating');
  const sort = searchParams.get('sort') || 'newest';
  const page = Number(searchParams.get('page')) || 1;
  const verifiedOnly = searchParams.get('verifiedOnly') === 'true';

  const fetchResults = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = { sort, page, limit: 20 };
      if (q) params.q = q;
      if (category) params.category = category;
      if (minPrice) params.minPrice = minPrice;
      if (maxPrice) params.maxPrice = maxPrice;
      if (minRating) params.minRating = minRating;
      if (verifiedOnly) params.verifiedOnly = true;

      const response = await searchProducts(params);
      if (response.success) {
        setProducts(response.data.products);
        setTotal(response.data.total);
        setTotalPages(response.data.totalPages);
      }
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [q, category, minPrice, maxPrice, minRating, sort, page, verifiedOnly]);

  useEffect(() => {
    fetchResults();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [fetchResults]);

  const updateParams = (updates) => {
    const newParams = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, val]) => {
      if (val === undefined || val === '' || val === null) {
        newParams.delete(key);
      } else {
        newParams.set(key, val);
      }
    });
    newParams.set('page', '1'); // reset page on filter change
    setSearchParams(newParams);
  };

  const handleFilterChange = (changes) => {
    updateParams(changes);
  };

  const clearFilters = () => {
    const newParams = new URLSearchParams();
    if (q) newParams.set('q', q);
    newParams.set('sort', sort);
    setSearchParams(newParams);
  };

  return (
    <div className="min-h-screen bg-[#EAEDED]">
      {/* Results header */}
      <div className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="max-w-[1200px] mx-auto">
          <p className="text-sm text-gray-600">
            {isLoading ? 'Searching...' : (
              <>
                {total > 0 ? (
                  <>
                    <span className="text-[#B12704]">1–{Math.min(20, total)}</span> of <span className="font-medium">{total.toLocaleString()}</span> results
                    {q && <> for <span className="font-bold text-gray-900"> "{q}"</span></>}
                    {category && <> in <span className="font-bold text-gray-900">{category}</span></>}
                  </>
                ) : (
                  <>No results found{q && <> for <span className="font-bold">"{q}"</span></>}</>
                )}
              </>
            )}
          </p>
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto px-4 md:px-6 py-6">
        <div className="flex gap-6">
          {/* Filter sidebar */}
          <FilterSidebar
            filters={{
              category,
              minPrice: minPrice ? Number(minPrice) : undefined,
              maxPrice: maxPrice ? Number(maxPrice) : undefined,
              minRating: minRating ? Number(minRating) : undefined,
              verifiedOnly
            }}
            onFilterChange={handleFilterChange}
            onClear={clearFilters}
          />

          {/* Main content */}
          <div className="flex-1 min-w-0">
            {/* Sort bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4 bg-[#F3F3F3] border border-gray-200 rounded px-4 py-2">
              <div className="flex items-center gap-2 text-sm text-gray-600 flex-wrap">
                <span className="font-medium">Sort by:</span>
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => updateParams({ sort: opt.value })}
                    className={`px-2 py-0.5 rounded text-xs transition-all ${
                      sort === opt.value
                        ? 'bg-[#FF9900] text-black font-bold'
                        : 'text-[#007185] hover:text-[#C7511F]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Product grid */}
            {isLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="bg-white rounded h-64 animate-pulse" />
                ))}
              </div>
            ) : products.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-md p-16 text-center border border-gray-200"
              >
                <Search className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-gray-800 mb-2">No results found</h3>
                <p className="text-gray-500 mb-4 text-sm">
                  Try different keywords or remove some filters.
                </p>
                <button
                  onClick={clearFilters}
                  className="amz-btn-primary px-6 py-2 rounded text-sm"
                >
                  Clear Filters
                </button>
              </motion.div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {products.map((product, i) => (
                    <ProductCard key={product._id} product={product} index={i} />
                  ))}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="mt-8 flex items-center justify-center gap-2">
                    <button
                      disabled={page <= 1}
                      onClick={() => updateParams({ page: page - 1 })}
                      className="flex items-center gap-1 px-4 py-2 amz-btn-secondary rounded text-sm disabled:opacity-40"
                    >
                      <ChevronLeft className="w-4 h-4" /> Prev
                    </button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        const pageNum = Math.max(1, page - 2) + i;
                        if (pageNum > totalPages) return null;
                        return (
                          <button
                            key={pageNum}
                            onClick={() => updateParams({ page: pageNum })}
                            className={`w-9 h-9 rounded text-sm font-medium transition-all ${
                              pageNum === page
                                ? 'bg-[#FF9900] text-black'
                                : 'amz-btn-secondary hover:bg-gray-100'
                            }`}
                          >
                            {pageNum}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      disabled={page >= totalPages}
                      onClick={() => updateParams({ page: page + 1 })}
                      className="flex items-center gap-1 px-4 py-2 amz-btn-secondary rounded text-sm disabled:opacity-40"
                    >
                      Next <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
