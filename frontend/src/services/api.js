import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
});

// We can optionally use an interceptor to inject Clerk's token.
// Since Clerk React SDK provides hooks, we often do this inside a component or custom hook.
// But for global API setup, it's easier to inject it manually before making requests if needed,
// or we can expose a function to set the token.

let authToken = null;

export const setAuthToken = (token) => {
  authToken = token;
};

api.interceptors.request.use((config) => {
  if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  return config;
});

export default api;
