import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { appStorage } from '../lib/storage';
import { getDefaultViewMode, normalizeViewMode, type AppViewMode } from '../lib/ownerView';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  viewMode: AppViewMode;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  _hydrated: boolean;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setUser: (user: User) => void;
  setViewMode: (viewMode: AppViewMode) => void;
  setActiveSociety: (societyId: string) => void;
  logout: () => void;
}

function hasCompleteSession(state: Pick<AuthState, 'user' | 'accessToken' | 'refreshToken' | 'isAuthenticated'>) {
  return Boolean(state.isAuthenticated && state.user && state.accessToken && state.refreshToken);
}

function getLoggedOutState() {
  return {
    user: null,
    viewMode: 'ADMIN_VIEW' as AppViewMode,
    accessToken: null,
    refreshToken: null,
    isAuthenticated: false,
  };
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      viewMode: 'ADMIN_VIEW',
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      _hydrated: false,

      setAuth: (user, accessToken, refreshToken) =>
        set({
          user,
          viewMode: getDefaultViewMode(user),
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
        set((state) => {
          const previousSocietyId = state.user?.activeSocietyId || state.user?.societyId || '';
          const nextSocietyId = user.activeSocietyId || user.societyId || '';
          const shouldDefaultToOwnerView = Boolean(
            user.canUseOwnerView && (!state.user?.canUseOwnerView || previousSocietyId !== nextSocietyId),
          );

          return {
            user,
            viewMode: shouldDefaultToOwnerView ? 'OWNER_VIEW' : normalizeViewMode(user, state.viewMode),
            isAuthenticated: Boolean(user && state.accessToken && state.refreshToken),
          };
        }),

      setViewMode: (viewMode) =>
        set((state) => ({
          viewMode: normalizeViewMode(state.user, viewMode),
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
        viewMode: state.viewMode,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (_, error) => {
        if (!error) {
          const snapshot = useAuthStore.getState();
          if (!hasCompleteSession(snapshot)) {
            useAuthStore.setState(getLoggedOutState());
          } else {
            useAuthStore.setState({ viewMode: normalizeViewMode(snapshot.user, snapshot.viewMode) });
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
