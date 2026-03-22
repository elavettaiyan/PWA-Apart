import axios from 'axios';
import { redirectToLogin } from './navigation';
import { getApiBaseUrl } from './platform';
import { useAuthStore } from '../store/authStore';

const api = axios.create({
  baseURL: getApiBaseUrl(),
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor — attach JWT
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor — handle 401 + token refresh + role sync
api.interceptors.response.use(
  (response) => {
    // Sync role if the server reports a different one (e.g. admin changed it)
    const serverRole = response.headers['x-user-role'];
    if (serverRole) {
      const store = useAuthStore.getState();
      if (store.user && store.user.role !== serverRole) {
        store.setUser({ ...store.user, role: serverRole });
      }
    }
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const refreshToken = useAuthStore.getState().refreshToken;
      if (refreshToken) {
        try {
          const { data } = await axios.post(`${getApiBaseUrl()}/auth/refresh`, { refreshToken });
          useAuthStore.getState().setTokens(data.accessToken, data.refreshToken);
          originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
          return api(originalRequest);
        } catch {
          useAuthStore.getState().logout();
          redirectToLogin();
        }
      } else {
        useAuthStore.getState().logout();
        redirectToLogin();
      }
    }

    return Promise.reject(error);
  },
);

export default api;
