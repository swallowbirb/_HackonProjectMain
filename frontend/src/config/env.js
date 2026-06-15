/**
 * Frontend environment — all service URLs come from Vite env vars (set in .env / Vercel dashboard).
 */

const stripTrailingSlash = (url) => (url ? String(url).replace(/\/$/, '') : '');

/** Backend API base URL, including /api suffix */
export const API_URL =
  stripTrailingSlash(import.meta.env.VITE_API_URL) || 'http://localhost:5001/api';

/** Dev-only proxy target for vite.config.js (host without /api path) */
export const API_PROXY_TARGET =
  stripTrailingSlash(import.meta.env.VITE_API_PROXY_TARGET) ||
  API_URL.replace(/\/api$/, '') ||
  'http://localhost:5001';
