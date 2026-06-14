import React, { useState } from 'react';
import { ImageOff } from 'lucide-react';

/**
 * ProductImageAngleEditor (v2.34)
 *
 * Image-URL rows with a live thumbnail preview, an ANGLE tag dropdown
 * (Front / Left / Right / Rear), and a CUSTOM tag option.
 *
 * Angle tags → saved to `imageAngles` (per-angle phash reference for the AI grader).
 * Custom tags → saved to `imageHints` [{ url, label, hint }], passed to Pass-1 form
 *   generation so the LLM generates a dedicated form field for that image when a
 *   buyer returns/resells the product. `label` is the tag heading, `hint` is the
 *   description the AI uses to verify the buyer's photo.
 *
 * Props:
 *   images   : string[]
 *   angles   : { [angle]: url }
 *   hints    : [{ url, label, hint }]
 *   setImages, setAngles, setHints : setters
 */

const ANGLE_OPTIONS = [
  { value: '', label: 'Untagged' },
  { value: 'front', label: 'Front' },
  { value: 'side_left', label: 'Left' },
  { value: 'side_right', label: 'Right' },
  { value: 'rear', label: 'Rear' },
  { value: '__custom__', label: 'Custom…' },
];

const Thumb = ({ url }) => {
  const [broken, setBroken] = useState(false);
  const valid = url && /^https?:\/\//i.test(url) && !broken;
  return (
    <div className="w-12 h-12 flex-shrink-0 rounded-lg overflow-hidden bg-zinc-800 border border-zinc-700 flex items-center justify-center">
      {valid ? (
        <img src={url} alt="" className="w-full h-full object-cover" onError={() => setBroken(true)} />
      ) : (
        <ImageOff className="w-4 h-4 text-zinc-600" />
      )}
    </div>
  );
};

