import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Loader2, MapPin, Trash2, Plus, Tag, IndianRupee } from 'lucide-react';
import { createWant, getMyWants, deleteWant } from '../services/demand.service';

// Demo region (Chhattisgarh) cities → [lng, lat]. Used when the buyer doesn't
// share their browser location. Matches the seeded warehouse region.
const CITIES = [
  { name: 'Raipur', lng: 81.6296, lat: 21.2514 },
  { name: 'Bhilai', lng: 81.3509, lat: 21.1938 },
  { name: 'Bilaspur', lng: 82.1409, lat: 22.0797 },
  { name: 'Korba', lng: 82.7501, lat: 22.3595 },
  { name: 'Durg', lng: 81.2849, lat: 21.1904 },
  { name: 'Raigarh', lng: 83.3950, lat: 21.8974 },
];

const CATEGORIES = [
  'Electronics', 'Clothing', 'Home & Garden', 'Sports', 'Toys', 'Books', 'Automotive', 'Health & Beauty',
];

const CONDITIONS = [
  { value: 'any', label: 'Any condition' },
  { value: 'like-new', label: 'Like new' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
];

export default function LookingForPage() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const [text, setText] = useState('');
  const [category, setCategory] = useState('Electronics');
  const [condition, setCondition] = useState('any');
  const [maxPrice, setMaxPrice] = useState('');
  const [radiusKm, setRadiusKm] = useState(25);
  const [cityName, setCityName] = useState('Raipur');
  const [coords, setCoords] = useState(null); // [lng, lat] from browser geolocation
  const [locating, setLocating] = useState(false);

  const loadPosts = () => {
    setLoading(true);
    getMyWants()
      .then((data) => setPosts(Array.isArray(data) ? data : []))
      .catch((e) => setError(e.response?.data?.message || 'Failed to load your posts.'))
      .finally(() => setLoading(false));
  };

  useEffect(loadPosts, []);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setError('Your browser does not support location. Pick a city instead.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords([pos.coords.longitude, pos.coords.latitude]);
        setLocating(false);
      },
      () => {
        setError('Could not get your location. Pick a city instead.');
        setLocating(false);
      },
      { timeout: 8000 }
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    let lng, lat;
    if (coords) {
      [lng, lat] = coords;
    } else {
      const city = CITIES.find((c) => c.name === cityName) || CITIES[0];
      lng = city.lng;
      lat = city.lat;
    }

    if (!text.trim()) {
      setError('Describe what you are looking for.');
      return;
    }

    setSubmitting(true);
    try {
      await createWant({
        text: text.trim(),
        productCategory: category,
        condition,
        maxPrice: maxPrice ? Number(maxPrice) : undefined,
        radiusKm: Number(radiusKm),
        lng,
        lat,
      });
      setText('');
      setMaxPrice('');
      loadPosts();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not create your post.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteWant(id);
      setPosts((prev) => prev.filter((p) => p._id !== id));
    } catch (err) {
      setError(err.response?.data?.message || 'Could not remove the post.');
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-10 font-sans">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
            <Search className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-gray-900">Looking for something?</h1>
            <p className="text-sm text-gray-500">Post what you want and we'll match nearby second-life items.</p>
          </div>
        </div>
      </motion.div>

      {/* Create form */}
      <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-2xl p-5 mb-8 space-y-4 shadow-sm">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">What are you looking for?</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="E.g. red running shoes size 9 under 2000"
            rows={2}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent resize-none"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Condition</label>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              {CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Max price (₹)</label>
            <input
              type="number"
              min="0"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              placeholder="Optional"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Within (km)</label>
            <input
              type="number"
              min="1"
              value={radiusKm}
              onChange={(e) => setRadiusKm(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
        </div>

        {/* Location */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Your location</label>
          <div className="flex items-center gap-3">
            <select
              value={cityName}
              onChange={(e) => { setCityName(e.target.value); setCoords(null); }}
              disabled={!!coords}
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-50 disabled:text-gray-400"
            >
              {CITIES.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
            <button
              type="button"
              onClick={coords ? () => setCoords(null) : useMyLocation}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              {locating ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
              {coords ? 'Using GPS — reset' : 'Use my location'}
            </button>
          </div>
          {coords && (
            <p className="text-xs text-indigo-600 mt-1.5">📍 Using your current location.</p>
          )}
        </div>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex justify-end">
          <motion.button
            whileTap={{ scale: 0.97 }}
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold px-6 py-2.5 rounded-xl transition-colors shadow-sm text-sm"
          >
            {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Posting…</> : <><Plus className="w-4 h-4" /> Post request</>}
          </motion.button>
        </div>
      </form>

      {/* Existing posts */}
      <h2 className="text-sm font-bold text-gray-700 mb-3">Your requests</h2>
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-zinc-400" /></div>
      ) : posts.length === 0 ? (
        <p className="text-sm text-gray-500 py-8 text-center">No requests yet. Post one above.</p>
      ) : (
        <div className="space-y-3">
          {posts.map((p) => {
            const expired = p.expiresAt && new Date(p.expiresAt) < new Date();
            const inactive = !p.active || expired;
            return (
              <div
                key={p._id}
                className={`flex items-start gap-4 p-4 rounded-2xl border bg-white ${inactive ? 'border-gray-100 opacity-60' : 'border-gray-200'}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm">{p.text || p.keywords?.join(', ')}</p>
                  <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><Tag className="w-3 h-3" /> {p.productCategory}</span>
                    {p.maxPrice != null && (
                      <span className="flex items-center gap-0.5"><IndianRupee className="w-3 h-3" /> {p.maxPrice}</span>
                    )}
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {p.radiusKm} km</span>
                    {inactive && <span className="text-red-500 font-medium">{expired ? 'Expired' : 'Inactive'}</span>}
                  </div>
                  {p.keywords?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {p.keywords.map((k) => (
                        <span key={k} className="text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{k}</span>
                      ))}
                    </div>
                  )}
                </div>
                {!inactive && (
                  <button
                    onClick={() => handleDelete(p._id)}
                    className="text-gray-400 hover:text-red-500 transition-colors p-1"
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
