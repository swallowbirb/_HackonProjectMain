import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { getSellerProducts, deleteProduct } from '../services/product.service';
import { getSellerEnrollments, requestEnrollment } from '../services/brand.service';
import { getMyOffers, deleteOffer, updateOffer } from '../services/offer.service';
import { getMyResaleListings, publishResaleListing, unlistResaleListing, updateResalePrice } from '../services/resale.service';
import {
  PlusCircle, Package, Activity, AlertTriangle, CheckCircle, Clock,
  AlertCircle, Shield, Tag, ChevronRight, Loader2, Store, Users,
  ShoppingBag, Zap, ExternalLink, Trash2, ToggleLeft, ToggleRight, X,
  Recycle, Check, Pencil, Truck, MapPin, Send, Users2, EyeOff, Eye,
} from 'lucide-react';

// Local-only "hide" so testing clutter can be tucked away without touching the DB.
const HIDDEN_KEY = 'seller_hidden_listings';
const loadHidden = () => {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')); }
  catch { return new Set(); }
};
const saveHidden = (set) => {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
};
const hideKey = (type, id) => `${type}:${id}`;

/**
 * Human-readable summary of the routing decision tree for the seller. The seller
 * never tunes routing — they just see what the platform will do on publish.
 */
const resaleRoutePlan = (listing) => {
  const r = listing.routing;
  if (!r) return { label: 'Resale', sub: "We'll route it when you publish", Icon: Recycle };
  if (r.peerRedistribute) {
    return {
      label: 'Local peer handoff',
      sub: r.matchWindowHours ? `${r.matchWindowHours}h match window nearby` : 'Direct to a nearby buyer',
      Icon: Users2,
    };
  }
  if (r.warehouse) {
    return { label: `Ship to ${r.warehouse.city}`, sub: r.warehouse.name, Icon: Truck };
  }
  const map = { resell: 'Resell via hub', refurbish: 'Refurbish & resell' };
  return { label: map[r.chosenPath] || 'Resell', sub: `Nearby demand: ${r.demandCount}`, Icon: MapPin };
};
import { useCustomUser } from '../context/CustomUserContext';
import ReturnInsightsPanel from '../components/prevention/ReturnInsightsPanel';

const StatusBadge = ({ status }) => {
  switch (status) {
    case 'published':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
          <CheckCircle className="w-3 h-3" /> Published
        </span>
      );
    case 'approved':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
          <CheckCircle className="w-3 h-3" /> Approved
        </span>
      );
    case 'pending_review':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
          <Clock className="w-3 h-3" /> Pending Review
        </span>
      );
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
          <Clock className="w-3 h-3" /> Pending
        </span>
      );
    case 'flagged':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
          <AlertTriangle className="w-3 h-3" /> Flagged
        </span>
      );
    case 'rejected':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-600 border border-red-200">
          <AlertTriangle className="w-3 h-3" /> Rejected
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200">
          Unknown
        </span>
      );
  }
};

