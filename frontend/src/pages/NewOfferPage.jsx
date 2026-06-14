import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { getAllBrands } from '../services/brand.service';
import { getCatalogEntriesByBrand } from '../services/catalogEntry.service';
import { createOffer } from '../services/offer.service';
import {
  Search, ChevronRight, CheckCircle, Package, DollarSign,
  Truck, Loader2, ArrowLeft, Shield, Tag, Star, ShoppingBag,
  AlertCircle, Image as ImageIcon,
} from 'lucide-react';

// Step indicator
function StepIndicator({ step }) {
  const steps = [
    { num: 1, label: 'Choose Brand' },
    { num: 2, label: 'Select Product' },
    { num: 3, label: 'Set Your Offer' },
  ];
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((s, i) => (
        <div key={s.num} className="flex items-center">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
            step === s.num ? 'bg-[#FF9900] text-black' :
            step > s.num ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
            'bg-zinc-800 text-zinc-500'
          }`}>
            {step > s.num ? <CheckCircle className="w-3.5 h-3.5" /> : <span className="text-xs">{s.num}</span>}
            <span className="hidden sm:inline">{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`h-px w-6 mx-1 transition-colors ${step > s.num ? 'bg-emerald-500/40' : 'bg-zinc-800'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function NewOfferPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  // Step 1: brand selection
  const [brands, setBrands] = useState([]);
  const [brandSearch, setBrandSearch] = useState('');
  const [selectedBrand, setSelectedBrand] = useState(null);
  const [isLoadingBrands, setIsLoadingBrands] = useState(true);

  // Step 2: catalog entry selection
  const [catalogEntries, setCatalogEntries] = useState([]);
  const [entrySearch, setEntrySearch] = useState('');
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [isLoadingEntries, setIsLoadingEntries] = useState(false);

  // Step 3: offer form
  const [offerForm, setOfferForm] = useState({ price: '', condition: 'New', quantity: 1, shippingNote: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const fetchBrands = async () => {
      try {
        const res = await getAllBrands();
        if (res.success) setBrands(res.data);
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoadingBrands(false);
      }
    };
    fetchBrands();
  }, []);

  const handleSelectBrand = async (brand) => {
    setSelectedBrand(brand);
    setSelectedEntry(null);
    setIsLoadingEntries(true);
    setStep(2);
    try {
      const res = await getCatalogEntriesByBrand(brand._id);
      if (res.success) setCatalogEntries(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingEntries(false);
    }
  };

  const handleSelectEntry = (entry) => {
    setSelectedEntry(entry);
    setStep(3);
  };

  const handleSubmitOffer = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitError('');
    try {
      const payload = {
        catalogEntryId: selectedEntry._id,
        price: parseFloat(offerForm.price),
        quantity: parseInt(offerForm.quantity),
      };
      await createOffer(payload);
      setSuccess(true);
    } catch (err) {
      setSubmitError(err.response?.data?.message || 'Failed to create offer. You may already have an offer on this product.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredBrands = brands.filter((b) =>
    b.name.toLowerCase().includes(brandSearch.toLowerCase())
  );
  const filteredEntries = catalogEntries.filter((e) =>
    e.title.toLowerCase().includes(entrySearch.toLowerCase())
  );

  // Success state
  if (success) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full text-center space-y-6"
        >
          <div className="w-20 h-20 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle className="w-10 h-10 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold mb-2">Offer Live!</h1>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Your offer for <span className="text-white font-medium">{selectedEntry?.title}</span> is now competing for the Buy Box.
              The platform has automatically computed who holds the Buy Box based on price.
            </p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 text-left">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-zinc-500">Your Price</span>
              <span className="text-white font-bold">${parseFloat(offerForm.price).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Brand</span>
              <span className="text-[#FF9900]">{selectedBrand?.name}</span>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => navigate('/seller/dashboard')}
              className="flex-1 py-3 rounded-xl border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 text-sm font-medium transition-all"
            >
              Back to Dashboard
            </button>
            <button
              onClick={() => navigate(`/p/${selectedEntry?._id}`)}
              className="flex-1 py-3 rounded-xl bg-[#FF9900] text-black text-sm font-bold hover:bg-[#FFB347] transition-colors"
            >
              View Product Page
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-6 md:p-8 font-sans">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => step === 1 ? navigate('/seller/dashboard') : setStep((s) => s - 1)}
            className="p-2 rounded-xl border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600 transition-all"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold">List on an Existing Brand Product</h1>
            <p className="text-sm text-zinc-500">Join the competitive offer pool on a brand's official catalog entry</p>
          </div>
        </div>

        <StepIndicator step={step} />

        <AnimatePresence mode="wait">
          {/* ── Step 1: Choose Brand ──────────────────────────────────────── */}
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="mb-4 relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  type="text"
                  value={brandSearch}
                  onChange={(e) => setBrandSearch(e.target.value)}
                  placeholder="Search brands..."
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-[#FF9900]/30 focus:border-[#FF9900] transition-all text-sm"
                />
              </div>

              {isLoadingBrands ? (
                <div className="flex items-center justify-center p-16">
                  <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
                </div>
              ) : filteredBrands.length === 0 ? (
                <div className="text-center p-16 text-zinc-500">No brands found</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {filteredBrands.map((brand) => (
                    <motion.button
                      key={brand._id}
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      onClick={() => handleSelectBrand(brand)}
                      className="bg-zinc-900 border border-zinc-800 hover:border-[#FF9900]/40 rounded-2xl p-5 text-left transition-all group"
                    >
                      <div className="flex items-center gap-3 mb-3">
                        {brand.logoUrl ? (
                          <img src={brand.logoUrl} alt={brand.name} className="w-10 h-10 rounded-xl object-contain bg-white p-1" />
                        ) : (
                          <div className="w-10 h-10 rounded-xl bg-[#FF9900] flex items-center justify-center text-black font-black text-lg">
                            {brand.name?.[0]?.toUpperCase()}
                          </div>
                        )}
                        <div>
                          <p className="font-bold text-sm text-white group-hover:text-[#FF9900] transition-colors">{brand.name}</p>
                          {brand.isVerified && <p className="text-[10px] text-emerald-400">✓ Verified Brand</p>}
                        </div>
                      </div>
                      {brand.category && (
                        <p className="text-xs text-zinc-500 mb-2">{brand.category}</p>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-zinc-600">{brand.catalogEntryCount ?? 0} catalog entries</span>
                        <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-[#FF9900] transition-colors" />
                      </div>
                    </motion.button>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* ── Step 2: Select Catalog Entry ──────────────────────────────── */}
          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              {/* Selected brand pill */}
              <div className="flex items-center gap-2 mb-4 p-3 bg-zinc-900 border border-zinc-800 rounded-xl w-fit">
                <Shield className="w-4 h-4 text-[#FF9900]" />
                <span className="text-sm font-semibold text-white">{selectedBrand?.name}</span>
                <button onClick={() => setStep(1)} className="text-xs text-zinc-500 hover:text-white ml-2 transition-colors">Change</button>
              </div>

              <div className="mb-4 relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  type="text"
                  value={entrySearch}
                  onChange={(e) => setEntrySearch(e.target.value)}
                  placeholder="Search products by title or SKU..."
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-[#FF9900]/30 focus:border-[#FF9900] transition-all text-sm"
                />
              </div>

              {isLoadingEntries ? (
                <div className="flex items-center justify-center p-16">
                  <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
                </div>
              ) : filteredEntries.length === 0 ? (
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-12 text-center">
                  <Package className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
                  <p className="text-zinc-400 text-sm">This brand has no catalog entries yet.</p>
                  <p className="text-zinc-600 text-xs mt-1">The brand owner must add products to their catalog first.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredEntries.map((entry) => (
                    <motion.button
                      key={entry._id}
                      whileHover={{ scale: 1.005 }}
                      onClick={() => handleSelectEntry(entry)}
                      className="w-full bg-zinc-900 border border-zinc-800 hover:border-[#FF9900]/40 rounded-2xl p-4 text-left transition-all group flex items-center gap-4"
                    >
                      <div className="w-16 h-16 rounded-xl bg-zinc-800 flex-shrink-0 overflow-hidden">
                        {entry.officialImages?.[0] ? (
                          <img src={entry.officialImages[0]} alt={entry.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-zinc-600">
                            <ImageIcon className="w-5 h-5" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-white group-hover:text-[#FF9900] transition-colors truncate">{entry.title}</p>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-zinc-500">{entry.category}</span>
                          <span className="text-xs text-[#FF9900]">{entry.activeOfferCount ?? 0} competing offers</span>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-[#FF9900] transition-colors flex-shrink-0" />
                    </motion.button>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* ── Step 3: Set Your Offer ─────────────────────────────────────── */}
          {step === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

                {/* Brand content (read-only) */}
                <div className="lg:col-span-3 space-y-4">
                  <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                    {selectedEntry?.officialImages?.[0] && (
                      <img src={selectedEntry.officialImages[0]} alt={selectedEntry.title} className="w-full h-52 object-cover" />
                    )}
                    <div className="p-5">
                      <div className="flex items-center gap-2 mb-2">
                        <Shield className="w-4 h-4 text-[#FF9900]" />
                        <span className="text-xs text-[#FF9900] font-medium">{selectedBrand?.name} — Official Listing</span>
                        <span className="text-xs text-emerald-400 border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">Brand Controlled</span>
                      </div>
                      <h2 className="text-lg font-bold text-white mb-3">{selectedEntry?.title}</h2>
                      {selectedEntry?.bulletPoints?.length > 0 && (
                        <ul className="space-y-1 mb-3">
                          {selectedEntry.bulletPoints.map((bp, i) => (
                            <li key={i} className="text-xs text-zinc-300 flex items-start gap-1.5">
                              <span className="text-[#FF9900] mt-0.5">•</span> {bp}
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="text-xs text-zinc-500 leading-relaxed">{selectedEntry?.description}</p>
                    </div>
                  </div>
                  <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      Product title, images, and description are controlled by <span className="text-white font-medium">{selectedBrand?.name}</span>.
                      Buyers will see this official content when viewing your offer.
                    </p>
                  </div>
                </div>

                {/* Offer form */}
                <div className="lg:col-span-2">
                  <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 sticky top-8">
                    <h3 className="text-lg font-bold mb-1">Your Offer</h3>
                    <p className="text-xs text-zinc-500 mb-5">Set your competitive price to win the Buy Box</p>

                    {submitError && (
                      <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs">
                        {submitError}
                      </div>
                    )}

                    <form onSubmit={handleSubmitOffer} className="space-y-4">
                      {/* Price */}
                      <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-1.5 flex items-center gap-1.5">
                          <DollarSign className="w-3.5 h-3.5 text-[#FF9900]" /> Your Price *
                        </label>
                        <div className="relative">
                          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 text-sm font-medium">$</span>
                          <input
                            type="number"
                            value={offerForm.price}
                            onChange={(e) => setOfferForm((f) => ({ ...f, price: e.target.value }))}
                            placeholder="0.00"
                            step="0.01"
                            min="0"
                            required
                            className="w-full bg-black/50 border border-zinc-800 rounded-xl pl-7 pr-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-[#FF9900]/40 focus:border-[#FF9900] transition-all text-sm"
                          />
                        </div>
                        <p className="text-[10px] text-zinc-600 mt-1">Lower price = higher Buy Box chance</p>
                      </div>

                      {/* Quantity */}
                      <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                          <Tag className="inline w-3.5 h-3.5 mr-1" /> Quantity
                        </label>
                        <input
                          type="number"
                          value={offerForm.quantity}
                          onChange={(e) => setOfferForm((f) => ({ ...f, quantity: parseInt(e.target.value) }))}
                          min="1"
                          className="w-full bg-black/50 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-[#FF9900]/40 focus:border-[#FF9900] transition-all text-sm"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={isSubmitting || !offerForm.price}
                        className="w-full bg-[#FF9900] text-black font-bold py-3.5 rounded-xl hover:bg-[#FFB347] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingBag className="w-4 h-4" />}
                        {isSubmitting ? 'Submitting...' : 'Submit Offer'}
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
