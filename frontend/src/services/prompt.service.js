import api from './api';

/**
 * Admin prompt-config service (v2.34). Manages the editable base + category grading
 * prompts that fine-tune the AI grader. Admin-only on the backend.
 */

export const listPrompts = async () => {
  const response = await api.get('/prompts');
  return response.data; // { success, data: [{ scope, key, label, content, version, enabled }] }
};

export const savePrompt = async ({ scope, key, content, label, enabled }) => {
  const response = await api.put('/prompts', { scope, key, content, label, enabled });
  return response.data;
};

export const resetPrompt = async ({ scope, key }) => {
  const response = await api.post('/prompts/reset', { scope, key });
  return response.data;
};

// Add a new category: the backend slugifies `name` into a key and writes the overlay
// file. (Reuses the upsert endpoint — a new key just creates a new category file.)
export const createCategoryPrompt = async ({ name, content }) => {
  const response = await api.put('/prompts', { scope: 'category', key: name, content });
  return response.data;
};

// Delete an admin-added category overlay. Built-in bundles are rejected by the backend.
export const deleteCategoryPrompt = async ({ key }) => {
  const response = await api.delete('/prompts/category', { data: { key } });
  return response.data;
};
