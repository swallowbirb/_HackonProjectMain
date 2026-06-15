import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Package, Users, AlertTriangle, CheckCircle, Clock,
  XCircle, Ban, Pause, Play, Search, ChevronLeft, ChevronRight,
  RefreshCw, TrendingUp, Eye, ChevronDown, ChevronUp, Sparkles, Zap, ZapOff,
  Maximize2, X, Plus, Trash2
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
import { listPrompts, savePrompt, resetPrompt, createCategoryPrompt, deleteCategoryPrompt } from '../../services/prompt.service';

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
  const c = config[status] || { label: status, icon: Clock, cls: 'bg-gray-300/50 text-gray-400 border-gray-300/20' };
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
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-white/70 backdrop-blur-sm">
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-gray-100 border border-gray-300 rounded-2xl p-6 w-full max-w-sm shadow-2xl"
    >
      <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
      <p className="text-sm text-gray-400 mb-6">{description}</p>
      <div className="flex gap-3 justify-end">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
            isDanger
              ? 'bg-red-600 hover:bg-red-500 text-gray-900'
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
            className="bg-white border border-gray-200 rounded-2xl p-4 flex flex-col gap-2"
          >
            <div className={`w-8 h-8 rounded-lg ${stat.bg} flex items-center justify-center`}>
              <Icon className={`w-4 h-4 ${stat.color}`} />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stat.value ?? 0}</p>
              <p className="text-xs text-gray-500 mt-0.5">{stat.label}</p>
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
      <div className="flex items-center gap-2 flex-1 min-w-[200px] bg-gray-100 border border-gray-200 rounded-xl px-3 py-2">
        <Search className="w-4 h-4 text-gray-500 flex-shrink-0" />
        <input
          type="text"
          placeholder={forSellers ? 'Search sellers...' : 'Search products...'}
          value={filters.search || ''}
          onChange={e => onFilterChange('search', e.target.value)}
          className="bg-transparent text-sm text-gray-900 placeholder:text-gray-600 outline-none w-full"
        />
      </div>

      {!forSellers && (
        <select
          value={filters.status || ''}
          onChange={e => onFilterChange('status', e.target.value)}
          className="bg-gray-100 border border-gray-200 text-sm text-gray-700 rounded-xl px-3 py-2 outline-none focus:border-gray-300 transition-colors"
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
        className="bg-gray-100 border border-gray-200 text-sm text-gray-700 rounded-xl px-3 py-2 outline-none focus:border-gray-300 transition-colors"
      >
        <option value="">All Ban Status</option>
        <option value="true">Banned</option>
        <option value="false">Not Banned</option>
      </select>

      <select
        value={filters.suspended !== undefined ? String(filters.suspended) : ''}
        onChange={e => onFilterChange('suspended', e.target.value === '' ? undefined : e.target.value === 'true')}
        className="bg-gray-100 border border-gray-200 text-sm text-gray-700 rounded-xl px-3 py-2 outline-none focus:border-gray-300 transition-colors"
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
        className="p-2 rounded-lg bg-gray-200 text-gray-400 hover:bg-gray-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className="text-sm text-gray-400">Page {page} of {totalPages}</span>
      <button
        onClick={() => onPage(page + 1)}
        disabled={page >= totalPages}
        className="p-2 rounded-lg bg-gray-200 text-gray-400 hover:bg-gray-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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

      <div className="bg-gray-100 border border-gray-200 rounded-2xl overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-gray-500 flex flex-col items-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-zinc-600" />
            Loading products...
          </div>
        ) : products.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <Package className="w-10 h-10 mx-auto mb-3 text-zinc-700" />
            <p>No products match your filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase tracking-wider">
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
                      className={`border-b border-gray-200/50 hover:bg-gray-200/20 transition-colors ${
                        actionLoading === product._id ? 'opacity-50' : ''
                      }`}
                    >
                      <td className="px-5 py-4 max-w-[200px]">
                        <p className="font-medium text-gray-800 truncate">{product.title}</p>
                        <p className="text-xs text-gray-500 truncate">{product.category}</p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-gray-700 text-xs">{product.sellerId?.firstName} {product.sellerId?.lastName}</p>
                        <p className="text-zinc-600 text-xs truncate max-w-[120px]">{product.sellerId?.email}</p>
                      </td>
                      <td className="px-5 py-4 text-gray-700 font-medium">${product.price?.toFixed(2)}</td>
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

      <div className="bg-gray-100 border border-gray-200 rounded-2xl overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-gray-500 flex flex-col items-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-zinc-600" />
            Loading sellers...
          </div>
        ) : sellers.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <Users className="w-10 h-10 mx-auto mb-3 text-zinc-700" />
            <p>No sellers match your filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase tracking-wider">
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
                      className={`border-b border-gray-200/50 hover:bg-gray-200/20 transition-colors cursor-pointer ${
                        actionLoading === seller._id ? 'opacity-50' : ''
                      } ${expandedSeller === seller._id ? 'bg-gray-200/30' : ''}`}
                      onClick={() => handleExpand(seller._id)}
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-xs font-semibold text-gray-700">
                            {seller.firstName?.[0]?.toUpperCase() || '?'}
                          </div>
                          <div>
                            <p className="font-medium text-gray-800">{seller.firstName} {seller.lastName}</p>
                            <p className="text-xs text-gray-500">{seller.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="flex items-center gap-1.5 text-gray-700">
                          <Package className="w-3.5 h-3.5 text-gray-500" />
                          {seller.productCount ?? 0}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <ModerationFlags banned={seller.banned} suspended={seller.suspended} />
                      </td>
                      <td className="px-5 py-4 text-xs text-gray-500">
                        {new Date(seller.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-1.5" onClick={e => e.stopPropagation()}>
                          {!seller.banned ? (
                            <button
                              onClick={() => handleAction(seller._id, { banned: true }, `Ban seller ${seller.firstName} ${seller.lastName}? They will lose access to all seller routes.`)}
                              className="p-1.5 rounded-lg bg-gray-200 hover:bg-red-900/30 text-gray-400 hover:text-red-400 transition-colors"
                              title="Ban Seller"
                            >
                              <Ban className="w-4 h-4" />
                            </button>
                          ) : (
                            <button
                              onClick={() => handleAction(seller._id, { banned: false }, `Unban seller ${seller.firstName} ${seller.lastName}?`)}
                              className="p-1.5 rounded-lg bg-gray-200 hover:bg-emerald-900/30 text-gray-400 hover:text-emerald-400 transition-colors"
                              title="Unban Seller"
                            >
                              <CheckCircle className="w-4 h-4" />
                            </button>
                          )}
                          {!seller.suspended ? (
                            <button
                              onClick={() => handleAction(seller._id, { suspended: true }, `Suspend seller ${seller.firstName} ${seller.lastName}?`)}
                              className="p-1.5 rounded-lg bg-gray-200 hover:bg-amber-900/30 text-gray-400 hover:text-amber-400 transition-colors"
                              title="Suspend Seller"
                            >
                              <Pause className="w-4 h-4" />
                            </button>
                          ) : (
                            <button
                              onClick={() => handleAction(seller._id, { suspended: false }, `Unsuspend seller ${seller.firstName} ${seller.lastName}?`)}
                              className="p-1.5 rounded-lg bg-gray-200 hover:bg-blue-900/30 text-gray-400 hover:text-blue-400 transition-colors"
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
                          <td colSpan={6} className="px-5 py-4 bg-gray-200/30 border-b border-gray-200">
                            {loadingSellerProducts === seller._id ? (
                              <div className="text-xs text-gray-500 flex items-center gap-2">
                                <RefreshCw className="w-3 h-3 animate-spin" /> Loading products...
                              </div>
                            ) : (sellerProducts[seller._id] || []).length === 0 ? (
                              <p className="text-xs text-zinc-600 italic">No products from this seller.</p>
                            ) : (
                              <div className="space-y-2">
                                <p className="text-xs font-medium text-gray-400 mb-2 flex items-center gap-1.5">
                                  <Eye className="w-3.5 h-3.5" /> Recent Listings
                                </p>
                                {sellerProducts[seller._id].map(p => (
                                  <div key={p._id} className="flex items-center gap-3 text-xs text-gray-400">
                                    <span className="text-gray-700 font-medium truncate max-w-[200px]">{p.title}</span>
                                    <span className="text-zinc-600">{p.category}</span>
                                    <span className="text-gray-400">${p.price?.toFixed(2)}</span>
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
          className="bg-gray-100 border border-gray-200 text-sm text-gray-700 rounded-xl px-3 py-2 outline-none"
        >
          <option value="">All Reviews</option>
          <option value="true">Flagged Only</option>
          <option value="false">Not Flagged</option>
        </select>
        <select
          value={filters.isRemoved || ''}
          onChange={(e) => { setFilters(prev => ({ ...prev, isRemoved: e.target.value || undefined })); setPage(1); }}
          className="bg-gray-100 border border-gray-200 text-sm text-gray-700 rounded-xl px-3 py-2 outline-none"
        >
          <option value="">All Status</option>
          <option value="false">Active</option>
          <option value="true">Removed</option>
        </select>
      </div>

      <div className="bg-gray-100 border border-gray-200 rounded-2xl overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-gray-500 flex flex-col items-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-zinc-600" />
            Loading reviews...
          </div>
        ) : reviews.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-zinc-700" />
            <p>No reviews match your filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase tracking-wider">
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
                    className={`border-b border-gray-200/50 hover:bg-gray-200/20 transition-colors ${
                      review.isRemoved ? 'opacity-50' : ''
                    } ${actionLoading === review._id ? 'opacity-40' : ''}`}
                  >
                    <td className="px-5 py-4">
                      <p className="font-medium text-gray-800 text-sm">
                        {review.buyerId?.firstName} {review.buyerId?.lastName}
                      </p>
                      <p className="text-xs text-gray-500">{review.buyerId?.email}</p>
                      {review.isVerifiedPurchase && (
                        <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" /> Verified Purchase
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 max-w-[160px]">
                      <p className="text-gray-700 text-sm truncate">{review.productId?.title}</p>
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
                            className="p-1.5 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-400 transition-colors"
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
  const [toggling, setToggling] = useState(null);

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
    <div className="space-y-5 max-w-3xl">

      {/* Status banner */}
      <div className={`rounded-2xl border p-5 flex items-center gap-4 transition-all ${
        forced ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'
      }`}>
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${forced ? 'bg-amber-100' : 'bg-gray-100'}`}>
          {forced
            ? <Sparkles className="w-6 h-6 text-amber-500" />
            : <ZapOff className="w-6 h-6 text-gray-400" />
          }
        </div>
        <div className="flex-1">
          <p className={`font-bold text-base ${forced ? 'text-amber-700' : 'text-gray-800'}`}>
            {forced ? `Festive Mode ACTIVE — ${EVENT_LABELS[forced.eventCode] || forced.eventCode}` : 'Festive Mode OFF'}
          </p>
          <p className={`text-sm mt-0.5 ${forced ? 'text-amber-600' : 'text-gray-500'}`}>
            {forced
              ? 'All three levers are live. Toggle off below to restore real-date behaviour.'
              : 'Toggle any event below to demo festive levers regardless of today\'s date.'}
          </p>
        </div>
        {forced && (
          <span className="text-xs font-bold px-3 py-1 rounded-full bg-amber-500 text-white flex-shrink-0">LIVE</span>
        )}
      </div>

      {/* Event cards */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-2xl h-20 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((ev) => {
            const start = new Date(ev.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            const end = new Date(ev.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            const isBusy = toggling === ev.instanceKey;

            return (
              <div
                key={ev.instanceKey}
                className={`flex items-center gap-5 rounded-2xl border px-5 py-4 transition-all ${
                  ev.forceActive ? 'bg-amber-50 border-amber-200 shadow-sm' : 'bg-white border-gray-200'
                }`}
              >
                {/* Icon */}
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${ev.forceActive ? 'bg-amber-100' : 'bg-gray-100'}`}>
                  <Sparkles className={`w-5 h-5 ${ev.forceActive ? 'text-amber-500' : 'text-gray-400'}`} />
                </div>

                {/* Event info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900">
                      {EVENT_LABELS[ev.eventCode] || ev.eventCode}
                    </span>
                    {ev.forceActive && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500 text-white">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{start} → {end}</p>
                  {/* Lever chips */}
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    {ev.policies?.returnWindowShrink && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100 font-medium">
                        ↩ return window
                      </span>
                    )}
                    {ev.policies?.codGate && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100 font-medium">
                        🚫 COD gate
                      </span>
                    )}
                    {ev.policies?.cancelLock && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 border border-orange-100 font-medium">
                        🔒 cancel lock
                      </span>
                    )}
                  </div>
                </div>

                {/* Toggle switch */}
                <div className="flex flex-col items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => handleToggle(ev)}
                    disabled={isBusy}
                    title={ev.forceActive ? 'Turn off' : 'Force ON'}
                    className="focus:outline-none disabled:opacity-40 cursor-pointer"
                  >
                    {isBusy ? (
                      <div className="w-12 h-6 flex items-center justify-center">
                        <RefreshCw className="w-4 h-4 animate-spin text-gray-400" />
                      </div>
                    ) : (
                      <div className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${ev.forceActive ? 'bg-amber-500' : 'bg-gray-300'}`}>
                        <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200 ${ev.forceActive ? 'translate-x-6' : 'translate-x-0'}`} />
                      </div>
                    )}
                  </button>
                  <span className="text-[10px] text-gray-400">{ev.forceActive ? 'ON' : 'OFF'}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-gray-400 pb-2">
        Only one event can be forced at a time. Real-date events activate automatically when the calendar matches.
      </p>
    </div>
  );
};

// ─── Prompts Tab (AI Grader fine-tuning) ──────────────────────────────────────

const TEMPLATE_DESCRIPTIONS = {
  pass1_form: 'Form generation — Pass 1 (dynamic schema + aspects)',
  pass2_synthesis: 'Grade synthesis — Pass 2 (condition grade + routing hint)',
  evidence_inspection: 'Field inspection — checks each photo set against declared aspects',
  montage: 'Montage overview — low-res contact-sheet triage call',
};

const promptKeyOf = (p) => `${p.scope}:${p.key}`;

const PromptCard = ({ p, drafts, setDrafts, savingKey, savedKey, onSave, onReset, onDelete }) => {
  const [expanded, setExpanded] = useState(false);
  const k = promptKeyOf(p);
  const dirty = (drafts[k] ?? '') !== (p.content ?? '');
  const isCustomCategory = p.scope === 'category' && !p.builtin;
  const desc =
    p.scope === 'base' ? 'Applies to every grading call' :
    p.scope === 'template' ? (TEMPLATE_DESCRIPTIONS[p.key] || `ML prompt template: ${p.key}`) :
    isCustomCategory ? `Custom category · matches products in “${p.key}”` :
    `Category bundle: ${p.key}`;

  const Buttons = () => (
    <div className="flex items-center gap-2 flex-shrink-0">
      {savedKey === k && <span className="text-xs text-emerald-400">Saved</span>}
      {isCustomCategory ? (
        <button
          onClick={() => onDelete(p)}
          disabled={savingKey === k}
          title="Delete this custom category"
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-40 inline-flex items-center gap-1.5"
        >
          <Trash2 className="w-3.5 h-3.5" /> Delete
        </button>
      ) : (
        <button
          onClick={() => onReset(p)}
          disabled={savingKey === k}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-40"
        >
          Reset to default
        </button>
      )}
      <button
        onClick={() => onSave(p)}
        disabled={savingKey === k || !dirty}
        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white border border-indigo-600 hover:bg-indigo-700 disabled:opacity-40"
      >
        {savingKey === k ? 'Saving…' : dirty ? 'Save' : 'Saved'}
      </button>
    </div>
  );

  return (
    <>
      <div className="bg-gray-100 border border-gray-200 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-gray-900">{p.label || `${p.scope}:${p.key}`}</p>
            <p className="text-xs text-gray-500">
              {desc}
              {p.version ? ` · v${p.version}` : ' · default (unsaved)'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setExpanded(true)}
              className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-200"
              title="Expand editor"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <Buttons />
          </div>
        </div>
        <textarea
          value={drafts[k] ?? ''}
          onChange={(e) => setDrafts((prev) => ({ ...prev, [k]: e.target.value }))}
          rows={p.scope === 'base' ? 16 : 10}
          spellCheck={false}
          className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-800 font-mono leading-relaxed outline-none focus:border-indigo-400 resize-y"
        />
      </div>

      {expanded && (
        <div className="fixed inset-0 z-50 bg-white/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-gray-100 border border-gray-200 rounded-2xl flex flex-col w-full max-w-5xl h-full max-h-[90vh]">
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-200 flex-shrink-0">
              <div>
                <p className="font-semibold text-gray-900">{p.label || `${p.scope}:${p.key}`}</p>
                <p className="text-xs text-gray-500">{desc}</p>
              </div>
              <div className="flex items-center gap-2">
                <Buttons />
                <button
                  onClick={() => setExpanded(false)}
                  className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-200 ml-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <textarea
              value={drafts[k] ?? ''}
              onChange={(e) => setDrafts((prev) => ({ ...prev, [k]: e.target.value }))}
              spellCheck={false}
              autoFocus
              className="flex-1 bg-transparent px-6 py-4 text-xs text-gray-800 font-mono leading-relaxed outline-none resize-none"
            />
          </div>
        </div>
      )}
    </>
  );
};

// Mirrors the backend slug rule so the UI can preview the resulting key + catch dupes.
const slugifyCategory = (name) =>
  String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const AddCategoryCard = ({ existingKeys, onCreate }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const slug = slugifyCategory(name);
  const duplicate = slug && existingKeys.includes(slug);
  const canSave = slug && content.trim() && !duplicate && !saving;

  const reset = () => { setName(''); setContent(''); setError(''); setOpen(false); };

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      await onCreate({ name, content });
      reset();
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to create category.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-4 w-full rounded-2xl border border-dashed border-gray-300 hover:border-violet-500/50 text-gray-400 hover:text-indigo-700 py-3 text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors"
      >
        <Plus className="w-4 h-4" /> Add category
      </button>
    );
  }

  return (
    <div className="mt-4 bg-gray-100 border border-indigo-200 rounded-2xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-gray-900">New category overlay</p>
        <button onClick={reset} className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-200">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Category name (e.g. Jewelry, Home & Garden)"
          className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 outline-none focus:border-indigo-400"
        />
        <p className="text-xs text-gray-500 mt-1">
          {slug
            ? <>File: <span className="text-gray-700 font-mono">categories/{slug}.txt</span> · applies to products whose category resolves to “{slug}”.</>
            : 'Used to name the overlay file and match products by category.'}
          {duplicate && <span className="text-amber-400"> — a category with this key already exists.</span>}
        </p>
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={8}
        spellCheck={false}
        placeholder={'CATEGORY OVERLAY — …\n\nWhen grading …, weight these category-specific factors:\n- …'}
        className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-800 font-mono leading-relaxed outline-none focus:border-indigo-400 resize-y"
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <button onClick={reset} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-200 text-gray-700 hover:bg-gray-300">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!canSave}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white border border-indigo-600 hover:bg-indigo-700 disabled:opacity-40"
        >
          {saving ? 'Creating…' : 'Create category'}
        </button>
      </div>
    </div>
  );
};

const PromptsTab = () => {
  const [prompts, setPrompts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [drafts, setDrafts] = useState({});
  const [savingKey, setSavingKey] = useState(null);
  const [savedKey, setSavedKey] = useState(null);

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
    const k = promptKeyOf(p);
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
    const k = promptKeyOf(p);
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

  const handleDelete = async (p) => {
    if (!window.confirm(`Delete the “${p.label || p.key}” category? Its overlay file will be removed.`)) return;
    const k = promptKeyOf(p);
    setSavingKey(k);
    try {
      await deleteCategoryPrompt({ key: p.key });
      await fetchPrompts();
    } catch (err) {
      console.error('Failed to delete category:', err);
      window.alert(err?.response?.data?.message || 'Failed to delete category.');
    } finally {
      setSavingKey(null);
    }
  };

  const handleCreateCategory = async ({ name, content }) => {
    const res = await createCategoryPrompt({ name, content });
    await fetchPrompts();
    return res?.data?.key;
  };

  if (isLoading) {
    return (
      <div className="p-12 text-center text-gray-500 flex flex-col items-center gap-3">
        <RefreshCw className="w-6 h-6 animate-spin text-zinc-600" />
        Loading prompts...
      </div>
    );
  }

  const base = prompts.filter((p) => p.scope === 'base');
  const categories = prompts.filter((p) => p.scope === 'category');
  const templates = prompts.filter((p) => p.scope === 'template');

  const cardProps = { drafts, setDrafts, savingKey, savedKey, onSave: handleSave, onReset: handleReset, onDelete: handleDelete };

  return (
    <div className="space-y-5">
      <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4">
        <p className="text-sm font-semibold text-indigo-700 mb-1">AI Grader Prompt Console</p>
        <p className="text-xs text-gray-400 leading-relaxed">
          Grading prompts compose in order: <span className="text-gray-700">Base → Category → Seller (per-product)</span>.
          Template prompts are used verbatim by the ML service for form generation, grade synthesis,
          evidence inspection, and montage triage — overriding the bundled defaults when set.
        </p>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wider text-gray-500 font-medium mb-2">Base Prompt</p>
        <div className="space-y-4">{base.map((p) => <PromptCard key={promptKeyOf(p)} p={p} {...cardProps} />)}</div>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wider text-gray-500 font-medium mb-2">Category Prompts</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {categories.map((p) => <PromptCard key={promptKeyOf(p)} p={p} {...cardProps} />)}
        </div>
        <AddCategoryCard
          existingKeys={categories.map((p) => p.key)}
          onCreate={handleCreateCategory}
        />
      </div>

      {templates.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-500 font-medium mb-2">ML Prompt Templates</p>
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-3 mb-3">
            <p className="text-[11px] text-gray-300">
              These templates override the bundled prompt files in the ML service. Leave a template blank to use the bundled default. Changes take effect on the next grading call — no restart required.
            </p>
          </div>
          <div className="space-y-4">
            {templates.map((p) => <PromptCard key={promptKeyOf(p)} p={p} {...cardProps} />)}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Main Admin Dashboard ─────────────────────────────────────────────────────

const TABS = [
  { id: 'products', label: 'Products', icon: Package },
  { id: 'sellers', label: 'Sellers', icon: Users },
  { id: 'reviews', label: 'Reviews', icon: Eye },
  { id: 'festive', label: 'Festive Mode', icon: Sparkles },
  { id: 'prompts', label: 'Prompt Console', icon: Zap },
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
    <div className="min-h-screen bg-[#EAEDED] text-gray-900 font-sans">
      {/* Top Header */}
      <div className="border-b border-gray-200 bg-white sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-100 border border-violet-200 flex items-center justify-center">
              <Shield className="w-5 h-5 text-violet-600" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900 tracking-tight">Admin Control Center</h1>
              <p className="text-xs text-gray-500">Trust & Safety Platform</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-violet-500" />
            <span className="text-xs text-gray-500">Live Moderation</span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Stats Bar */}
        {!statsLoading && <StatsBar stats={stats} />}

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 bg-gray-100 border border-gray-200 rounded-xl p-1 w-fit flex-wrap">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
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
            {activeTab === 'products' && <ProductsTab />}
            {activeTab === 'sellers' && <SellersTab />}
            {activeTab === 'reviews' && <ReviewsTab />}
            {activeTab === 'festive' && <FestiveTab />}
            {activeTab === 'prompts' && <PromptsTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

export default AdminDashboard;
