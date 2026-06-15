import axios from 'axios';
import { API_URL } from '../config/env.js';

const api = axios.create({
  baseURL: API_URL,
});

// Two ways to provide the auth token:
// 1) tokenGetter: an async function that returns a fresh token on every request
//    (used in production where Clerk JWTs auto-rotate ~every 60s).
// 2) staticToken: a fallback set imperatively (used by mock dev tokens which
//    never expire).
let tokenGetter = null;
let staticToken = null;

export const setTokenGetter = (fn) => {
  tokenGetter = typeof fn === 'function' ? fn : null;
};

export const setAuthToken = (token) => {
  staticToken = token || null;
};

api.interceptors.request.use(async (config) => {
  let token = null;
  if (tokenGetter) {
    try {
      token = await tokenGetter();
    } catch (err) {
      // If the getter throws (e.g. Clerk session ended), fall through to the
      // static token so callers still see a 401 from the server rather than a
      // client-side crash.
      console.warn('Auth token getter failed:', err);
    }
  }
  if (!token) token = staticToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