const EnrollmentBadge = ({ status }) => {
  if (!status) return <span className="text-xs text-gray-500">Not Applied</span>;
  const styles = {
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    rejected: 'bg-red-50 text-red-600 border-red-200',
  };
  const icons = {
    pending: <Clock className="w-3 h-3" />,
    approved: <CheckCircle className="w-3 h-3" />,
    rejected: <AlertTriangle className="w-3 h-3" />,
  };
  const label = { pending: 'Pending Review', approved: 'Approved', rejected: 'Rejected' };
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status]}`}>
      {icons[status]} {label[status]}
    </span>
  );
};

const TABS = [
  { id: 'listings', label: 'My Listings', icon: Package },
  { id: 'offers', label: 'My Offers', icon: ShoppingBag },
  { id: 'resale', label: 'Resale Listings', icon: Recycle },
  { id: 'brands', label: 'Brand Authorization', icon: Tag },
  { id: 'insights', label: 'Return Insights', icon: Activity },
];

const SellerDashboard = () => {
  const [activeTab, setActiveTab] = useState('listings');
  const [products, setProducts] = useState([]);
  const [brands, setBrands] = useState([]);
  const [offers, setOffers] = useState([]);
  const [resaleListings, setResaleListings] = useState([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);
  const [isLoadingBrands, setIsLoadingBrands] = useState(false);
  const [isLoadingOffers, setIsLoadingOffers] = useState(false);
  const [isLoadingResale, setIsLoadingResale] = useState(false);
  const [editingPriceId, setEditingPriceId] = useState(null);
  const [priceDraft, setPriceDraft] = useState('');
  const [resaleBusyId, setResaleBusyId] = useState(null);
  const [applyingId, setApplyingId] = useState(null);
  const [applyError, setApplyError] = useState('');
  const [showListingModal, setShowListingModal] = useState(false);
  const [hiddenIds, setHiddenIds] = useState(loadHidden);
  const navigate = useNavigate();
  const { mongoUser } = useCustomUser();

  const isHidden = (type, id) => hiddenIds.has(hideKey(type, id));
  const hideListing = (type, id) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.add(hideKey(type, id));
      saveHidden(next);
      return next;
    });
  };
  const restoreHidden = () => {
    setHiddenIds(() => { saveHidden(new Set()); return new Set(); });
  };

  const visibleProducts = products.filter((p) => !isHidden('product', p._id));
  const visibleResale = resaleListings.filter((l) => !isHidden('resale', l._id));

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const response = await getSellerProducts();
        if (response.success) setProducts(response.data);
      } catch (error) {
        console.error('Failed to fetch products:', error);
      } finally {
        setIsLoadingProducts(false);
      }
    };
    fetchProducts();
  }, []);

  // Load brands when tab is switched to 'brands'
  useEffect(() => {
    if (activeTab !== 'brands' || brands.length > 0) return;
    const fetchBrands = async () => {
      setIsLoadingBrands(true);
      try {
        const res = await getSellerEnrollments();
        if (res.success) setBrands(res.data);
      } catch (err) {
        console.error('Failed to fetch brands:', err);
      } finally {
        setIsLoadingBrands(false);
      }
    };
    fetchBrands();
  }, [activeTab]);

  // Load offers when tab is switched to 'offers'
  useEffect(() => {
    if (activeTab !== 'offers' || offers.length > 0) return;
    const fetchOffers = async () => {
      setIsLoadingOffers(true);
      try {
        const res = await getMyOffers();
        if (res.success) setOffers(res.data);
      } catch (err) {
        console.error('Failed to fetch offers:', err);
      } finally {
        setIsLoadingOffers(false);
      }
    };
    fetchOffers();
  }, [activeTab]);

  // Load resale listings when tab is switched to 'resale'
  useEffect(() => {
    if (activeTab !== 'resale') return;
    const fetchResale = async () => {
      setIsLoadingResale(true);
      try {
        const res = await getMyResaleListings();
        if (res.success) setResaleListings(res.data);
      } catch (err) {
        console.error('Failed to fetch resale listings:', err);
      } finally {
        setIsLoadingResale(false);
      }
    };
    fetchResale();
  }, [activeTab]);

  const handlePublishResale = async (listingId) => {
    setResaleBusyId(listingId);
    try {
      const res = await publishResaleListing(listingId);
      if (res.success) {
        setResaleListings((prev) => prev.map((l) => (l._id === listingId ? res.data : l)));
      }
    } catch (err) {
      console.error('Failed to publish listing:', err);
    } finally {
      setResaleBusyId(null);
    }
  };

  const handleUnlistResale = async (listingId) => {
    setResaleBusyId(listingId);
    try {
      const res = await unlistResaleListing(listingId);
      if (res.success) {
        setResaleListings((prev) => prev.map((l) => (l._id === listingId ? res.data : l)));
      }
    } catch (err) {
      console.error('Failed to unlist listing:', err);
    } finally {
      setResaleBusyId(null);
    }
  };

  const handleSavePrice = async (listingId) => {
    const num = Number(priceDraft);
    if (!Number.isFinite(num) || num < 0) return;
    setResaleBusyId(listingId);
    try {
      const res = await updateResalePrice(listingId, num);
      if (res.success) {
        setResaleListings((prev) => prev.map((l) => (l._id === listingId ? res.data : l)));
        setEditingPriceId(null);
        setPriceDraft('');
      }
    } catch (err) {
      console.error('Failed to update price:', err);
    } finally {
      setResaleBusyId(null);
    }
  };

  const handleRequestEnrollment = async (brandId) => {
    setApplyingId(brandId);
    setApplyError('');
    try {
      await requestEnrollment(brandId);
      setBrands((prev) =>
        prev.map((b) =>
          b._id === brandId ? { ...b, enrollmentStatus: 'pending' } : b
        )
      );
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to apply';
      setApplyError(msg);
    } finally {
      setApplyingId(null);
    }
  };

  const handleToggleOffer = async (offer) => {
    const newStatus = offer.status === 'active' ? 'inactive' : 'active';
    try {
      const res = await updateOffer(offer._id, { status: newStatus });
      if (res.success) {
        setOffers((prev) =>
          prev.map((o) =>
            o._id === offer._id ? { ...o, status: newStatus, isBuyBoxWinner: res.data.isBuyBoxWinner } : o
          )
        );
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteOffer = async (offerId) => {
    if (!confirm('Remove this offer?')) return;
    try {
      await deleteOffer(offerId);
      setOffers((prev) => prev.filter((o) => o._id !== offerId));
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteProduct = async (productId) => {
    if (!confirm('Are you sure you want to permanently delete this listing?')) return;
    try {
      const res = await deleteProduct(productId);
      if (res.success) {
        setProducts((prev) => prev.filter((p) => p._id !== productId));
      }
    } catch (err) {
      console.error('Failed to delete product:', err);
    }
  };

  const approvedBrandsCount = brands.filter((b) => b.enrollmentStatus === 'approved').length;
  const pendingBrandsCount = brands.filter((b) => b.enrollmentStatus === 'pending').length;
  const activeOffersCount = offers.filter((o) => o.status === 'active').length;
  const buyBoxCount = offers.filter((o) => o.isBuyBoxWinner).length;

  return (
    <div className="min-h-screen bg-[#EAEDED] p-6 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* New Listing Choice Modal */}
        <AnimatePresence>
          {showListingModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="w-full max-w-lg bg-white border border-gray-200 rounded-2xl shadow-xl p-6"
              >
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">Create New Listing</h2>
                    <p className="text-sm text-gray-500 mt-0.5">Choose your listing type</p>
                  </div>
                  <button
                    onClick={() => setShowListingModal(false)}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-3">
                  {/* Catalog path */}
                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={() => { setShowListingModal(false); navigate('/seller/new-offer'); }}
                    className="w-full text-left bg-amber-50 border border-amber-200 hover:border-[#FF9900] rounded-2xl p-5 transition-all group"
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center flex-shrink-0">
                        <Zap className="w-6 h-6 text-[#FF9900]" />
                      </div>
                      <div className="flex-1">
                        <p className="font-bold text-gray-900 group-hover:text-[#C7511F] transition-colors flex items-center gap-2">
                          List on an Existing Brand Product
                          <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-normal">
                            Recommended
                          </span>
                        </p>
                        <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                          Compete for the Buy Box on a brand's official catalog entry.
                          Product title, images, and description are inherited from the brand — fully authorized.
                        </p>
                      </div>
                      <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-[#FF9900] transition-colors flex-shrink-0 mt-1" />
                    </div>
                  </motion.button>

                  {/* Standalone path */}
                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={() => { setShowListingModal(false); navigate('/seller/new-product'); }}
                    className="w-full text-left bg-white border border-gray-200 hover:border-gray-400 rounded-2xl p-5 transition-all group"
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center flex-shrink-0">
                        <Package className="w-6 h-6 text-gray-500" />
                      </div>
                      <div className="flex-1">
                        <p className="font-bold text-gray-900 group-hover:text-gray-700 transition-colors">
                          Create an Independent Listing
                        </p>
                        <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                          List a product with your own title, images, and description.
                          If you claim a registered brand name, your listing will be automatically
                          cross-referenced against that brand's official catalog.
                        </p>
                      </div>
                      <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-gray-600 transition-colors flex-shrink-0 mt-1" />
                    </div>
                  </motion.button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Header Section */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white border border-gray-200 p-6 rounded-2xl shadow-sm"
        >
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
              Seller Dashboard
            </h1>
            <p className="text-gray-500 mt-1 text-sm">Manage your listings and brand authorizations.</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/reseller/dashboard')}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-full font-medium transition-colors shadow-sm"
            >
              <Recycle className="w-5 h-5" />
              Reseller Dashboard
            </button>
            <button
              onClick={() => setShowListingModal(true)}
              className="flex items-center gap-2 bg-[#FF9900] hover:bg-[#FFB347] text-black px-5 py-2.5 rounded-full font-medium transition-colors shadow-sm"
            >
              <PlusCircle className="w-5 h-5" />
              New Listing
            </button>
          </div>
        </motion.div>

        {/* Suspension Notice */}
        {mongoUser?.suspended && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-700"
          >
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm">Account Suspended</p>
              <p className="text-xs text-amber-600 mt-0.5">
                Your seller account has been temporarily suspended. You cannot create new listings until this is resolved. Please contact support for more information.
              </p>
            </div>
          </motion.div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Total Listings', value: products.length, icon: Package, color: 'text-blue-600', bg: 'bg-blue-50' },
            { label: 'Active Offers', value: offers.length > 0 ? activeOffersCount : '—', icon: ShoppingBag, color: 'text-[#FF9900]', bg: 'bg-amber-50' },
            { label: 'Buy Box Wins', value: buyBoxCount || '—', icon: Zap, color: 'text-emerald-600', bg: 'bg-emerald-50' },
            { label: 'Flagged Issues', value: products.filter((p) => p.status === 'flagged').length, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50' },
          ].map((stat, idx) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className="bg-white border border-gray-200 p-6 rounded-2xl shadow-sm flex items-center justify-between"
            >
              <div>
                <p className="text-sm text-gray-500 font-medium">{stat.label}</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{stat.value}</p>
              </div>
              <div className={`p-3 rounded-full ${stat.bg} ${stat.color}`}>
                <stat.icon className="w-6 h-6" />
              </div>
            </motion.div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-white shadow-sm text-gray-900'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              <span>{tab.label}</span>
              {tab.id === 'brands' && pendingBrandsCount > 0 && (
                <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                  {pendingBrandsCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <AnimatePresence mode="wait">

          {/* Listings Tab */}
          {activeTab === 'listings' && (
            <motion.div
              key="listings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden"
            >
              <div className="p-6 border-b border-gray-200 flex justify-between items-center">
                <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <Activity className="w-5 h-5 text-gray-400" />
                  Recent Listings
                </h2>
              </div>

              <div className="overflow-x-auto">
                {isLoadingProducts ? (
                  <div className="p-8 text-center text-gray-500">Loading products...</div>
                ) : visibleProducts.length === 0 ? (
                  <div className="p-12 text-center flex flex-col items-center">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                      <Package className="w-8 h-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-1">No products yet</h3>
                    <p className="text-gray-500 mb-6">Start by creating your first listing.</p>
                    <button
                      onClick={() => navigate('/seller/new-product')}
                      className="text-sm bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-full transition-colors"
                    >
                      Create Listing
                    </button>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-50 text-sm text-gray-500 border-b border-gray-200">
                        <th className="p-4 font-medium">Product</th>
                        <th className="p-4 font-medium">Category</th>
                        <th className="p-4 font-medium">Price</th>
                        <th className="p-4 font-medium">Status</th>
                        <th className="p-4 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleProducts.map((product) => (
                        <motion.tr
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          key={product._id}
                          className="border-b border-gray-200 hover:bg-gray-50 transition-colors"
                        >
                          <td className="p-4">
                            <p className="font-medium text-gray-900">{product.title}</p>
                            {product.brandName && (
                              <p className="text-xs text-gray-500 mt-0.5">Brand: {product.brandName}</p>
                            )}
                          </td>
                          <td className="p-4 text-xs text-gray-500">{product.category || '—'}</td>
                          <td className="p-4 text-gray-900 font-medium">${product.price.toFixed(2)}</td>
                          <td className="p-4">
                            <StatusBadge status={product.status} />
                            {product.status === 'flagged' && (
                              <p className="text-[10px] text-red-600 mt-1.5 max-w-[150px] leading-tight font-medium">
                                Flagged for manual review.
                              </p>
                            )}
                            {product.status === 'suspended' && (
                              <p className="text-[10px] text-red-600 mt-1.5 max-w-[150px] leading-tight font-medium">
                                Suspended due to policy violations.
                              </p>
                            )}
                          </td>
                          <td className="p-4 text-right">
                            <div className="flex justify-end items-center gap-3">
                              <button
                                onClick={() => navigate(`/seller/edit-product/${product._id}`)}
                                className="text-sm text-[#007185] hover:text-[#C7511F] transition-colors"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => hideListing('product', product._id)}
                                className="text-gray-400 hover:text-gray-700 transition-colors"
                                title="Hide from view"
                              >
                                <EyeOff className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteProduct(product._id)}
                                className="text-gray-400 hover:text-red-600 transition-colors"
                                title="Delete listing"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </motion.div>
          )}

          {/* Offers Tab */}
          {activeTab === 'offers' && (
            <motion.div
              key="offers"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
                <Zap className="w-5 h-5 text-[#FF9900] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-700">Catalog Offers</p>
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                    These are your offers on brand catalog entries. The Buy Box is awarded to the lowest-price active offer.
                    Toggle offers inactive without deleting them, or remove permanently.
                  </p>
                </div>
              </div>

              {isLoadingOffers ? (
                <div className="bg-white border border-gray-200 rounded-2xl p-12 flex items-center justify-center shadow-sm">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : offers.length === 0 ? (
                <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center shadow-sm">
                  <ShoppingBag className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-bold text-gray-900 mb-2">No Catalog Offers Yet</h3>
                  <p className="text-gray-500 text-sm mb-6">
                    Create offers on brand catalog entries to compete for the Buy Box.
                  </p>
                  <button
                    onClick={() => { setShowListingModal(true); }}
                    className="inline-flex items-center gap-2 bg-[#FF9900] hover:bg-[#FFB347] text-black text-sm font-bold px-5 py-2.5 rounded-xl transition-colors"
                  >
                    <Zap className="w-4 h-4" /> Create First Offer
                  </button>
                </div>
              ) : (
                <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                  <div className="p-5 border-b border-gray-200">
                    <h2 className="font-bold text-lg text-gray-900">My Catalog Offers ({offers.length})</h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {activeOffersCount} active · {buyBoxCount} Buy Box win{buyBoxCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-gray-50 text-xs text-gray-500 border-b border-gray-200">
                        <tr>
                          <th className="px-4 py-3 font-medium">Product</th>
                          <th className="px-4 py-3 font-medium">Your Price</th>
                          <th className="px-4 py-3 font-medium">Buy Box</th>
                          <th className="px-4 py-3 font-medium">Status</th>
                          <th className="px-4 py-3 font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {offers.map((offer) => (
                          <motion.tr
                            key={offer._id}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className={`border-b border-gray-200 transition-colors ${
                              offer.isBuyBoxWinner ? 'bg-amber-50' : 'hover:bg-gray-50'
                            }`}
                          >
                            <td className="px-4 py-3">
                              <Link
                                to={`/p/${offer.catalogEntryId?._id}`}
                                className="font-medium text-sm text-[#007185] hover:text-[#C7511F] transition-colors flex items-center gap-1 group"
                              >
                                {offer.catalogEntryId?.title || 'Unknown product'}
                                <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </Link>
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-sm font-bold text-gray-900">${offer.price.toFixed(2)}</span>
                            </td>
                            <td className="px-4 py-3">
                              {offer.isBuyBoxWinner ? (
                                <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-[#FF9900] border border-amber-200 px-2 py-0.5 rounded-full font-bold">
                                  <Zap className="w-3 h-3" /> Winner
                                </span>
                              ) : (
                                <span className="text-xs text-gray-400">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
                                offer.status === 'active'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : offer.status === 'flagged'
                                  ? 'bg-red-50 text-red-600 border-red-200'
                                  : 'bg-gray-100 text-gray-500 border-gray-200'
                              }`}>
                                {offer.status}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleToggleOffer(offer)}
                                  title={offer.status === 'active' ? 'Deactivate' : 'Activate'}
                                  className="text-gray-400 hover:text-gray-700 transition-colors"
                                >
                                  {offer.status === 'active'
                                    ? <ToggleRight className="w-5 h-5 text-emerald-600" />
                                    : <ToggleLeft className="w-5 h-5" />}
                                </button>
                                <button
                                  onClick={() => handleDeleteOffer(offer._id)}
                                  className="text-gray-400 hover:text-red-600 transition-colors"
                                  title="Remove offer"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </motion.tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* Brands Tab */}

          {activeTab === 'resale' && (
            <motion.div
              key="resale"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-start gap-3">
                <Recycle className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-emerald-700">Second-Life Resale Drafts</p>
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                    When a customer's return is graded as resellable, we push you a ready-to-go draft —
                    photos, condition story, and a suggested price are filled in for you.
                    Just <span className="font-semibold text-gray-700">adjust the price if you like</span> and
                    <span className="font-semibold text-gray-700"> publish</span> — we handle all the routing
                    (peer handoff, warehouse, delivery) for you.
                  </p>
                </div>
              </div>

              {isLoadingResale ? (
                <div className="bg-white border border-gray-200 rounded-2xl p-12 flex items-center justify-center shadow-sm">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : visibleResale.length === 0 ? (
                <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center shadow-sm">
                  <Recycle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-bold text-gray-900 mb-2">No Resale Drafts Yet</h3>
                  <p className="text-gray-500 text-sm">Graded returns routed for resale will show up here automatically.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {visibleResale.map((listing) => {
                    const statusStyle = {
                      DRAFT: 'bg-amber-100 text-amber-700',
                      PUBLISHED: 'bg-emerald-100 text-emerald-700',
                      UNLISTED: 'bg-gray-100 text-gray-500',
                      SOLD: 'bg-blue-100 text-blue-700',
                    }[listing.status] || 'bg-gray-100 text-gray-500';
                    const statusLabel = { DRAFT: 'Draft', PUBLISHED: 'Live', UNLISTED: 'Unlisted', SOLD: 'Sold' }[listing.status] || listing.status;
                    const isEditing = editingPriceId === listing._id;
                    const busy = resaleBusyId === listing._id;
                    const isDraft = listing.status === 'DRAFT';
                    const plan = resaleRoutePlan(listing);
                    const gradeColor = { A: 'bg-emerald-500', B: 'bg-blue-500', C: 'bg-orange-500', D: 'bg-red-500' }[listing.grade] || 'bg-gray-400';

                    return (
                      <motion.div
                        key={listing._id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden"
                      >
                        <div className="p-5 flex flex-col sm:flex-row gap-4">
                          {/* Thumbnail */}
                          <div className="w-20 h-20 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center flex-shrink-0 overflow-hidden">
                            {listing.images?.[0] ? (
                              <img src={listing.images[0]} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <Package className="w-7 h-7 text-gray-300" />
                            )}
                          </div>

                          {/* Main */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <Link
                                  to={`/resale/${listing._id}`}
                                  className="font-bold text-sm text-gray-900 hover:text-emerald-600 transition-colors flex items-center gap-1 group"
                                >
                                  <span className="truncate">{listing.title}</span>
                                  <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                                </Link>
                                <p className="text-xs text-gray-500 mt-0.5">{listing.category} · {listing.conditionLane}</p>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${statusStyle}`}>
                                  {statusLabel}
                                </span>
                                <button
                                  onClick={() => hideListing('resale', listing._id)}
                                  className="text-gray-300 hover:text-gray-600 transition-colors"
                                  title="Hide from view"
                                >
                                  <EyeOff className="w-4 h-4" />
                                </button>
                              </div>
                            </div>

                            {/* AI grade + routing plan (read-only decision-tree output) */}
                            <div className="flex flex-wrap items-center gap-2 mt-2.5">
                              <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-gray-50 border border-gray-200 rounded-full pl-1 pr-2.5 py-0.5">
                                <span className={`w-5 h-5 rounded-full ${gradeColor} text-white flex items-center justify-center text-[10px] font-black`}>
                                  {listing.grade}
                                </span>
                                <span className="text-gray-600">AI grade · {listing.qualityScore}/100</span>
                              </span>
                              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
                                <plan.Icon className="w-3.5 h-3.5" />
                                {plan.label}
                              </span>
                              <span className="text-[11px] text-gray-400">{plan.sub}</span>
                            </div>

                            {/* Pricing + actions */}
                            <div className="flex flex-wrap items-end justify-between gap-3 mt-3 pt-3 border-t border-gray-100">
                              <div className="flex items-end gap-4">
                                <div>
                                  <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Suggested</p>
                                  <p className="text-sm text-gray-400 line-through">₹{Number(listing.suggestedPrice).toLocaleString()}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Your price</p>
                                  {isEditing ? (
                                    <div className="flex items-center gap-1 mt-0.5">
                                      <span className="text-gray-500 text-sm">₹</span>
                                      <input
                                        type="number"
                                        value={priceDraft}
                                        onChange={(e) => setPriceDraft(e.target.value)}
                                        className="w-24 bg-white border border-gray-300 rounded-lg px-2 py-1 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                        autoFocus
                                      />
                                      <button onClick={() => handleSavePrice(listing._id)} disabled={busy} className="text-emerald-600 hover:text-emerald-700 p-1" title="Save">
                                        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                      </button>
                                      <button onClick={() => { setEditingPriceId(null); setPriceDraft(''); }} className="text-gray-400 hover:text-gray-600 p-1" title="Cancel">
                                        <X className="w-4 h-4" />
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => { setEditingPriceId(listing._id); setPriceDraft(String(listing.price)); }}
                                      disabled={listing.status === 'SOLD'}
                                      className="flex items-center gap-1.5 text-lg font-black text-gray-900 hover:text-emerald-600 transition-colors disabled:opacity-50"
                                      title="Adjust price"
                                    >
                                      ₹{Number(listing.price).toLocaleString()}
                                      <Pencil className="w-3.5 h-3.5 text-gray-400" />
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* The seller can ONLY adjust price or publish a draft — routing is on us. */}
                              <div className="flex items-center gap-2">
                                {isDraft ? (
                                  <button
                                    onClick={() => handlePublishResale(listing._id)}
                                    disabled={busy}
                                    className="inline-flex items-center gap-1.5 text-sm bg-[#FF9900] hover:bg-[#FFB347] text-black px-4 py-2 rounded-xl font-bold transition-colors disabled:opacity-50 shadow-sm"
                                  >
                                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                    {busy ? 'Publishing…' : 'Publish & let us route it'}
                                  </button>
                                ) : listing.status === 'PUBLISHED' ? (
                                  <div className="flex items-center gap-2">
                                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 rounded-lg">
                                      <CheckCircle className="w-3.5 h-3.5" /> Routing handled by us
                                    </span>
                                    <button
                                      onClick={() => handleUnlistResale(listing._id)}
                                      disabled={busy}
                                      className="text-xs text-gray-400 hover:text-red-600 px-2 py-1 transition-colors disabled:opacity-50"
                                    >
                                      {busy ? '…' : 'Unlist'}
                                    </button>
                                  </div>
                                ) : listing.status === 'UNLISTED' ? (
                                  <button
                                    onClick={() => handlePublishResale(listing._id)}
                                    disabled={busy}
                                    className="inline-flex items-center gap-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl font-bold transition-colors disabled:opacity-50"
                                  >
                                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                    Re-publish
                                  </button>
                                ) : (
                                  <span className="text-xs text-gray-400">Sold</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'brands' && (
            <motion.div
              key="brands"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              {/* Info banner */}
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
                <Shield className="w-5 h-5 text-[#FF9900] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-700">Brand Authorization</p>
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                    Request enrollment from a registered brand to become an authorized reseller.
                    Brand owners review and approve requests manually.
                  </p>
                </div>
              </div>

              {applyError && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm"
                >
                  {applyError}
                </motion.div>
              )}

              {isLoadingBrands ? (
                <div className="bg-white border border-gray-200 rounded-2xl p-12 flex items-center justify-center shadow-sm">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : brands.length === 0 ? (
                <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center shadow-sm">
                  <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-bold text-gray-900 mb-2">No Brands Registered</h3>
                  <p className="text-gray-500 text-sm">No brands have been registered on the platform yet.</p>
                </div>
              ) : (
                <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                  <div className="p-5 border-b border-gray-200">
                    <h2 className="font-bold text-lg text-gray-900">Registered Brands ({brands.length})</h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {approvedBrandsCount} authorized · {pendingBrandsCount} pending
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-gray-50 text-xs text-gray-500 border-b border-gray-200">
                        <tr>
                          <th className="px-4 py-3 font-medium">Brand</th>
                          <th className="px-4 py-3 font-medium">Category</th>
                          <th className="px-4 py-3 font-medium">Protected Keywords</th>
                          <th className="px-4 py-3 font-medium">Authorization Status</th>
                          <th className="px-4 py-3 font-medium">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {brands.map((brand) => (
                          <motion.tr
                            key={brand._id}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="border-b border-gray-200 hover:bg-gray-50 transition-colors"
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                {brand.logoUrl ? (
                                  <img
                                    src={brand.logoUrl}
                                    alt={brand.name}
                                    className="w-8 h-8 rounded object-contain bg-gray-50 border border-gray-200 p-0.5"
                                  />
                                ) : (
                                  <div className="w-8 h-8 rounded bg-[#FF9900] flex items-center justify-center text-black font-bold text-xs flex-shrink-0">
                                    {brand.name?.[0]?.toUpperCase()}
                                  </div>
                                )}
                                <div>
                                  <p className="font-medium text-sm text-gray-900">{brand.name}</p>
                                  {brand.isVerified && (
                                    <p className="text-[10px] text-[#007600]">✓ Verified</p>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-500">
                              {brand.category || '—'}
                            </td>
                            <td className="px-4 py-3">
                              {brand.protectedKeywords?.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {brand.protectedKeywords.slice(0, 3).map((kw) => (
                                    <span
                                      key={kw}
                                      className="text-[10px] bg-gray-100 text-gray-600 border border-gray-200 px-1.5 py-0.5 rounded"
                                    >
                                      {kw}
                                    </span>
                                  ))}
                                  {brand.protectedKeywords.length > 3 && (
                                    <span className="text-[10px] text-gray-400">
                                      +{brand.protectedKeywords.length - 3}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-gray-400">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <EnrollmentBadge status={brand.enrollmentStatus} />
                            </td>
                            <td className="px-4 py-3">
                              {!brand.enrollmentStatus ? (
                                <button
                                  disabled={applyingId === brand._id}
                                  onClick={() => handleRequestEnrollment(brand._id)}
                                  className="flex items-center gap-1.5 text-xs bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                                >
                                  {applyingId === brand._id ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <ChevronRight className="w-3 h-3" />
                                  )}
                                  Request Auth
                                </button>
                              ) : brand.enrollmentStatus === 'rejected' ? (
                                <button
                                  disabled={applyingId === brand._id}
                                  onClick={() => handleRequestEnrollment(brand._id)}
                                  className="flex items-center gap-1.5 text-xs bg-white border border-gray-300 hover:bg-gray-50 text-gray-600 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                                >
                                  Re-apply
                                </button>
                              ) : (
                                <span className="text-xs text-gray-400">—</span>
                              )}
                            </td>
                          </motion.tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* Return Insights Tab */}
          {activeTab === 'insights' && (
            <motion.div
              key="insights"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <ReturnInsightsPanel />
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* Restore all locally-hidden listings (testing clutter control). */}
      <AnimatePresence>
        {hiddenIds.size > 0 && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={restoreHidden}
            title={`Restore ${hiddenIds.size} hidden listing${hiddenIds.size > 1 ? 's' : ''}`}
            className="fixed bottom-4 left-4 z-[9998] w-12 h-12 rounded-full bg-gray-500 hover:bg-gray-600 text-white shadow-2xl flex items-center justify-center transition-colors"
          >
            <Eye className="w-5 h-5" />
            <span className="absolute -top-1 -right-1 bg-[#FF9900] text-black text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
              {hiddenIds.size}
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SellerDashboard;
