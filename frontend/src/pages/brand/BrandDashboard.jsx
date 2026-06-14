import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
  getMyBrand, createBrand, getEnrolledSellers,
  getPendingEnrollments, updateEnrollmentStatus
} from '../../services/brand.service';
import { getMyCatalogEntries, createCatalogEntry, updateCatalogEntry, deleteCatalogEntry } from '../../services/catalogEntry.service';
import StarRating from '../../components/shared/StarRating';
import {
  Shield, Plus, Users, Package, Clock, CheckCircle, XCircle,
  Loader2, Store, AlertTriangle, BookOpen, X, Edit2, Trash2,
  Tag, ChevronDown, ChevronUp, Image as ImageIcon,
} from 'lucide-react';

// ─── Catalog Entry Modal ──────────────────────────────────────────────────────
function CatalogEntryModal({ entry, onClose, onSave }) {
  const isEditing = !!entry;
  const [form, setForm] = useState(
    entry
      ? {
          title: entry.title,
          category: entry.category,
          description: entry.description,
          bulletPoints: entry.bulletPoints.join('\n'),
          officialImages: entry.officialImages.join('\n'),
          tags: entry.tags?.join(', ') || '',
        }
      : { title: '', category: '', description: '', bulletPoints: '', officialImages: '', tags: '' }
  );
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    setError('');
    try {
      const payload = {
        title: form.title.trim(),
        category: form.category.trim(),
        description: form.description.trim(),
        bulletPoints: form.bulletPoints.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 5),
        officialImages: form.officialImages.split('\n').map((s) => s.trim()).filter(Boolean),
        tags: form.tags.split(',').map((s) => s.trim()).filter(Boolean),
      };
      let result;
      if (isEditing) {
        result = await updateCatalogEntry(entry._id, payload);
      } else {
        result = await createCatalogEntry(payload);
      }
      onSave(result.data, isEditing);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save catalog entry');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="w-full max-w-2xl bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between p-6 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#FF9900]/10 border border-[#FF9900]/20 flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-[#FF9900]" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{isEditing ? 'Edit Catalog Entry' : 'Add Product to Catalog'}</h2>
              <p className="text-xs text-zinc-500">This becomes the brand's official product record (ASIN equivalent)</p>
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Product Title *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Nike Air Max 97 — White — Men's Size 10"
              required
              className="w-full bg-black/50 border border-zinc-800 rounded-xl px-3 py-2.5 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-[#FF9900]/40 focus:border-[#FF9900] transition-all text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Category *</label>
            <input
              type="text"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              placeholder="e.g. Footwear, Electronics, Clothing"
              required
              className="w-full bg-black/50 border border-zinc-800 rounded-xl px-3 py-2.5 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-[#FF9900]/40 focus:border-[#FF9900] transition-all text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Official Description *</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Official product description."
              required
              rows={3}
              className="w-full bg-black/50 border border-zinc-800 rounded-xl px-3 py-2.5 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-[#FF9900]/40 focus:border-[#FF9900] transition-all text-sm resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Bullet Points <span className="text-zinc-600 font-normal">(one per line, max 5 — like Amazon A+ content)</span>
            </label>
            <textarea
              value={form.bulletPoints}
              onChange={(e) => setForm((f) => ({ ...f, bulletPoints: e.target.value }))}
              placeholder={"Lightweight mesh upper for breathability\nVisible Air cushioning for comfort\nRubber outsole for durable traction"}
              rows={4}
              className="w-full bg-black/50 border border-zinc-800 rounded-xl px-3 py-2.5 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-[#FF9900]/40 focus:border-[#FF9900] transition-all text-sm resize-none font-mono"
            />
            <p className="text-xs text-zinc-600 mt-1">{form.bulletPoints.split('\n').filter(Boolean).length}/5 bullet points</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5 flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5 text-[#FF9900]" />
              Official Image URLs <span className="text-zinc-600 font-normal">(one per line — hero image first)</span>
            </label>
            <textarea
              value={form.officialImages}
              onChange={(e) => setForm((f) => ({ ...f, officialImages: e.target.value }))}
              placeholder={"https://example.com/hero-image.jpg\nhttps://example.com/side-view.jpg\nhttps://example.com/detail-shot.jpg"}
              rows={3}
              className="w-full bg-black/50 border border-zinc-800 rounded-xl px-3 py-2.5 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-[#FF9900]/40 focus:border-[#FF9900] transition-all text-sm resize-none font-mono"
            />
            <p className="text-xs text-zinc-600 mt-1">These are the official product images for this catalog entry.</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Tags <span className="text-zinc-600 font-normal">(comma-separated)</span></label>
            <input
              type="text"
              value={form.tags}
              onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
              placeholder="running, white, men, casual"
              className="w-full bg-black/50 border border-zinc-800 rounded-xl px-3 py-2.5 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-[#FF9900]/40 focus:border-[#FF9900] transition-all text-sm"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 transition-all text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 py-2.5 rounded-xl bg-[#FF9900] text-black font-bold hover:bg-[#FFB347] transition-colors disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {isSaving ? 'Saving...' : isEditing ? 'Update Entry' : 'Add to Catalog'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ─── Catalog Entry Row ────────────────────────────────────────────────────────
function CatalogEntryRow({ entry, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Remove "${entry.title}" from catalog?`)) return;
    setIsDeleting(true);
    try {
      await deleteCatalogEntry(entry._id);
      onDelete(entry._id);
    } catch (err) {
      console.error(err);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className={`border-b border-zinc-800/50 transition-colors ${!entry.isActive ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-4 px-5 py-4 hover:bg-zinc-800/20">
        {/* Thumbnail */}
        <div className="w-14 h-14 rounded-xl bg-zinc-800 flex-shrink-0 overflow-hidden">
          {entry.officialImages?.[0] ? (
            <img src={entry.officialImages[0]} alt={entry.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-600">
              <ImageIcon className="w-5 h-5" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="font-semibold text-sm text-white truncate">{entry.title}</p>
            {!entry.isActive && (
              <span className="text-[10px] bg-zinc-700 text-zinc-400 px-1.5 py-0.5 rounded-full flex-shrink-0">Removed</span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span>{entry.category}</span>
            <span className="text-[#FF9900]">{entry.activeOfferCount ?? 0} active offers</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-1.5 text-zinc-500 hover:text-white transition-colors"
            title="Expand details"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button
            onClick={() => onEdit(entry)}
            className="p-1.5 text-zinc-500 hover:text-[#FF9900] transition-colors"
            title="Edit entry"
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="p-1.5 text-zinc-500 hover:text-red-400 transition-colors disabled:opacity-50"
            title="Remove entry"
          >
            {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4 grid grid-cols-2 gap-4">
              {entry.bulletPoints?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-zinc-400 mb-2">Official Bullet Points</p>
                  <ul className="space-y-1">
                    {entry.bulletPoints.map((bp, i) => (
                      <li key={i} className="text-xs text-zinc-300 flex items-start gap-1.5">
                        <span className="text-[#FF9900] mt-0.5">•</span> {bp}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {entry.officialImages?.length > 1 && (
                <div>
                  <p className="text-xs font-semibold text-zinc-400 mb-2">Image Gallery ({entry.officialImages.length})</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {entry.officialImages.slice(0, 4).map((img, i) => (
                      <img key={i} src={img} alt="" className="w-12 h-12 rounded-lg object-cover bg-zinc-800" />
                    ))}
                  </div>
                </div>
              )}
              <div>
                <p className="text-xs text-zinc-500 leading-relaxed line-clamp-2">{entry.description}</p>
              </div>
              {entry.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {entry.tags.map((tag) => (
                    <span key={tag} className="text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded">{tag}</span>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function BrandDashboard() {
  const [brand, setBrand] = useState(null);
  const [sellers, setSellers] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [catalogEntries, setCatalogEntries] = useState([]);
  const [activeTab, setActiveTab] = useState('sellers');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [processingId, setProcessingId] = useState(null);
  const [catalogModal, setCatalogModal] = useState(null); // null | 'new' | <entry object>

  // Brand registration form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', description: '', category: '', protectedKeywords: '' });
  const [createError, setCreateError] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        const brandRes = await getMyBrand();
        if (brandRes.success) {
          setBrand(brandRes.data);
          await loadBrandData(brandRes.data._id);
        }
      } catch (err) {
        if (err.response?.status === 404) {
          setShowCreateForm(true);
        }
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, []);

  // Load catalog entries when tab is switched to 'catalog'
  useEffect(() => {
    if (activeTab !== 'catalog' || !brand || catalogEntries.length > 0) return;
    loadCatalogEntries();
  }, [activeTab, brand]);

  const loadCatalogEntries = async () => {
    setIsLoadingCatalog(true);
    try {
      const res = await getMyCatalogEntries();
      if (res.success) setCatalogEntries(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingCatalog(false);
    }
  };

  const loadBrandData = async (brandId) => {
    const [sellersRes, enrollmentsRes] = await Promise.all([
      getEnrolledSellers(brandId),
      getPendingEnrollments(brandId),
    ]);
    if (sellersRes.success) setSellers(sellersRes.data);
    if (enrollmentsRes.success) setEnrollments(enrollmentsRes.data);
  };

  const handleCreateBrand = async (e) => {
    e.preventDefault();
    setIsCreating(true);
    setCreateError('');
    try {
      const keywords = createForm.protectedKeywords.split(',').map((k) => k.trim()).filter(Boolean);
      const res = await createBrand({ ...createForm, protectedKeywords: keywords });
      if (res.success) {
        setBrand(res.data);
        setShowCreateForm(false);
        await loadBrandData(res.data._id);
      }
    } catch (err) {
      setCreateError(err.response?.data?.message || 'Failed to create brand');
    } finally {
      setIsCreating(false);
    }
  };

  const handleEnrollmentAction = async (enrollmentId, status) => {
    setProcessingId(enrollmentId);
    try {
      await updateEnrollmentStatus(brand._id, enrollmentId, status);
      setEnrollments((prev) => prev.filter((e) => e._id !== enrollmentId));
      if (status === 'approved') await loadBrandData(brand._id);
    } catch (err) {
      console.error(err);
    } finally {
      setProcessingId(null);
    }
  };

  const handleCatalogSave = (savedEntry, isEditing) => {
    if (isEditing) {
      setCatalogEntries((prev) => prev.map((e) => (e._id === savedEntry._id ? savedEntry : e)));
    } else {
      setCatalogEntries((prev) => [savedEntry, ...prev]);
    }
    setCatalogModal(null);
  };

  const handleCatalogDelete = (entryId) => {
    setCatalogEntries((prev) => prev.map((e) => (e._id === entryId ? { ...e, isActive: false } : e)));
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  // Brand registration form
  if (showCreateForm) {
    return (
      <div className="min-h-screen bg-black text-white p-8 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl"
        >
          <div className="flex items-center gap-3 mb-6">
            <Shield className="w-8 h-8 text-[#FF9900]" />
            <div>
              <h1 className="text-2xl font-bold">Register Your Brand</h1>
              <p className="text-sm text-zinc-400">Set up brand protection on the marketplace</p>
            </div>
          </div>

          {createError && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm">
              {createError}
            </div>
          )}

          <form onSubmit={handleCreateBrand} className="space-y-4">
            {[
              { key: 'name', label: 'Brand Name', placeholder: 'e.g. Nike, Apple, Samsung', required: true },
              { key: 'category', label: 'Primary Category', placeholder: 'e.g. Electronics, Clothing' },
              { key: 'description', label: 'Description', placeholder: 'Describe your brand...' },
              { key: 'protectedKeywords', label: 'Protected Keywords (comma-separated)', placeholder: 'e.g. Nike, Air Max, Just Do It' },
            ].map(({ key, label, placeholder, required }) => (
              <div key={key}>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">{label}{required && ' *'}</label>
                {key === 'description' ? (
                  <textarea
                    value={createForm[key]}
                    onChange={(e) => setCreateForm((f) => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder}
                    rows={3}
                    className="w-full bg-black/50 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-[#FF9900]/50 focus:border-[#FF9900] transition-all resize-none text-sm"
                  />
                ) : (
                  <input
                    type="text"
                    value={createForm[key]}
                    onChange={(e) => setCreateForm((f) => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder}
                    required={required}
                    className="w-full bg-black/50 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-[#FF9900]/50 focus:border-[#FF9900] transition-all text-sm"
                  />
                )}
              </div>
            ))}

            <button
              type="submit"
              disabled={isCreating}
              className="w-full bg-[#FF9900] text-black font-bold py-3 rounded-xl hover:bg-[#FFB347] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {isCreating ? 'Creating...' : 'Register Brand'}
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  const tabs = [
    { id: 'sellers', label: 'Enrolled Sellers', icon: Users, count: sellers.length },
    { id: 'requests', label: 'Enrollment Requests', icon: Clock, count: enrollments.length },
    { id: 'catalog', label: 'Product Catalog', icon: BookOpen, count: brand?.catalogEntryCount ?? catalogEntries.filter(e => e.isActive).length },
  ];

  return (
    <div className="min-h-screen bg-black text-white p-6 md:p-8 font-sans">
      {/* Catalog Entry Modal */}
      <AnimatePresence>
        {catalogModal !== null && (
          <CatalogEntryModal
            entry={catalogModal === 'new' ? null : catalogModal}
            onClose={() => setCatalogModal(null)}
            onSave={handleCatalogSave}
          />
        )}
      </AnimatePresence>

      <div className="max-w-6xl mx-auto space-y-6">

        {/* Brand Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 flex flex-col md:flex-row items-center md:items-start gap-5"
        >
          {brand?.logoUrl ? (
            <img src={brand.logoUrl} alt={brand.name} className="w-20 h-20 rounded-2xl object-contain bg-white p-2" />
          ) : (
            <div className="w-20 h-20 rounded-2xl bg-[#FF9900] flex items-center justify-center text-black font-black text-3xl flex-shrink-0">
              {brand?.name?.[0]?.toUpperCase() || 'B'}
            </div>
          )}
          <div className="text-center md:text-left flex-1">
            <div className="flex items-center gap-2 justify-center md:justify-start mb-1">
              <Shield className="w-5 h-5 text-[#FF9900]" />
              <h1 className="text-2xl font-black">{brand?.name}</h1>
              {brand?.isVerified && (
                <span className="text-xs bg-green-500/20 text-green-400 border border-green-500/30 px-2 py-0.5 rounded-full font-medium">Verified</span>
              )}
            </div>
            {brand?.description && <p className="text-sm text-zinc-400 max-w-xl">{brand.description}</p>}
            {brand?.category && <p className="text-xs text-zinc-500 mt-1">Category: {brand.category}</p>}
            {brand?.protectedKeywords?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2 justify-center md:justify-start">
                {brand.protectedKeywords.map((kw) => (
                  <span key={kw} className="text-xs bg-[#FF9900]/10 text-[#FF9900] border border-[#FF9900]/20 px-2 py-0.5 rounded-full">
                    {kw}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3 text-center flex-shrink-0">
            {[
              { label: 'Sellers', value: sellers.length },
              { label: 'Pending', value: enrollments.length },
              { label: 'Catalog', value: brand?.catalogEntryCount ?? 0 },
            ].map(({ label, value }) => (
              <div key={label} className="bg-zinc-800 rounded-xl p-3">
                <p className="text-xl font-bold text-white">{value}</p>
                <p className="text-xs text-zinc-400">{label}</p>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Tabs */}
        <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-zinc-700 text-white'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
              }`}
            >
              <tab.icon className="w-4 h-4 flex-shrink-0" />
              <span className="hidden sm:inline truncate">{tab.label}</span>
              {tab.count > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center flex-shrink-0 ${
                  activeTab === tab.id ? 'bg-[#FF9900] text-black' : 'bg-zinc-700 text-zinc-300'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* ── Enrolled Sellers ──────────────────────────────────────────── */}
          {activeTab === 'sellers' && (
            sellers.length === 0 ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-12 text-center">
                <Users className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
                <h3 className="text-lg font-bold mb-2">No Enrolled Sellers</h3>
                <p className="text-zinc-400 text-sm">Sellers can request enrollment in your brand. Their requests will appear here for approval.</p>
              </div>
            ) : (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                <div className="p-5 border-b border-zinc-800">
                  <h2 className="font-bold text-lg">Enrolled Sellers ({sellers.length})</h2>
                  <p className="text-xs text-zinc-500 mt-0.5">Only you can see this data</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-zinc-800/50 text-xs text-zinc-400 border-b border-zinc-800">
                      <tr>
                        <th className="px-4 py-3 font-medium">Seller</th>
                        <th className="px-4 py-3 font-medium">Rating</th>
                        <th className="px-4 py-3 font-medium">Reviews Received</th>
                        <th className="px-4 py-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sellers.map((seller) => (
                        <tr key={seller._id} className="border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors">
                          <td className="px-4 py-3">
                            <p className="font-medium text-sm">{seller.storeName || `${seller.firstName} ${seller.lastName}`.trim()}</p>
                            <p className="text-xs text-zinc-500">{seller.email}</p>
                          </td>
                          <td className="px-4 py-3">
                            <StarRating rating={seller.averageRating || 0} size="sm" />
                          </td>
                          <td className="px-4 py-3 text-sm text-zinc-300">{seller.totalReviewsReceived || 0}</td>
                          <td className="px-4 py-3">
                            <Link
                              to={`/seller/${seller._id}/store`}
                              className="text-xs text-[#007185] hover:text-[#FF9900] transition-colors flex items-center gap-1"
                            >
                              <Store className="w-3.5 h-3.5" /> View Store
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          )}


          {/* ── Enrollment Requests ───────────────────────────────────────── */}
          {activeTab === 'requests' && (
            enrollments.length === 0 ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-12 text-center">
                <Clock className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
                <h3 className="text-lg font-bold mb-2">No Pending Requests</h3>
                <p className="text-zinc-400 text-sm">Seller enrollment requests will appear here for your review.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {enrollments.map((enrollment) => {
                  const seller = enrollment.sellerId;
                  const sellerName = seller?.storeName || `${seller?.firstName} ${seller?.lastName}`.trim();
                  return (
                    <motion.div
                      key={enrollment._id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
                    >
                      <div>
                        <p className="font-bold">{sellerName}</p>
                        <p className="text-sm text-zinc-400">{seller?.email}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          disabled={processingId === enrollment._id}
                          onClick={() => handleEnrollmentAction(enrollment._id, 'approved')}
                          className="flex items-center gap-1.5 bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
                        >
                          {processingId === enrollment._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                          Approve
                        </button>
                        <button
                          disabled={processingId === enrollment._id}
                          onClick={() => handleEnrollmentAction(enrollment._id, 'rejected')}
                          className="flex items-center gap-1.5 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
                        >
                          <XCircle className="w-4 h-4" /> Reject
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )
          )}

          {/* ── Product Catalog ───────────────────────────────────────────── */}
          {activeTab === 'catalog' && (
            <div className="space-y-4">
              {/* Catalog header */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold">Official Product Catalog</h2>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Each entry is your brand's authoritative product record — the ground truth AI uses to detect counterfeits.
                  </p>
                </div>
                <button
                  onClick={() => setCatalogModal('new')}
                  className="flex items-center gap-2 bg-[#FF9900] text-black text-sm font-bold px-4 py-2.5 rounded-xl hover:bg-[#FFB347] transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add Product
                </button>
              </div>

              {/* Catalog entries list */}
              {isLoadingCatalog ? (
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-12 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
                </div>
              ) : catalogEntries.length === 0 ? (
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-12 text-center">
                  <BookOpen className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
                  <h3 className="text-lg font-bold mb-2">No Catalog Entries Yet</h3>
                  <p className="text-zinc-400 text-sm mb-6">
                    Add your official products. Each entry becomes an ASIN-equivalent that sellers can list offers on.
                  </p>
                  <button
                    onClick={() => setCatalogModal('new')}
                    className="inline-flex items-center gap-2 bg-[#FF9900] text-black text-sm font-bold px-5 py-2.5 rounded-xl hover:bg-[#FFB347] transition-colors"
                  >
                    <Plus className="w-4 h-4" /> Add First Product
                  </button>
                </div>
              ) : (
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                  <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                    <p className="text-sm text-zinc-400">
                      <span className="font-semibold text-white">{catalogEntries.filter(e => e.isActive).length}</span> active entries
                      {catalogEntries.some(e => !e.isActive) && (
                        <span className="ml-2 text-zinc-600">· {catalogEntries.filter(e => !e.isActive).length} removed</span>
                      )}
                    </p>
                    <div className="flex items-center gap-1 text-xs text-zinc-500">
                      <Tag className="w-3 h-3" /> SKU · Offers · Actions
                    </div>
                  </div>
                  {catalogEntries.map((entry) => (
                    <CatalogEntryRow
                      key={entry._id}
                      entry={entry}
                      onEdit={(e) => setCatalogModal(e)}
                      onDelete={handleCatalogDelete}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Flagged Listings / Counterfeit Reports ────────────────────── */}
          {activeTab === 'flagged' && null}
        </motion.div>
      </div>
    </div>
  );
}
