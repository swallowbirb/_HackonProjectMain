import api from './api';

// Shared localStorage key for the Montage_Triage developer toggle (Req 10.1, 10.2).
export const MONTAGE_KEY = 'dev_montage_triage';

/**
 * Returns true when the Montage_Triage DevTools toggle is on.
 * Default is off; the toggle is opt-in for developers only.
 */
export const getMontageMode = () => localStorage.getItem(MONTAGE_KEY) === 'true';

// Shared localStorage key for the cache-bypass developer toggle.
export const BUST_CACHE_KEY = 'dev_bust_cache';

/**
 * Returns true when the cache-bypass toggle is on — form generation will
 * always trigger a fresh Gemini call, ignoring any TTL-cached schema.
 */
export const getBustCacheMode = () => localStorage.getItem(BUST_CACHE_KEY) === 'true';

/**
 * DEV ONLY — Force-regenerate the evidence form for an item, bypassing the
 * ML-service TTL cache so a fresh Gemini Pass-1 call always fires.
 */
export const regenForm = async (itemId) => {
  try {
    const response = await api.post('/dev/regen-form', { itemId });
    return response.data;
  } catch (error) {
    return {
      success: false,
      message: error.response?.data?.message || error.message || 'Regen failed',
    };
  }
};

export const eraseAllData = async () => {
  const response = await api.delete('/dev/erase');
  return response.data;
};

export const populateFakeStore = async () => {
  const response = await api.post('/dev/populate');
  return response.data;
};

export const downloadDatabaseSnapshot = async () => {
  // We use standard fetch or window.open because it's a file download.
  // Using axios for downloads requires blob handling.
  try {
    const response = await api.get('/dev/save', { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'marketplace-snapshot.json');
    document.body.appendChild(link);
    link.click();
    link.parentNode.removeChild(link);
    return { success: true };
  } catch (error) {
    console.error('Error downloading snapshot:', error);
    return { success: false, message: 'Download failed' };
  }
};

/**
 * Reset all return-pipeline data (Items, Grades, Logs, LifecycleEvents, etc.)
 * so the same product/order can be returned again from scratch.
 *
 * Pass mockClerkId to scope the wipe to the currently active mock user,
 * or call without args to wipe everything.
 */
export const resetReturnData = async ({ mockClerkId } = {}) => {
  const params = mockClerkId ? { mockClerkId } : {};
  const response = await api.delete('/dev/reset-returns', { params });
  return response.data;
};

/**
 * Quick connectivity check for the Gemini LLM. Sends a trivial prompt and
 * reports whether the API answered, including the exact error (e.g.
 * RESOURCE_EXHAUSTED) when it didn't. Useful for diagnosing quota issues.
 */
export const pingGemini = async () => {
  try {
    const response = await api.get('/dev/gemini-ping');
    return response.data;
  } catch (error) {
    return { ok: false, error: error.response?.data?.error || error.message || 'Request failed' };
  }
};

/**
 * DEV ONLY — Skip the AI grading pipeline and assign a grade by hand, then run
 * routing. Lets you jump from the evidence step straight to the routing stage
 * without waiting on the ML service.
 *
 * @param {string} itemId
 * @param {{ grade: 'A'|'B'|'C'|'D', rationale?: string, route?: boolean }} opts
 */
export const manualGrade = async (itemId, { grade, rationale, route = true } = {}) => {
  try {
    const response = await api.post('/dev/manual-grade', { itemId, grade, rationale, route });
    return response.data;
  } catch (error) {
    return {
      success: false,
      message: error.response?.data?.message || error.message || 'Manual grade failed',
    };
  }
};
