import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { appStorage } from '../lib/storage';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  _hydrated: boolean;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setUser: (user: User) => void;
  setActiveSociety: (societyId: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      _hydrated: false,

      setAuth: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken, isAuthenticated: true }),

      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken }),

      setUser: (user) =>
        set({ user }),

      setActiveSociety: (societyId) =>
        set((state) => ({
          user: state.user
            ? {
                ...state.user,
                societyId,
                activeSocietyId: societyId,
              }
            : null,
        })),

      logout: () =>
        set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false }),
    }),
    {
      name: 'apart-auth',
      storage: appStorage,
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (_, error) => {
        if (!error) {
          useAuthStore.setState({ _hydrated: true });
        }
      },
    },
  ),
);

// Always mark hydrated: handles both sync (web/localStorage) and async (native/Preferences)
if (useAuthStore.persist.hasHydrated()) {
  useAuthStore.setState({ _hydrated: true });
} else {
  const unsub = useAuthStore.persist.onFinishHydration(() => {
    useAuthStore.setState({ _hydrated: true });
    unsub();
  });
}

// Absolute safety net: if nothing worked after 2s, force hydration to unblock the UI
setTimeout(() => {
  if (!useAuthStore.getState()._hydrated) {
    useAuthStore.setState({ _hydrated: true });
  }
}, 2000);
