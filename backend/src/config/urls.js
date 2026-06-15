/**
 * Central service URL configuration — read from environment, never hardcode production hosts.
 */

const stripTrailingSlash = (url) => (url ? String(url).replace(/\/$/, '') : '');

const ML_SERVICE_URL = stripTrailingSlash(
  process.env.ML_SERVICE_URL || 'http://localhost:8000'
);

const FRONTEND_URL = stripTrailingSlash(
  process.env.FRONTEND_URL || 'http://localhost:5173'
);

const BACKEND_URL = stripTrailingSlash(
  process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5001}`
);

const LOCAL_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'http://localhost:5001',
];

/** Vercel preview/production and Render deployments */
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/.*\.vercel\.app$/,
  /^https:\/\/.*\.onrender\.com$/,
];

function parseOriginList(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => stripTrailingSlash(s.trim()))
    .filter(Boolean);
}

/**
 * Origins allowed by Express CORS middleware.
 * Set CORS_ORIGINS (comma-separated) for explicit production hosts.
 */
function getAllowedOrigins() {
  const fromEnv = parseOriginList(process.env.CORS_ORIGINS);
  const combined = [
    ...fromEnv,
    FRONTEND_URL,
    BACKEND_URL,
    ML_SERVICE_URL,
    ...LOCAL_DEV_ORIGINS,
  ].filter(Boolean);
  return [...new Set(combined)];
}

function isOriginAllowed(origin) {
  if (!origin) return true;
  const normalized = stripTrailingSlash(origin);
  if (getAllowedOrigins().includes(normalized)) return true;
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(normalized));
}

module.exports = {
  ML_SERVICE_URL,
  FRONTEND_URL,
  BACKEND_URL,
  LOCAL_DEV_ORIGINS,
  ALLOWED_ORIGIN_PATTERNS,
  getAllowedOrigins,
  isOriginAllowed,
  stripTrailingSlash,
};