const ProductImageAngleEditor = ({
  images = [],
  angles = {},
  hints = [],
  setImages,
  setAngles,
  setHints,
}) => {
  // A row is "custom" if an entry exists for its URL — independent of whether the
  // text is filled yet. (This was the bug: empty hint text hid the input.)
  const hintEntry = (url) => (url ? hints.find((h) => h.url === url) : undefined);

  const angleOfUrl = (url) => {
    if (!url) return '';
    return Object.keys(angles).find((k) => angles[k] === url) || '';
  };

  const dropdownValue = (url) => {
    const angle = angleOfUrl(url);
    if (angle) return angle;
    if (hintEntry(url)) return '__custom__';
    return '';
  };

  const handleUrlChange = (idx, val) => {
    const oldUrl = images[idx];
    const next = [...images];
    next[idx] = val;
    setImages(next);

    // Migrate angle tag to the new URL.
    const taggedAngle = Object.keys(angles).find((k) => angles[k] === oldUrl);
    if (taggedAngle) {
      const a = { ...angles };
      if (val && val.trim()) a[taggedAngle] = val;
      else delete a[taggedAngle];
      setAngles(a);
    }

    // Migrate any custom entry to the new URL.
    if (hintEntry(oldUrl)) {
      setHints(hints.map((h) => (h.url === oldUrl ? { ...h, url: val } : h)));
    }
  };

  const handleDropdownChange = (idx, value) => {
    const url = images[idx];
    const a = { ...angles };
    Object.keys(a).forEach((k) => { if (a[k] === url) delete a[k]; });

    if (value === '__custom__') {
      setAngles(a);
      if (!hintEntry(url)) {
        setHints([...hints, { url, label: '', hint: '' }]);
      }
    } else {
      setHints(hints.filter((h) => h.url !== url)); // leaving custom mode clears the entry
      if (value) a[value] = url;
      setAngles(a);
    }
  };

  const updateHint = (url, patch) => {
    const idx = hints.findIndex((h) => h.url === url);
    if (idx >= 0) {
      const next = [...hints];
      next[idx] = { ...next[idx], ...patch };
      setHints(next);
    } else {
      setHints([...hints, { url, label: '', hint: '', ...patch }]);
    }
  };

  const addRow = () => setImages([...images, '']);

  const removeRow = (idx) => {
    const url = images[idx];
    setImages(images.filter((_, i) => i !== idx));
    const taggedAngle = Object.keys(angles).find((k) => angles[k] === url);
    if (taggedAngle) {
      const a = { ...angles };
      delete a[taggedAngle];
      setAngles(a);
    }
    setHints(hints.filter((h) => h.url !== url));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-medium text-zinc-300">
          Product Images <span className="text-zinc-500">(optional URLs)</span>
        </label>
        <button type="button" onClick={addRow} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
          + Add another
        </button>
      </div>

      {images.map((url, idx) => {
        const hasUrl = url && url.trim() !== '';
        const dv = hasUrl ? dropdownValue(url) : '';
        const isCustom = dv === '__custom__';
        const entry = hintEntry(url) || { label: '', hint: '' };

        return (
          <div key={idx} className="mb-2 space-y-2">
            {/* Main row: thumb + URL + angle/custom dropdown + remove */}
            <div className="flex gap-2 items-center">
              <Thumb url={url} />
              <input
                type="url"
                value={url}
                onChange={(e) => handleUrlChange(idx, e.target.value)}
                placeholder="https://example.com/image.jpg"
                className="flex-1 min-w-0 bg-black/50 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all text-sm"
              />
              <select
                value={dv}
                disabled={!hasUrl}
                onChange={(e) => handleDropdownChange(idx, e.target.value)}
                title="Tag angle or add a custom instruction for the AI form generator"
                className={`bg-black/50 border rounded-xl px-2 py-3 text-xs focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed transition-all ${
                  isCustom
                    ? 'border-violet-500 text-violet-300 focus:border-violet-400'
                    : 'border-zinc-800 text-zinc-300 focus:border-violet-500'
                }`}
              >
                {ANGLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {images.length > 1 && (
                <button type="button" onClick={() => removeRow(idx)} className="text-zinc-500 hover:text-red-400 transition-colors px-2">
                  ✕
                </button>
              )}
            </div>

            {/* Custom tag — heading + description, expands inline when "Custom…" is selected */}
            {isCustom && hasUrl && (
              <div className="ml-14 rounded-xl border border-violet-500/40 bg-violet-500/5 p-3 space-y-2">
                <div>
                  <label className="block text-[11px] font-semibold text-violet-300 mb-1">Tag heading</label>
                  <input
                    type="text"
                    value={entry.label}
                    onChange={(e) => updateHint(url, { label: e.target.value })}
                    maxLength={60}
                    placeholder="e.g. Charging Port"
                    className="w-full bg-black/50 border border-violet-500/40 rounded-lg px-3 py-2 text-xs text-violet-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-violet-300 mb-1">Describe this image</label>
                  <textarea
                    rows={2}
                    value={entry.hint}
                    onChange={(e) => updateHint(url, { hint: e.target.value })}
                    maxLength={400}
                    placeholder="Used by the AI to verify returns/refunds. e.g. Close-up of the charging port — all pins must be present and not bent."
                    className="w-full bg-black/50 border border-violet-500/40 rounded-lg px-3 py-2 text-xs text-violet-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-violet-500 resize-y"
                  />
                </div>
                <p className="text-[10px] text-zinc-500">
                  The AI form generator will create a dedicated photo field from this, and the grader will
                  use the description to verify the buyer's photo on a return/refund.
                </p>
              </div>
            )}
          </div>
        );
      })}

      <p className="text-xs text-zinc-600 mt-1">
        Tag <span className="text-zinc-400">Front / Left / Right / Rear</span> for the AI grader's angle-matching.
        Use <span className="text-violet-400">Custom…</span> to add a heading + description the AI checks on returns.
      </p>
    </div>
  );
};

export default ProductImageAngleEditor;
