import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Recycle, ChevronLeft, ChevronRight, PackageOpen } from 'lucide-react';
import { getResaleStorefront } from '../services/resale.service';
import ResaleListingCard from '../components/resale/ResaleListingCard';

const CONDITION_LANES = [
  { value: '', label: 'All conditions' },
  { value: 'like-new', label: 'Like New' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
];

export default function ResaleMarketplacePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [listings, setListings] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  const conditionLane = searchParams.get('conditionLane') || '';
  const category = searchParams.get('category') || '';
  const page = Number(searchParams.get('page')) || 1;

  const fetchListings = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = { page, limit: 20 };
      if (conditionLane) params.conditionLane = conditionLane;
      if (category) params.category = category;
      const res = await getResaleStorefront(params);
      if (res.success) {
        setListings(res.data.listings);
        setTotal(res.data.total);
        setTotalPages(res.data.totalPages);
      }
    } catch (err) {
      console.error('Failed to load resale storefront:', err);
    } finally {
      setIsLoading(false);
    }
  }, [conditionLane, category, page]);

  useEffect(() => {
    fetchListings();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [fetchListings]);

  const updateParams = (updates) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([k, v]) => {
      if (v === undefined || v === '' || v === null) next.delete(k);
      else next.set(k, v);
    });
    if (!('page' in updates)) next.set('page', '1');
    setSearchParams(next);
  };

  return (
    <div className="min-h-screen bg-[#EAEDED]">
      {/* Hero */}
      <div className="bg-gradient-to-r from-emerald-700 to-teal-600 text-white">
        <div className="max-w-[1200px] mx-auto px-4 md:px-6 py-8">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center">
              <Recycle className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black">Second-Life Marketplace</h1>
              <p className="text-sm text-emerald-50/90 mt-0.5">
                Certified pre-owned items — every one AI-graded for condition, with a full transparency report.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto px-4 md:px-6 py-6">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5 bg-white border border-gray-200 rounded px-4 py-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-600">Condition:</span>
            {CONDITION_LANES.map((c) => (
              <button
                key={c.value || 'all'}
                onClick={() => updateParams({ conditionLane: c.value })}
                className={`px-2.5 py-0.5 rounded text-xs transition-all ${
                  conditionLane === c.value ? 'bg-[#FF9900] text-black font-bold' : 'text-[#007185] hover:text-[#C7511F]'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500">
            {isLoading ? 'Loading…' : `${total.toLocaleString()} listing${total === 1 ? '' : 's'}`}
          </p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-white rounded h-72 animate-pulse" />
            ))}
          </div>
        ) : listings.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-md p-16 text-center border border-gray-200"
          >
            <PackageOpen className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-gray-800 mb-2">No second-life items yet</h3>
            <p className="text-gray-500 text-sm">Check back soon — graded items appear here once published.</p>
          </motion.div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {listings.map((listing, i) => (
                <ResaleListingCard key={listing._id} listing={listing} index={i} />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="mt-8 flex items-center justify-center gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => updateParams({ page: page - 1 })}
                  className="flex items-center gap-1 px-4 py-2 amz-btn-secondary rounded text-sm disabled:opacity-40"
                >
                  <ChevronLeft className="w-4 h-4" /> Prev
                </button>
                <span className="text-sm text-gray-600 px-2">Page {page} of {totalPages}</span>
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
  );
}
