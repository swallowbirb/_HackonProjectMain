import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Plus, RotateCcw, Search, Sparkles, Trash2, Users, X } from 'lucide-react';
import {
  getPopulatorConfig,
  savePopulatorConfig,
  addPopulatorTag,
  removePopulatorTag,
} from '../../services/demand.service';

const SLIDER_MAX_DEMAND = 800;
const SLIDER_MAX_PEERS = 40;
const SLIDER_STEP = 1;

const prettyTag = (t) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Demand Populator — a show/hide right sidebar to tune the per-tag "peak
 * population" (busiest-city count) for both Search Demand and Peer Buyers, then
 * generate + replace the live map data in one click. Built for testing / demos.
 */
export default function PopulatorSidebar({ open, onClose, onApplied }) {
  const [tags, setTags] = useState([]);
  const [builtinTags, setBuiltinTags] = useState([]);
  const [demand, setDemand] = useState({});
  const [peers, setPeers] = useState({});
  const [defaults, setDefaults] = useState({ demand: {}, peers: {} });
  const [newTag, setNewTag] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const [error, setError] = useState(null);

  // Push a fresh config into local state (used after load / add / remove).
  const applyConfig = (cfg) => {
    setTags(cfg?.tags || []);
    setBuiltinTags(cfg?.builtinTags || []);
    setDemand({ ...(cfg?.demand || {}) });
    setPeers({ ...(cfg?.peers || {}) });
    setDefaults({ demand: cfg?.defaults?.demand || {}, peers: cfg?.defaults?.peers || {} });
  };

  // Load the current config the first time the sidebar is opened.
  useEffect(() => {
    if (!open || tags.length) return;
    setLoading(true);
    getPopulatorConfig()
      .then(applyConfig)
      .catch((e) => setError(e.response?.data?.message || 'Failed to load populator config.'))
      .finally(() => setLoading(false));
  }, [open, tags.length]);

  const resetDefaults = () => {
    setDemand({ ...defaults.demand });
    setPeers({ ...defaults.peers });
  };

  const addTag = () => {
    const t = newTag.trim();
    if (!t) return;
    setAddingTag(true);
    setError(null);
    addPopulatorTag(t)
      .then((cfg) => {
        applyConfig(cfg);
        setNewTag('');
        onApplied?.(cfg);
      })
      .catch((e) => setError(e.response?.data?.message || 'Failed to add tag.'))
      .finally(() => setAddingTag(false));
  };

  const removeTag = (tag) => {
    setError(null);
    removePopulatorTag(tag)
      .then((cfg) => {
        applyConfig(cfg);
        onApplied?.(cfg);
      })
      .catch((e) => setError(e.response?.data?.message || 'Failed to remove tag.'));
  };

  const apply = () => {
    setSaving(true);
    setError(null);
    savePopulatorConfig({ demand, peers })
      .then((cfg) => {
        applyConfig(cfg);
        onApplied?.(cfg);
      })
      .catch((e) => setError(e.response?.data?.message || 'Failed to apply population.'))
      .finally(() => setSaving(false));
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/20 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Panel */}
          <motion.aside
            className="fixed top-0 right-0 h-full w-[380px] max-w-[90vw] bg-white shadow-2xl z-50 flex flex-col border-l border-gray-200"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-base font-black text-gray-900 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-600" /> Demand Populator
                </h2>
                <p className="text-[11px] text-gray-400 mt-0.5">Peak population (busiest city) per tag.</p>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Add a custom tag */}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') addTag(); }}
                      placeholder="New tag (e.g. gaming console)"
                      maxLength={24}
                      className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
                    />
                    <button
                      onClick={addTag}
                      disabled={addingTag || !newTag.trim()}
                      className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {addingTag ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    </button>
                  </div>

                  {tags.map((t) => {
                    const isCustom = !builtinTags.includes(t);
                    return (
                      <div key={t} className="rounded-xl border border-gray-150 bg-gray-50/60 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
                            {prettyTag(t)}
                            {isCustom && (
                              <span className="text-[9px] uppercase tracking-wide font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded">custom</span>
                            )}
                          </span>
                          {isCustom && (
                            <button
                              onClick={() => removeTag(t)}
                              title="Remove tag"
                              className="p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        <SliderRow
                          icon={Search}
                          label="Search Demand"
                          color="#dc2626"
                          value={demand[t] ?? 0}
                          onChange={(v) => setDemand((d) => ({ ...d, [t]: v }))}
                        />
                        <SliderRow
                          icon={Users}
                          label="Peer Buyers"
                          color="#7c3aed"
                          value={peers[t] ?? 0}
                          onChange={(v) => setPeers((p) => ({ ...p, [t]: v }))}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-gray-100 space-y-2">
              {error && <div className="text-xs text-red-600">{error}</div>}
              <button
                onClick={resetDefaults}
                disabled={saving || loading}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Reset to defaults
              </button>
              <button
                onClick={apply}
                disabled={saving || loading}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Generate and Replace Population
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function SliderRow({ icon: Icon, label, color, value, onChange }) {
  const max = label === 'Peer Buyers' ? SLIDER_MAX_PEERS : SLIDER_MAX_DEMAND;
  return (
    <div className="mb-2 last:mb-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-600 inline-flex items-center gap-1">
          <Icon className="w-3 h-3" style={{ color }} /> {label}
        </span>
        <span className="text-xs font-bold tabular-nums" style={{ color }}>{value}</span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={SLIDER_STEP}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer transition-all"
        style={{
          accentColor: color,
          background: `linear-gradient(to right, ${color} ${(value / max) * 100}%, #e5e7eb ${(value / max) * 100}%)`,
        }}
      />
    </div>
  );
}
