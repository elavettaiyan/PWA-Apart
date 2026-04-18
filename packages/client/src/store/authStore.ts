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

function hasCompleteSession(state: Pick<AuthState, 'user' | 'accessToken' | 'refreshToken' | 'isAuthenticated'>) {
  return Boolean(state.isAuthenticated && state.user && state.accessToken && state.refreshToken);
}

function getLoggedOutState() {
  return {
    user: null,
    accessToken: null,
    refreshToken: null,
    isAuthenticated: false,
  };
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
        set({
          user,
          accessToken,
          refreshToken,
          isAuthenticated: Boolean(user && accessToken && refreshToken),
        }),

      setTokens: (accessToken, refreshToken) =>
        set((state) => ({
          accessToken,
          refreshToken,
          isAuthenticated: Boolean(state.user && accessToken && refreshToken),
        })),

      setUser: (user) =>
        set((state) => ({
          user,
          isAuthenticated: Boolean(user && state.accessToken && state.refreshToken),
        })),

      setActiveSociety: (societyId) =>
        set((state) => ({
          user: state.user
            ? {
                ...state.user,
                societyId,
                activeSocietyId: societyId,
              }
            : null,
          isAuthenticated: Boolean(state.user && state.accessToken && state.refreshToken),
        })),

      logout: () =>
        set(getLoggedOutState()),
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
          const snapshot = useAuthStore.getState();
          if (!hasCompleteSession(snapshot)) {
            useAuthStore.setState(getLoggedOutState());
          }
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
