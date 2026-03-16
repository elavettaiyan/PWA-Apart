import axios from 'axios';
import { redirectToLogin } from './navigation';
import { getApiBaseUrl } from './platform';
import { useAuthStore } from '../store/authStore';

declare global {
  interface Window {
    __networkDebugLogs?: string[];
  }
}

const apiBaseUrl = getApiBaseUrl();
const networkDebugEnabled = import.meta.env.DEV || import.meta.env.VITE_DEBUG_NETWORK === '1';

function writeNetworkDebugEntry(message: string, payload?: unknown) {
  if (typeof window === 'undefined') return;
  const stamp = new Date().toISOString().split('T')[1]?.replace('Z', '') ?? 'time';
  const payloadText = payload === undefined
    ? ''
    : ` ${JSON.stringify(payload, (_key, value) => (value instanceof Error ? value.message : value))}`;
  const next = `[${stamp}] ${message}${payloadText}`;
  const current = window.__networkDebugLogs ?? [];
  const merged = [...current, next].slice(-150);
  window.__networkDebugLogs = merged;
  window.dispatchEvent(new CustomEvent('network-debug-log', { detail: next }));
}

function networkDebugLog(message: string, payload?: unknown) {
  if (!networkDebugEnabled) return;
  if (payload === undefined) {
    console.log(`[network] ${message}`);
    writeNetworkDebugEntry(message);
    return;
  }
  console.log(`[network] ${message}`, payload);
  writeNetworkDebugEntry(message, payload);
}

const api = axios.create({
  baseURL: apiBaseUrl,
  headers: { 'Content-Type': 'application/json' },
});

networkDebugLog('api client initialized', {
  baseURL: apiBaseUrl,
  online: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
  origin: typeof window !== 'undefined' ? window.location.origin : undefined,
  userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
});

if (networkDebugEnabled) {
  axios
    .get(`${apiBaseUrl}/health`, { timeout: 10000 })
    .then((res) => {
      networkDebugLog('health probe success', { status: res.status, data: res.data });
    })
    .catch((error) => {
      networkDebugLog('health probe failed', {
        message: error?.message,
        code: error?.code,
        status: error?.response?.status,
        data: error?.response?.data,
      });
    });
}

// Request interceptor — attach JWT
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  networkDebugLog('request', {
    method: config.method,
    url: config.url,
    baseURL: config.baseURL,
    hasToken: Boolean(token),
    online: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
  });
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor — handle 401 + token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    networkDebugLog('response error', {
      message: error?.message,
      code: error?.code,
      status: error?.response?.status,
      url: originalRequest?.url,
      baseURL: originalRequest?.baseURL,
      data: error?.response?.data,
    });

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const refreshToken = useAuthStore.getState().refreshToken;
      if (refreshToken) {
        try {
          const { data } = await axios.post(`${apiBaseUrl}/auth/refresh`, { refreshToken });
          useAuthStore.getState().setTokens(data.accessToken, data.refreshToken);
          originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
          networkDebugLog('token refresh success');
          return api(originalRequest);
        } catch (refreshError) {
          networkDebugLog('token refresh failed', {
            message: (refreshError as any)?.message,
            status: (refreshError as any)?.response?.status,
            data: (refreshError as any)?.response?.data,
          });
          useAuthStore.getState().logout();
          redirectToLogin();
        }
      } else {
        networkDebugLog('missing refresh token after 401');
        useAuthStore.getState().logout();
        redirectToLogin();
      }
    }

    return Promise.reject(error);
  },
);

export default api;
