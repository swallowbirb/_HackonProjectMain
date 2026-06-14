import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Package, Users, AlertTriangle, CheckCircle, Clock,
  XCircle, Ban, Pause, Play, Search, ChevronLeft, ChevronRight,
  RefreshCw, TrendingUp, Eye, ChevronDown, ChevronUp, Sparkles, Zap, ZapOff
} from 'lucide-react';
import {
  getStats,
  getAdminProducts,
  updateProductStatus,
  updateProductModeration,
  getAdminSellers,
  getSellerProducts,
  updateSellerModeration,
  getAdminReviews,
  moderateReview,
} from '../../services/admin.service';
import { getFestiveCalendar, setFestiveOverride } from '../../services/festive.service';
import { listPrompts, savePrompt, resetPrompt } from '../../services/prompt.service';

// ─── Shared Components ────────────────────────────────────────────────────────

const StatusBadge = ({ status }) => {
  const config = {
    pending_review: { label: 'Pending Review', icon: Clock, cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
    pending:        { label: 'Pending', icon: Clock, cls: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
    published:      { label: 'Published', icon: CheckCircle, cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
    approved:       { label: 'Approved', icon: CheckCircle, cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
    flagged:        { label: 'Flagged', icon: AlertTriangle, cls: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
    rejected:       { label: 'Rejected', icon: XCircle, cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  };
  const c = config[status] || { label: status, icon: Clock, cls: 'bg-zinc-700/50 text-zinc-400 border-zinc-600/20' };
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${c.cls}`}>
      <Icon className="w-3 h-3" />
      {c.label}
    </span>
  );
};

const ModerationFlags = ({ banned, suspended }) => (
  <div className="flex gap-1">
    {banned && (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-900/30 text-red-400 border border-red-500/20">
        <Ban className="w-3 h-3" /> Banned
      </span>
    )}
    {suspended && (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-900/30 text-orange-400 border border-orange-500/20">
        <Pause className="w-3 h-3" /> Suspended
      </span>
    )}
    {!banned && !suspended && <span className="text-xs text-zinc-600">—</span>}
  </div>
);

// Confirmation dialog overlay
const ConfirmDialog = ({ title, description, onConfirm, onCancel, confirmLabel = 'Confirm', isDanger = false }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl"
    >
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-sm text-zinc-400 mb-6">{description}</p>
      <div className="flex gap-3 justify-end">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-xl text-sm font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
            isDanger
              ? 'bg-red-600 hover:bg-red-500 text-white'
              : 'bg-white hover:bg-zinc-200 text-black'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </motion.div>
  </div>
);

// ─── Stats Bar ────────────────────────────────────────────────────────────────

const StatsBar = ({ stats }) => {
  if (!stats) return null;

  const productStats = [
    { label: 'Total Products', value: stats.products.total, icon: Package, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: 'Pending Review', value: (stats.products.byStatus.pending_review ?? 0) + (stats.products.byStatus.pending ?? 0), icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10' },
    { label: 'Flagged', value: stats.products.byStatus.flagged, icon: AlertTriangle, color: 'text-orange-400', bg: 'bg-orange-500/10' },
    { label: 'Approved', value: stats.products.byStatus.approved, icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: 'Rejected', value: stats.products.byStatus.rejected, icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10' },
    { label: 'Total Sellers', value: stats.sellers.total, icon: Users, color: 'text-purple-400', bg: 'bg-purple-500/10' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {productStats.map((stat, idx) => {
        const Icon = stat.icon;
        return (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-2"
          >
            <div className={`w-8 h-8 rounded-lg ${stat.bg} flex items-center justify-center`}>
              <Icon className={`w-4 h-4 ${stat.color}`} />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{stat.value ?? 0}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{stat.label}</p>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
};

// ─── Filter Bar ───────────────────────────────────────────────────────────────

const FilterBar = ({ filters, onFilterChange, forSellers = false }) => {
  const statusOptions = ['', 'pending', 'published', 'approved', 'flagged', 'rejected'];

  return (
    <div className="flex flex-wrap gap-3 items-center">
      <div className="flex items-center gap-2 flex-1 min-w-[200px] bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2">
        <Search className="w-4 h-4 text-zinc-500 flex-shrink-0" />
        <input
          type="text"
          placeholder={forSellers ? 'Search sellers...' : 'Search products...'}
          value={filters.search || ''}
          onChange={e => onFilterChange('search', e.target.value)}
          className="bg-transparent text-sm text-white placeholder:text-zinc-600 outline-none w-full"
        />
      </div>

      {!forSellers && (
        <select
          value={filters.status || ''}
          onChange={e => onFilterChange('status', e.target.value)}
          className="bg-zinc-900 border border-zinc-800 text-sm text-zinc-300 rounded-xl px-3 py-2 outline-none focus:border-zinc-600 transition-colors"
        >
          <option value="">All Statuses</option>
          {statusOptions.filter(Boolean).map(s => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
      )}

      <select
        value={filters.banned !== undefined ? String(filters.banned) : ''}
        onChange={e => onFilterChange('banned', e.target.value === '' ? undefined : e.target.value === 'true')}
        className="bg-zinc-900 border border-zinc-800 text-sm text-zinc-300 rounded-xl px-3 py-2 outline-none focus:border-zinc-600 transition-colors"
      >
        <option value="">All Ban Status</option>
        <option value="true">Banned</option>
        <option value="false">Not Banned</option>
      </select>

      <select
        value={filters.suspended !== undefined ? String(filters.suspended) : ''}
        onChange={e => onFilterChange('suspended', e.target.value === '' ? undefined : e.target.value === 'true')}
        className="bg-zinc-900 border border-zinc-800 text-sm text-zinc-300 rounded-xl px-3 py-2 outline-none focus:border-zinc-600 transition-colors"
      >
        <option value="">All Suspend Status</option>
        <option value="true">Suspended</option>
        <option value="false">Not Suspended</option>
      </select>
    </div>
  );
};

// ─── Pagination ───────────────────────────────────────────────────────────────

const Pagination = ({ page, totalPages, onPage }) => {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 pt-4">
      <button
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        className="p-2 rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className="text-sm text-zinc-400">Page {page} of {totalPages}</span>
      <button
        onClick={() => onPage(page + 1)}
        disabled={page >= totalPages}
        className="p-2 rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
};

// ─── Products Tab ─────────────────────────────────────────────────────────────

const ProductsTab = () => {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState(null); // { type, productId, payload, label }
  const [actionLoading, setActionLoading] = useState(null);

  const fetchProducts = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getAdminProducts({ ...filters, page, limit: 15 });
      setData(result);
    } catch (err) {
      console.error('Failed to fetch products:', err);
    } finally {
      setIsLoading(false);
    }
  }, [filters, page]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const handleAction = (type, productId, payload, label) => {
    setConfirm({ type, productId, payload, label });
  };

  const executeAction = async () => {
    if (!confirm) return;
    setActionLoading(confirm.productId);
    try {
      if (confirm.type === 'status') {
        await updateProductStatus(confirm.productId, confirm.payload);
      } else if (confirm.type === 'moderation') {
        await updateProductModeration(confirm.productId, confirm.payload);
      }
      await fetchProducts();
    } catch (err) {
      console.error('Action failed:', err);
    } finally {
      setActionLoading(null);
      setConfirm(null);
    }
  };

  const products = data?.products || [];

  return (
    <div className="space-y-4">
      <FilterBar filters={filters} onFilterChange={handleFilterChange} />

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-zinc-500 flex flex-col items-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-zinc-600" />
            Loading products...
          </div>
        ) : products.length === 0 ? (
          <div className="p-12 text-center text-zinc-500">
            <Package className="w-10 h-10 mx-auto mb-3 text-zinc-700" />
            <p>No products match your filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-zinc-800 text-xs text-zinc-500 uppercase tracking-wider">
                  <th className="px-5 py-3 font-medium">Product</th>
                  <th className="px-5 py-3 font-medium">Seller</th>
                  <th className="px-5 py-3 font-medium">Price</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Flags</th>
                  <th className="px-5 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {products.map((product, idx) => (
                    <motion.tr
                      key={product._id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.03 }}
                      className={`border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors ${
                        actionLoading === product._id ? 'opacity-50' : ''
                      }`}
                    >
                      <td className="px-5 py-4 max-w-[200px]">
                        <p className="font-medium text-zinc-200 truncate">{product.title}</p>
                        <p className="text-xs text-zinc-500 truncate">{product.category}</p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-zinc-300 text-xs">{product.sellerId?.firstName} {product.sellerId?.lastName}</p>
                        <p className="text-zinc-600 text-xs truncate max-w-[120px]">{product.sellerId?.email}</p>
                      </td>
                      <td className="px-5 py-4 text-zinc-300 font-medium">${product.price?.toFixed(2)}</td>
                      <td className="px-5 py-4"><StatusBadge status={product.status} /></td>
                      <td className="px-5 py-4"><ModerationFlags banned={product.banned} suspended={product.suspended} /></td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-1.5">
                          {product.status !== 'approved' && (
                            <button
                              onClick={() => handleAction('status', product._id, 'approved', `Approve "${product.title}"?`)}
                              className="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition-colors"
                              title="Approve"
                            >
                              <CheckCircle className="w-4 h-4" />
                            </button>
                          )}
                          {product.status !== 'rejected' && (
                            <button
                              onClick={() => handleAction('status', product._id, 'rejected', `Reject "${product.title}"?`)}
                              className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors"
                              title="Reject"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          )}
                          {product.status !== 'pending' && product.status !== 'pending_review' && (
                            <button
                              onClick={() => handleAction('status', product._id, 'pending', `Mark "${product.title}" as Pending?`)}
                              className="p-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 transition-colors"
                              title="Set to Pending"
                            >
                              <Clock className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && <Pagination page={data.page} totalPages={data.totalPages} onPage={setPage} />}

      <AnimatePresence>
        {confirm && (
          <ConfirmDialog
            title="Confirm Action"
            description={confirm.label}
            confirmLabel="Yes, proceed"
            isDanger={confirm.type === 'moderation' || confirm.payload === 'rejected'}
            onConfirm={executeAction}
            onCancel={() => setConfirm(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── Sellers Tab ──────────────────────────────────────────────────────────────

const SellersTab = () => {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [expandedSeller, setExpandedSeller] = useState(null);
  const [sellerProducts, setSellerProducts] = useState({});
  const [loadingSellerProducts, setLoadingSellerProducts] = useState(null);

  const fetchSellers = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getAdminSellers({ ...filters, page, limit: 15 });
      setData(result);
    } catch (err) {
      console.error('Failed to fetch sellers:', err);
    } finally {
      setIsLoading(false);
    }
  }, [filters, page]);

  useEffect(() => { fetchSellers(); }, [fetchSellers]);

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const handleExpand = async (sellerId) => {
    if (expandedSeller === sellerId) {
      setExpandedSeller(null);
      return;
    }
    setExpandedSeller(sellerId);
    if (!sellerProducts[sellerId]) {
      setLoadingSellerProducts(sellerId);
      try {
        const products = await getSellerProducts(sellerId);
        setSellerProducts(prev => ({ ...prev, [sellerId]: products }));
      } catch (err) {
        console.error('Failed to load seller products:', err);
      } finally {
        setLoadingSellerProducts(null);
      }
    }
  };

  const handleAction = (sellerId, payload, label) => {
    setConfirm({ sellerId, payload, label });
  };

  const executeAction = async () => {
    if (!confirm) return;
    setActionLoading(confirm.sellerId);
    try {
      await updateSellerModeration(confirm.sellerId, confirm.payload);
      await fetchSellers();
    } catch (err) {
      console.error('Action failed:', err);
    } finally {
      setActionLoading(null);
      setConfirm(null);
    }
  };

  const sellers = data?.sellers || [];

  return (
    <div className="space-y-4">
      <FilterBar filters={filters} onFilterChange={handleFilterChange} forSellers />

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-zinc-500 flex flex-col items-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-zinc-600" />
            Loading sellers...
          </div>
        ) : sellers.length === 0 ? (
          <div className="p-12 text-center text-zinc-500">
            <Users className="w-10 h-10 mx-auto mb-3 text-zinc-700" />
            <p>No sellers match your filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-zinc-800 text-xs text-zinc-500 uppercase tracking-wider">
                  <th className="px-5 py-3 font-medium">Seller</th>
                  <th className="px-5 py-3 font-medium">Products</th>
                  <th className="px-5 py-3 font-medium">Flags</th>
                  <th className="px-5 py-3 font-medium">Joined</th>
                  <th className="px-5 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sellers.map((seller, idx) => (
                  <React.Fragment key={seller._id}>
                    <motion.tr
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.03 }}
                      className={`border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors cursor-pointer ${
                        actionLoading === seller._id ? 'opacity-50' : ''
                      } ${expandedSeller === seller._id ? 'bg-zinc-800/30' : ''}`}
                      onClick={() => handleExpand(seller._id)}
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-semibold text-zinc-300">
                            {seller.firstName?.[0]?.toUpperCase() || '?'}
                          </div>
                          <div>
                            <p className="font-medium text-zinc-200">{seller.firstName} {seller.lastName}</p>
                            <p className="text-xs text-zinc-500">{seller.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="flex items-center gap-1.5 text-zinc-300">
                          <Package className="w-3.5 h-3.5 text-zinc-500" />
                          {seller.productCount ?? 0}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <ModerationFlags banned={seller.banned} suspended={seller.suspended} />
                      </td>
                      <td className="px-5 py-4 text-xs text-zinc-500">
                        {new Date(seller.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-1.5" onClick={e => e.stopPropagation()}>
                          {!seller.banned ? (
                            <button
                              onClick={() => handleAction(seller._id, { banned: true }, `Ban seller ${seller.firstName} ${seller.lastName}? They will lose access to all seller routes.`)}
                              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-red-900/30 text-zinc-400 hover:text-red-400 transition-colors"
                              title="Ban Seller"
                            >
                              <Ban className="w-4 h-4" />
                            </button>
                          ) : (
                            <button
                              onClick={() => handleAction(seller._id, { banned: false }, `Unban seller ${seller.firstName} ${seller.lastName}?`)}
                              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-emerald-900/30 text-zinc-400 hover:text-emerald-400 transition-colors"
                              title="Unban Seller"
                            >
                              <CheckCircle className="w-4 h-4" />
                            </button>
                          )}
                          {!seller.suspended ? (
                            <button
                              onClick={() => handleAction(seller._id, { suspended: true }, `Suspend seller ${seller.firstName} ${seller.lastName}?`)}
                              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-amber-900/30 text-zinc-400 hover:text-amber-400 transition-colors"
                              title="Suspend Seller"
                            >
                              <Pause className="w-4 h-4" />
                            </button>
                          ) : (
                            <button
                              onClick={() => handleAction(seller._id, { suspended: false }, `Unsuspend seller ${seller.firstName} ${seller.lastName}?`)}
                              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-blue-900/30 text-zinc-400 hover:text-blue-400 transition-colors"
                              title="Unsuspend Seller"
                            >
                              <Play className="w-4 h-4" />
                            </button>
                          )}
                          <span className="ml-1 text-zinc-600">
                            {expandedSeller === seller._id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </span>
                        </div>
                      </td>
                    </motion.tr>

                    {/* Expanded seller row — shows recent products */}
                    <AnimatePresence>
                      {expandedSeller === seller._id && (
                        <motion.tr
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          key={`${seller._id}-expand`}
                        >
                          <td colSpan={6} className="px-5 py-4 bg-zinc-800/30 border-b border-zinc-800">
                            {loadingSellerProducts === seller._id ? (
                              <div className="text-xs text-zinc-500 flex items-center gap-2">
                                <RefreshCw className="w-3 h-3 animate-spin" /> Loading products...
                              </div>
                            ) : (sellerProducts[seller._id] || []).length === 0 ? (
                              <p className="text-xs text-zinc-600 italic">No products from this seller.</p>
                            ) : (
                              <div className="space-y-2">
                                <p className="text-xs font-medium text-zinc-400 mb-2 flex items-center gap-1.5">
                                  <Eye className="w-3.5 h-3.5" /> Recent Listings
                                </p>
                                {sellerProducts[seller._id].map(p => (
                                  <div key={p._id} className="flex items-center gap-3 text-xs text-zinc-400">
                                    <span className="text-zinc-300 font-medium truncate max-w-[200px]">{p.title}</span>
                                    <span className="text-zinc-600">{p.category}</span>
                                    <span className="text-zinc-400">${p.price?.toFixed(2)}</span>
                                    <StatusBadge status={p.status} />
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </motion.tr>
                      )}
                    </AnimatePresence>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && <Pagination page={data.page} totalPages={data.totalPages} onPage={setPage} />}

      <AnimatePresence>
        {confirm && (
          <ConfirmDialog
            title="Confirm Action"
            description={confirm.label}
            confirmLabel="Yes, proceed"
            isDanger
            onConfirm={executeAction}
            onCancel={() => setConfirm(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── Reviews Tab ──────────────────────────────────────────────────────────────

const ReviewsTab = () => {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(1);
  const [actionLoading, setActionLoading] = useState(null);

  const fetchReviews = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getAdminReviews({ ...filters, page, limit: 15 });
      setData(result);
    } catch (err) {
      console.error('Failed to fetch reviews:', err);
    } finally {
      setIsLoading(false);
    }
  }, [filters, page]);

  useEffect(() => { fetchReviews(); }, [fetchReviews]);

  const handleModerate = async (reviewId, update) => {
    setActionLoading(reviewId);
    try {
      await moderateReview(reviewId, update);
      await fetchReviews();
    } catch (err) {
      console.error('Moderation failed:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const reviews = data?.reviews || [];

  return (
    <div className="space-y-4">
      {/* Filter strip */}
      <div className="flex flex-wrap gap-3">
        <select
          value={filters.isFlagged || ''}
          onChange={(e) => { setFilters(prev => ({ ...prev, isFlagged: e.target.value || undefined })); setPage(1); }}
          className="bg-zinc-900 border border-zinc-800 text-sm text-zinc-300 rounded-xl px-3 py-2 outline-none"
        >
          <option value="">All Reviews</option>
          <option value="true">Flagged Only</option>
          <option value="false">Not Flagged</option>
        </select>
        <select
          value={filters.isRemoved || ''}
          onChange={(e) => { setFilters(prev => ({ ...prev, isRemoved: e.target.value || undefined })); setPage(1); }}
          className="bg-zinc-900 border border-zinc-800 text-sm text-zinc-300 rounded-xl px-3 py-2 outline-none"
        >
          <option value="">All Status</option>
          <option value="false">Active</option>
          <option value="true">Removed</option>
        </select>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-zinc-500 flex flex-col items-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-zinc-600" />
            Loading reviews...
          </div>
        ) : reviews.length === 0 ? (
          <div className="p-12 text-center text-zinc-500">
            <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-zinc-700" />
            <p>No reviews match your filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-zinc-800 text-xs text-zinc-500 uppercase tracking-wider">
                  <th className="px-5 py-3 font-medium">Reviewer</th>
                  <th className="px-5 py-3 font-medium">Product</th>
                  <th className="px-5 py-3 font-medium">Rating</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((review, idx) => (
                  <motion.tr
                    key={review._id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className={`border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors ${
                      review.isRemoved ? 'opacity-50' : ''
                    } ${actionLoading === review._id ? 'opacity-40' : ''}`}
                  >
                    <td className="px-5 py-4">
                      <p className="font-medium text-zinc-200 text-sm">
                        {review.buyerId?.firstName} {review.buyerId?.lastName}
                      </p>
                      <p className="text-xs text-zinc-500">{review.buyerId?.email}</p>
                      {review.isVerifiedPurchase && (
                        <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" /> Verified Purchase
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 max-w-[160px]">
                      <p className="text-zinc-300 text-sm truncate">{review.productId?.title}</p>
                    </td>
                    <td className="px-5 py-4">
                      <span className="font-bold text-[#FF9900]">{'★'.repeat(review.rating)}</span>
                      <span className="text-zinc-600">{'★'.repeat(5 - review.rating)}</span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-col gap-1">
                        {review.isRemoved ? (
                          <span className="text-xs bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full w-fit">Removed</span>
                        ) : (
                          <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full w-fit">Active</span>
                        )}
                        {review.isFlagged && (
                          <span className="text-xs bg-orange-500/10 text-orange-400 border border-orange-500/20 px-2 py-0.5 rounded-full w-fit">Flagged</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1.5">
                        {!review.isRemoved ? (
                          <button
                            onClick={() => handleModerate(review._id, { isRemoved: true, removedReason: 'Admin removal' })}
                            className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors"
                            title="Remove Review"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleModerate(review._id, { isRemoved: false })}
                            className="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition-colors"
                            title="Restore Review"
                          >
                            <CheckCircle className="w-4 h-4" />
                          </button>
                        )}
                        {!review.isFlagged ? (
                          <button
                            onClick={() => handleModerate(review._id, { isFlagged: true })}
                            className="p-1.5 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 transition-colors"
                            title="Flag Review"
                          >
                            <AlertTriangle className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleModerate(review._id, { isFlagged: false })}
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
                            title="Unflag Review"
                          >
                            <CheckCircle className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && <Pagination page={data.page} totalPages={data.totalPages} onPage={setPage} />}
    </div>
  );
};

// ─── Festive Defense Tab ──────────────────────────────────────────────────────

const EVENT_LABELS = {
  GIF: 'Amazon Great Indian Festival',
  BBD: 'Big Billion Days',
  DIWALI: 'Diwali',
  EOSS: 'End of Season Sale',
  REPUBLIC_DAY: 'Republic Day Sale',
  RAKHI: 'Raksha Bandhan',
  WEDDING: 'Wedding Season',
};

const FestiveTab = () => {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(null); // instanceKey being toggled

  const load = async () => {
    setLoading(true);
    try {
      const data = await getFestiveCalendar();
      setEvents(Array.isArray(data) ? data : []);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleToggle = async (event) => {
    setToggling(event.instanceKey);
    try {
      await setFestiveOverride(event.instanceKey, !event.forceActive);
      await load();
    } catch (err) {
      console.error('Override failed:', err);
    } finally {
      setToggling(null);
    }
  };

  const forced = events.find((e) => e.forceActive);

  return (
    <div className="space-y-4">
      {/* Status banner */}
      <div className={`rounded-2xl border p-4 flex items-center gap-3 ${
        forced
          ? 'bg-amber-500/10 border-amber-500/30'
          : 'bg-zinc-900 border-zinc-800'
      }`}>
        {forced ? (
          <>
            <Sparkles className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-bold text-amber-300">Festive Mode ACTIVE (demo override)</p>
              <p className="text-xs text-amber-500/80 mt-0.5">
                {EVENT_LABELS[forced.eventCode] || forced.eventCode} — all three levers are live.
                Toggle off below to restore real dates.
              </p>
            </div>
          </>
        ) : (
          <>
            <ZapOff className="w-5 h-5 text-zinc-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-bold text-zinc-400">Festive Mode OFF (real dates govern)</p>
              <p className="text-xs text-zinc-600 mt-0.5">
                Force an event active below to demo the festive levers.
              </p>
            </div>
          </>
        )}
      </div>

      {/* Calendar table */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl h-16 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((ev) => {
            const start = new Date(ev.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            const end = new Date(ev.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            const isBusy = toggling === ev.instanceKey;

            return (
              <div
                key={ev.instanceKey}
                className={`flex items-center gap-4 rounded-xl border px-4 py-3 transition-colors ${
                  ev.forceActive
                    ? 'bg-amber-500/5 border-amber-500/30'
                    : 'bg-zinc-900 border-zinc-800'
                }`}
              >
                {/* Event info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-white truncate">
                      {EVENT_LABELS[ev.eventCode] || ev.eventCode}
                    </span>
                    {ev.policies?.cancelLock && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400">
                        cancel-lock
                      </span>
                    )}
                    {ev.forceActive && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">
                        FORCED
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500">{start} → {end}</p>
                </div>

                {/* Lever chips */}
                <div className="hidden sm:flex items-center gap-1.5">
                  {ev.policies?.returnWindowShrink && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                      return window
                    </span>
                  )}
                  {ev.policies?.codGate && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">
                      COD gate
                    </span>
                  )}
                  {ev.policies?.cancelLock && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20">
                      cancel lock
                    </span>
                  )}
                </div>

                {/* Toggle button */}
                <button
                  onClick={() => handleToggle(ev)}
                  disabled={isBusy}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex-shrink-0 disabled:opacity-50 ${
                    ev.forceActive
                      ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300'
                      : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                  }`}
                >
                  {isBusy ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : ev.forceActive ? (
                    <><ZapOff className="w-3.5 h-3.5" /> Turn off</>
                  ) : (
                    <><Zap className="w-3.5 h-3.5" /> Force ON</>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-zinc-600 pt-2">
        "Force ON" activates festive levers regardless of today's date — safe for demos.
        Only one event can be forced at a time. Real-date events activate automatically when the calendar matches.
      </p>
    </div>
  );
};

// ─── Prompts Tab (AI Grader fine-tuning) ──────────────────────────────────────

const PromptsTab = () => {
  const [prompts, setPrompts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [drafts, setDrafts] = useState({});      // key -> content
  const [savingKey, setSavingKey] = useState(null);
  const [savedKey, setSavedKey] = useState(null);

  const keyOf = (p) => `${p.scope}:${p.key}`;

  const fetchPrompts = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await listPrompts();
      const list = res.data || [];
      setPrompts(list);
      setDrafts(Object.fromEntries(list.map((p) => [`${p.scope}:${p.key}`, p.content || ''])));
    } catch (err) {
      console.error('Failed to load prompts:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchPrompts(); }, [fetchPrompts]);

  const handleSave = async (p) => {
    const k = keyOf(p);
    setSavingKey(k);
    try {
      await savePrompt({ scope: p.scope, key: p.key, content: drafts[k], label: p.label });
      setSavedKey(k);
      setTimeout(() => setSavedKey(null), 1800);
      await fetchPrompts();
    } catch (err) {
      console.error('Failed to save prompt:', err);
    } finally {
      setSavingKey(null);
    }
  };

  const handleReset = async (p) => {
    const k = keyOf(p);
    setSavingKey(k);
    try {
      const res = await resetPrompt({ scope: p.scope, key: p.key });
      const content = res?.data?.content ?? '';
      setDrafts((prev) => ({ ...prev, [k]: content }));
      await fetchPrompts();
    } catch (err) {
      console.error('Failed to reset prompt:', err);
    } finally {
      setSavingKey(null);
    }
  };

  if (isLoading) {
    return (
      <div className="p-12 text-center text-zinc-500 flex flex-col items-center gap-3">
        <RefreshCw className="w-6 h-6 animate-spin text-zinc-600" />
        Loading prompts...
      </div>
    );
  }

  const base = prompts.filter((p) => p.scope === 'base');
  const categories = prompts.filter((p) => p.scope === 'category');

  const PromptCard = ({ p }) => {
    const k = keyOf(p);
    const dirty = (drafts[k] ?? '') !== (p.content ?? '');
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-zinc-100">{p.label || `${p.scope}:${p.key}`}</p>
            <p className="text-xs text-zinc-500">
              {p.scope === 'base' ? 'Applies to every grading call' : `Category bundle: ${p.key}`}
              {p.version ? ` · v${p.version}` : ' · default (unsaved)'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {savedKey === k && <span className="text-xs text-emerald-400">Saved</span>}
            <button
              onClick={() => handleReset(p)}
              disabled={savingKey === k}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
            >
              Reset to default
            </button>
            <button
              onClick={() => handleSave(p)}
              disabled={savingKey === k || !dirty}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30 disabled:opacity-40"
            >
              {savingKey === k ? 'Saving…' : dirty ? 'Save' : 'Saved'}
            </button>
          </div>
        </div>
        <textarea
          value={drafts[k] ?? ''}
          onChange={(e) => setDrafts((prev) => ({ ...prev, [k]: e.target.value }))}
          rows={p.scope === 'base' ? 16 : 8}
          spellCheck={false}
          className="w-full bg-black/40 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 font-mono leading-relaxed outline-none focus:border-violet-500/40 resize-y"
        />
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="bg-violet-500/5 border border-violet-500/20 rounded-2xl p-4">
        <p className="text-sm font-semibold text-violet-300 mb-1">AI Grader Prompt Tuning</p>
        <p className="text-xs text-zinc-400 leading-relaxed">
          Prompts compose in order: <span className="text-zinc-300">Base → Category → Seller (per-product)</span>.
          The base prompt forces image verification before any condition analysis. Category prompts
          bundle similar categories (e.g. skincare, pharma and supplements share one "sealed
          consumables → liquidate" rule). Sellers add per-product instructions from their dashboard.
        </p>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wider text-zinc-500 font-medium mb-2">Base Prompt</p>
        <div className="space-y-4">{base.map((p) => <PromptCard key={keyOf(p)} p={p} />)}</div>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wider text-zinc-500 font-medium mb-2">Category Prompts</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {categories.map((p) => <PromptCard key={keyOf(p)} p={p} />)}
        </div>
      </div>
    </div>
  );
};

// ─── Main Admin Dashboard ─────────────────────────────────────────────────────

const TABS = [
  { id: 'products', label: 'Products', icon: Package },
  { id: 'sellers', label: 'Sellers', icon: Users },
  { id: 'reviews', label: 'Reviews', icon: Eye },
  { id: 'festive', label: 'Festive Mode', icon: Sparkles },
  { id: 'prompts', label: 'AI Prompts', icon: Sparkles },
];

const AdminDashboard = () => {
  const [activeTab, setActiveTab] = useState('products');
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const s = await getStats();
        setStats(s);
      } catch (err) {
        console.error('Failed to load stats:', err);
      } finally {
        setStatsLoading(false);
      }
    };
    fetchStats();
  }, []);

  return (
    <div className="min-h-screen bg-black text-white font-sans">
      {/* Top Header */}
      <div className="border-b border-zinc-900 bg-black/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
              <Shield className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">Admin Control Center</h1>
              <p className="text-xs text-zinc-500">Trust & Safety Platform</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-violet-400" />
            <span className="text-xs text-zinc-500">Live Moderation</span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Stats */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          {statsLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {Array(6).fill(0).map((_, i) => (
                <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 h-20 animate-pulse" />
              ))}
            </div>
          ) : (
            <StatsBar stats={stats} />
          )}
        </motion.div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1 w-fit">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-zinc-700 text-white shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            {activeTab === 'products' ? <ProductsTab /> : activeTab === 'sellers' ? <SellersTab /> : activeTab === 'reviews' ? <ReviewsTab /> : <FestiveTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

export default AdminDashboard;
