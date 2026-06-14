/**
 * prevention.mining.js — PURE text-mining for fit / compatibility / dimension
 * signals. Lexicon-based, no NLP model, fully deterministic and unit-testable.
 *
 * Inputs are arrays of strings (return reasonText + review text). Outputs are
 * the structured signal blobs the RIKB schema expects.
 *
 * Mirrors §3.3 + §6 of Phase7-Prevention.md.
 */

const {
  FIT_LEXICON,
  FIT_MIN_MENTIONS,
  FIT_VERDICT_MARGIN,
  COMPAT_LEXICON,
  COMPAT_MIN_MENTIONS,
  DIMENSION_LEXICON,
  DIMENSION_MIN_MENTIONS,
  DIMENSION_VERDICT_MARGIN,
} = require('../../contracts/prevention.contract');

const norm = (s) => String(s || '').toLowerCase();

function countMentions(text, phrases) {
  let n = 0;
  for (const phrase of phrases) {
    if (text.includes(phrase)) n++;
  }
  return n;
}

/**
 * mineFit(texts) → fitSignal blob
 * APPAREL & FOOTWEAR. Counts small/large mentions across the SKU's texts.
 */
function mineFit(texts) {
  const blob = (Array.isArray(texts) ? texts : []).map(norm);
  let small = 0;
  let large = 0;
  for (const t of blob) {
    small += countMentions(t, FIT_LEXICON.small);
    large += countMentions(t, FIT_LEXICON.large);
  }
  const total = small + large;

  if (total < FIT_MIN_MENTIONS) {
    return {
      verdict: 'unknown',
      smallMentions: small,
      largeMentions: large,
      sampleSize: total,
      confidence: 0,
    };
  }

  let verdict;
  if (small >= large * FIT_VERDICT_MARGIN) verdict = 'runs_small';
  else if (large >= small * FIT_VERDICT_MARGIN) verdict = 'runs_large';
  else verdict = 'true_to_size';

  // confidence = how much data × how lopsided the split
  const sampleFactor = Math.min(total / 10, 1);
  const lopsidedness = Math.abs(small - large) / Math.max(small + large, 1);
  const confidence = round2(sampleFactor * lopsidedness);

  return {
    verdict,
    smallMentions: small,
    largeMentions: large,
    sampleSize: total,
    confidence,
  };
}

/**
 * mineCompat(texts) → compatSignal blob
 * ELECTRONICS. Single-bucket lexicon — any compat keyword is a problem signal.
 */
function mineCompat(texts) {
  const blob = (Array.isArray(texts) ? texts : []).map(norm);
  let compat = 0;
  let setup = 0;
  for (const t of blob) {
    compat += countMentions(t, COMPAT_LEXICON);
    if (t.includes('setup') || t.includes('instructions') || t.includes('confusing')) {
      setup++;
    }
  }
  const total = compat;

  if (total < COMPAT_MIN_MENTIONS) {
    return {
      verdict: 'unknown',
      compatMentions: compat,
      setupMentions: setup,
      sampleSize: total,
      confidence: 0,
    };
  }
  // All compat keywords are negative → any sufficient volume = issues_reported.
  const sampleFactor = Math.min(total / 8, 1);
  return {
    verdict: 'issues_reported',
    compatMentions: compat,
    setupMentions: setup,
    sampleSize: total,
    confidence: round2(sampleFactor),
  };
}

/**
 * mineDimension(texts) → dimensionSignal blob
 * FURNITURE & HOME. Three buckets: too_large, too_small, color_off.
 * Verdict picks the dominant bucket with margin.
 */
function mineDimension(texts) {
  const blob = (Array.isArray(texts) ? texts : []).map(norm);
  let large = 0;
  let small = 0;
  let color = 0;
  for (const t of blob) {
    large += countMentions(t, DIMENSION_LEXICON.too_large);
    small += countMentions(t, DIMENSION_LEXICON.too_small);
    color += countMentions(t, DIMENSION_LEXICON.color_off);
  }
  const total = large + small + color;

  if (total < DIMENSION_MIN_MENTIONS) {
    return {
      verdict: 'unknown',
      largeMentions: large,
      smallMentions: small,
      colorMentions: color,
      sampleSize: total,
      confidence: 0,
    };
  }

  // Pick the dominant bucket if it clears the margin over the runner-up.
  const buckets = [
    { v: 'too_large', count: large },
    { v: 'too_small', count: small },
    { v: 'color_mismatch', count: color },
  ].sort((a, b) => b.count - a.count);

  let verdict;
  if (buckets[1].count === 0 || buckets[0].count >= buckets[1].count * DIMENSION_VERDICT_MARGIN) {
    verdict = buckets[0].v;
  } else {
    verdict = 'no_issues'; // signals are present but evenly split — no clear story
  }

  const sampleFactor = Math.min(total / 10, 1);
  const lopsidedness = (buckets[0].count - buckets[1].count) / Math.max(total, 1);
  const confidence = round2(sampleFactor * Math.max(lopsidedness, 0.2));

  return {
    verdict,
    largeMentions: large,
    smallMentions: small,
    colorMentions: color,
    sampleSize: total,
    confidence,
  };
}

/**
 * topComplaints(texts, k=5) → cap-5 array of frequent short phrases.
 * Simple n-gram tally over the union of fit/compat/dimension lexicons.
 */
function topComplaints(texts, k = 5) {
  const allPhrases = [
    ...FIT_LEXICON.small,
    ...FIT_LEXICON.large,
    ...COMPAT_LEXICON,
    ...DIMENSION_LEXICON.too_large,
    ...DIMENSION_LEXICON.too_small,
    ...DIMENSION_LEXICON.color_off,
  ];
  const tally = new Map();
  const blob = (Array.isArray(texts) ? texts : []).map(norm);
  for (const t of blob) {
    for (const phrase of allPhrases) {
      if (t.includes(phrase)) {
        tally.set(phrase, (tally.get(phrase) || 0) + 1);
      }
    }
  }
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([phrase]) => phrase);
}

const round2 = (n) => Math.round(n * 100) / 100;

module.exports = {
  mineFit,
  mineCompat,
  mineDimension,
  topComplaints,
};
