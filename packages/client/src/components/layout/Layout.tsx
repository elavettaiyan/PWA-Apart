import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard, Building2, Receipt, MessageSquareWarning,
  Wallet, BarChart3, LogOut, Menu, X, Settings, KeyRound, Megaphone,
  ShieldCheck, ClipboardList, Box, UserCircle2, RefreshCw,
} from 'lucide-react';
import { isNonSecurityServiceStaff, isSecurityServiceStaff } from '@/lib/serviceStaff';
import { useAuthStore } from '../../store/authStore';
import { cn } from '../../lib/utils';
import BrandMark from '../ui/BrandMark';
import NotificationBell from './NotificationBell';
import TrialBanner from './TrialBanner';
import api from '../../lib/api';
import { MenuVisibilityResponse, NavigationMenuId, SOCIETY_ADMINS } from '../../types';
import { getFallbackMenuVisibility, getVisibleMenuIdsForUser, getVisibleNavigationItemsForUser } from '../../lib/menuConfig';
import { canUseOwnerView, getDisplayUserForView, getRoleDisplayLabel, getRoleViewLabel, isOwnerViewActive, type AppViewMode } from '../../lib/ownerView';

const navigationIcons: Record<NavigationMenuId, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  community: Megaphone,
  flats: Building2,
  'my-flat': Building2,
  billing: Receipt,
  complaints: MessageSquareWarning,
  'gate-management': ShieldCheck,
  'entry-activity': ClipboardList,
  expenses: Wallet,
  assets: Box,
  reports: BarChart3,
  settings: Settings,
};

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const PULL_THRESHOLD = 72;
  const MAX_PULL_DISTANCE = 108;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullToRefreshEnabled, setPullToRefreshEnabled] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mainRef = useRef<HTMLElement | null>(null);
  const pullStartYRef = useRef<number | null>(null);
  const pullDistanceRef = useRef(0);
  const { user, viewMode, logout, setUser, setTokens, setViewMode } = useAuthStore();
  const activeSocietyId = user?.activeSocietyId || user?.societyId || '';
  const displayUser = getDisplayUserForView(user, viewMode);
  const canSwitchOwnerView = canUseOwnerView(user);
  const roleDisplayLabel = getRoleDisplayLabel(user, viewMode);
  const roleViewLabel = getRoleViewLabel(user);

  const { data: societiesData } = useQuery<{ activeSocietyId?: string; societies: Array<{ id: string; name: string; role?: string }> }>({
    queryKey: ['my-societies'],
    queryFn: async () => (await api.get('/auth/my-societies')).data,
    enabled: !!user,
  });

  const { data: menuVisibilityData } = useQuery<MenuVisibilityResponse>({
    queryKey: ['menu-visibility', activeSocietyId],
    queryFn: async () => (await api.get('/settings/menu-visibility')).data,
    enabled: !!user && user.role !== 'SUPER_ADMIN' && user.role !== 'SERVICE_STAFF',
    placeholderData: () => getFallbackMenuVisibility(activeSocietyId),
    retry: false,
  });

  const hasSocietySwitcher = (societiesData?.societies?.length || 0) > 1;
  const mobileSpacerHeight = hasSocietySwitcher
    ? 'calc(8.75rem + var(--sat))'
    : 'calc(5rem + var(--sat))';

  const switchSocietyMutation = useMutation({
    mutationFn: async (societyId: string) => (await api.post('/auth/switch-society', { societyId })).data,
    onSuccess: (data, societyId) => {
      setTokens(data.accessToken, data.refreshToken);
      if (user) {
        setUser({
          ...user,
          ...(data?.user || {}),
          societyId,
          activeSocietyId: societyId,
        });
      }
      queryClient.removeQueries({
        predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] !== 'my-societies',
      });
      if (location.pathname === '/my-flat') {
        navigate('/my-flat', { replace: true });
      }
    },
  });

  useEffect(() => {
    setSidebarOpen(false);
    setProfileOpen(false);
  }, [location.key]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(pointer: coarse)');
    const update = () => setPullToRefreshEnabled(mediaQuery.matches);

    update();
    mediaQuery.addEventListener?.('change', update);

    return () => mediaQuery.removeEventListener?.('change', update);
  }, []);

  const resetPullState = () => {
    pullStartYRef.current = null;
    pullDistanceRef.current = 0;
    setPullDistance(0);
    setIsPulling(false);
  };

  const handlePullRefresh = async () => {
    setIsRefreshing(true);
    setPullDistance(PULL_THRESHOLD * 0.65);

    try {
      await queryClient.refetchQueries({ type: 'active' });
    } finally {
      setIsRefreshing(false);
      resetPullState();
    }
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    if (!pullToRefreshEnabled || isRefreshing || sidebarOpen || profileOpen || event.touches.length !== 1) {
      return;
    }

    const mainElement = mainRef.current;
    if (!mainElement || mainElement.scrollTop > 0) {
      return;
    }

    pullStartYRef.current = event.touches[0].clientY;
    setIsPulling(true);
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLElement>) => {
    if (!isPulling || pullStartYRef.current === null || isRefreshing) {
      return;
    }

    const mainElement = mainRef.current;
    if (!mainElement || mainElement.scrollTop > 0) {
      resetPullState();
      return;
    }

    const rawDistance = event.touches[0].clientY - pullStartYRef.current;
    if (rawDistance <= 0) {
      pullDistanceRef.current = 0;
      setPullDistance(0);
      return;
    }

    const nextDistance = Math.min(rawDistance * 0.45, MAX_PULL_DISTANCE);
    pullDistanceRef.current = nextDistance;
    setPullDistance(nextDistance);
  };

  const handleTouchEnd = async () => {
    if (!isPulling || isRefreshing) {
      return;
    }

    setIsPulling(false);

    if (pullDistanceRef.current >= PULL_THRESHOLD) {
      await handlePullRefresh();
      return;
    }

    resetPullState();
  };

  const pullProgress = Math.min(pullDistance / PULL_THRESHOLD, 1);
  const showPullIndicator = pullToRefreshEnabled && (pullDistance > 0 || isRefreshing);
  const pullIndicatorLabel = isRefreshing
    ? 'Refreshing...'
    : pullProgress >= 1
      ? 'Release to refresh'
      : 'Pull to refresh';

  const handleLogout = () => {
    queryClient.clear();
    logout();
    navigate('/login');
  };

  const handleViewModeChange = (nextViewMode: AppViewMode) => {
    setViewMode(nextViewMode);
    setProfileOpen(false);
    navigate('/', { replace: true });
  };

  const effectiveMenuVisibility = menuVisibilityData || getFallbackMenuVisibility(activeSocietyId);
  const visibleNavigationItems = getVisibleNavigationItemsForUser(displayUser, effectiveMenuVisibility);
  const visibleMenuIds = getVisibleMenuIdsForUser(displayUser, effectiveMenuVisibility);
  const visibleMenuIdSet = new Set(visibleMenuIds);
  const nextViewMode = isOwnerViewActive(user, viewMode) ? 'ADMIN_VIEW' : 'OWNER_VIEW';
  const viewModeSwitcher = canSwitchOwnerView ? (
    <div className="inline-flex rounded-2xl bg-slate-100 p-1 text-xs font-semibold text-slate-500">
      <button
        type="button"
        onClick={() => handleViewModeChange('OWNER_VIEW')}
        className={cn(
          'rounded-xl px-3 py-1.5 transition-colors',
          isOwnerViewActive(user, viewMode) ? 'bg-white text-primary shadow-sm' : 'hover:text-on-surface',
        )}
      >
        Owner View
      </button>
      <button
        type="button"
        onClick={() => handleViewModeChange('ADMIN_VIEW')}
        className={cn(
          'rounded-xl px-3 py-1.5 transition-colors',
          viewMode === 'ADMIN_VIEW' ? 'bg-white text-primary shadow-sm' : 'hover:text-on-surface',
        )}
      >
        {roleViewLabel}
      </button>
    </div>
  ) : null;

  return (
    <div className="flex h-dvh min-h-screen overflow-hidden bg-background">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — Clean white design (desktop & mobile drawer) */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-72 max-w-[88vw] bg-white border-r border-slate-100 flex flex-col transform transition-transform lg:static lg:z-0 lg:translate-x-0',
          sidebarOpen ? 'block translate-x-0' : 'hidden -translate-x-full lg:block',
        )}
      >
        <div className="flex flex-col h-full p-5 space-y-1" style={{ paddingTop: 'calc(1.25rem + var(--sat))' }}>
          {/* Logo */}
          <div className="mb-6 px-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <BrandMark size={36} className="rounded-xl text-primary" />
              <div>
                <h1 className="font-headline font-extrabold text-primary text-xl tracking-tight">Dwell Hub</h1>
                <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mt-0.5">Community Console</p>
              </div>
            </div>
            <button className="lg:hidden p-1 rounded-lg hover:bg-slate-50" onClick={() => setSidebarOpen(false)}>
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>

          {/* Nav Links */}
          <nav className="flex-1 space-y-0.5 overflow-y-auto hide-scrollbar">
            {visibleNavigationItems.map((item) => {
              const isActive = location.pathname === item.href ||
                (item.href !== '/' && location.pathname.startsWith(item.href));
              const Icon = navigationIcons[item.id];
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSidebarOpen(false);
                    navigate(item.href);
                  }}
                  className={cn(
                    'w-full text-left flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 touch-manipulation',
                    isActive
                      ? 'bg-primary/10 text-primary font-semibold'
                      : 'text-slate-500 hover:bg-slate-50 hover:text-on-surface',
                  )}
                >
                  <div className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center',
                    isActive ? 'bg-primary text-white' : 'bg-slate-100 text-slate-400'
                  )}>
                    <Icon className="w-4 h-4 pointer-events-none" />
                  </div>
                  <span className="pointer-events-none">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Bottom Actions */}
          <div className="pt-4 border-t border-slate-100 space-y-1">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors text-sm"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Mobile Top App Bar */}
        <header className="lg:hidden fixed top-0 z-30 w-full bg-white/95 backdrop-blur-xl shadow-card" style={{ paddingTop: 'var(--sat)' }}>
          <div className="flex justify-between items-center px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              className="p-1.5 -ml-1 rounded-xl hover:bg-slate-50"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="w-5 h-5 text-slate-500" />
            </button>
            <div>
              <span className="font-headline text-lg font-bold tracking-tight text-primary block leading-none">Dwell Hub</span>
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{roleDisplayLabel}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <NotificationBell compact />
            {canSwitchOwnerView && (
              <button
                type="button"
                onClick={() => handleViewModeChange(nextViewMode)}
                className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center touch-manipulation transition-colors hover:bg-slate-200 hover:text-on-surface"
                aria-label={isOwnerViewActive(user, viewMode) ? `Switch to ${roleViewLabel}` : 'Switch to Owner View'}
                title={isOwnerViewActive(user, viewMode) ? `Switch to ${roleViewLabel}` : 'Switch to Owner View'}
              >
                {isOwnerViewActive(user, viewMode) ? (
                  <Building2 className="w-4.5 h-4.5" />
                ) : (
                  <UserCircle2 className="w-4.5 h-4.5" />
                )}
              </button>
            )}
            <button
              onClick={() => setProfileOpen(!profileOpen)}
              className="w-9 h-9 bg-primary/10 rounded-full flex items-center justify-center ring-2 ring-primary/10 touch-manipulation"
            >
              <span className="text-xs font-bold text-primary">
                {user?.name?.charAt(0).toUpperCase()}
              </span>
            </button>
          </div>
          </div>
          {(societiesData?.societies?.length || 0) > 1 && (
            <div className="px-4 pb-3">
              <select
                className="select text-xs w-full py-2 rounded-xl"
                value={user?.societyId || societiesData?.activeSocietyId || ''}
                onChange={(e) => switchSocietyMutation.mutate(e.target.value)}
                disabled={switchSocietyMutation.isPending}
              >
                {societiesData?.societies.map((society) => (
                  <option key={society.id} value={society.id}>{society.name}</option>
                ))}
              </select>
            </div>
          )}
          {/* Mobile profile dropdown */}
          {profileOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setProfileOpen(false)} />
              <div className="absolute right-4 top-14 w-64 z-50 bg-white rounded-2xl py-2 shadow-elevated">
                <div className="px-4 py-3 border-b border-slate-100">
                  <p className="text-sm font-bold text-on-surface">{user?.name}</p>
                  <p className="text-xs text-slate-400">{user?.email}</p>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mt-1">{roleDisplayLabel}</p>
                  {societiesData?.societies?.length ? (
                    <p className="text-xs text-slate-500 mt-1 truncate">
                      {societiesData.societies.find(s => s.id === user?.societyId)?.name}
                    </p>
                  ) : null}
                </div>
                <button
                  onClick={() => {
                    setProfileOpen(false);
                    navigate('/settings/change-password');
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-on-surface hover:bg-slate-50 transition"
                >
                  <KeyRound className="w-4 h-4" />
                  Change Password
                </button>
                <button
                  onClick={() => { setProfileOpen(false); navigate('/settings'); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-on-surface hover:bg-slate-50 transition"
                >
                  <UserCircle2 className="w-4 h-4" />
                  Account
                </button>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition"
                >
                  <LogOut className="w-4 h-4" />
                  Sign out
                </button>
              </div>
            </>
          )}
        </header>

        {/* Desktop Top App Bar — clean & minimal */}
        <header className="hidden lg:block sticky top-0 z-30 bg-white/90 backdrop-blur-xl border-b border-slate-100/60">
          <div className="flex items-center justify-end px-8 py-3">
            <div className="flex items-center gap-4">
              {(societiesData?.societies?.length || 0) > 1 && (
                <select
                  className="select w-56 py-2 text-sm"
                  value={user?.societyId || societiesData?.activeSocietyId || ''}
                  onChange={(e) => switchSocietyMutation.mutate(e.target.value)}
                  disabled={switchSocietyMutation.isPending}
                >
                  {societiesData?.societies.map((society) => (
                    <option key={society.id} value={society.id}>{society.name}</option>
                  ))}
                </select>
              )}

              {viewModeSwitcher}

              {/* Settings gear */}
              {visibleMenuIdSet.has('settings') && (
                <button
                  onClick={() => navigate('/settings')}
                  className="p-2 rounded-xl text-slate-400 hover:text-primary hover:bg-primary/5 transition-colors"
                >
                  <Settings className="w-5 h-5" />
                </button>
              )}

              <NotificationBell />

              {/* Profile Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setProfileOpen(!profileOpen)}
                  className="min-h-10 min-w-10 flex items-center gap-3 pl-4 border-l border-slate-100 hover:opacity-80 transition touch-manipulation"
                >
                  <div className="text-right">
                    <p className="text-sm font-semibold text-on-surface">{user?.name}</p>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">{roleDisplayLabel}</p>
                  </div>
                    <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center ring-2 ring-primary/10">
                    <span className="text-sm font-bold text-primary">
                      {user?.name?.charAt(0).toUpperCase()}
                    </span>
                  </div>
                </button>

                {profileOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setProfileOpen(false)} />
                    <div className="absolute right-0 mt-2 w-56 z-50 bg-white rounded-2xl py-2 shadow-elevated">
                      <div className="px-4 py-3 border-b border-slate-100">
                        <p className="text-sm font-semibold text-on-surface">{user?.name}</p>
                        <p className="text-xs text-slate-400">{user?.email}</p>
                        <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mt-1">{roleDisplayLabel}</p>
                        {societiesData?.societies?.length ? (
                          <p className="text-xs text-slate-500 mt-1 truncate">
                            {societiesData.societies.find(s => s.id === user?.societyId)?.name}
                          </p>
                        ) : null}
                      </div>
                      {canSwitchOwnerView && (
                        <button
                          onClick={() => handleViewModeChange(isOwnerViewActive(user, viewMode) ? 'ADMIN_VIEW' : 'OWNER_VIEW')}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-on-surface hover:bg-slate-50 transition"
                        >
                          <Building2 className="w-4 h-4" />
                          {isOwnerViewActive(user, viewMode) ? `Switch to ${roleViewLabel}` : 'Switch to Owner View'}
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setProfileOpen(false);
                          navigate('/settings/change-password');
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-on-surface hover:bg-slate-50 transition"
                      >
                        <KeyRound className="w-4 h-4" />
                        Change Password
                      </button>
                      <button
                        onClick={() => { setProfileOpen(false); navigate('/settings'); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-on-surface hover:bg-slate-50 transition"
                      >
                        <UserCircle2 className="w-4 h-4" />
                        Account
                      </button>
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition"
                      >
                        <LogOut className="w-4 h-4" />
                        Sign out
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        {/* Mobile spacer: pushes content below the fixed mobile header (which is out of document flow) */}
        <div className="lg:hidden shrink-0" style={{ height: mobileSpacerHeight }} aria-hidden="true" />
        <TrialBanner />
        <div className="relative flex min-h-0 flex-1 flex-col">
          {showPullIndicator ? (
            <div
              className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center px-4"
              style={{
                paddingTop: '0.75rem',
                transform: `translateY(${Math.max(pullDistance - 40, 0)}px)`,
              }}
              aria-live="polite"
            >
              <div className="inline-flex items-center gap-2 rounded-full bg-white/95 px-3 py-2 text-xs font-semibold text-slate-500 shadow-card ring-1 ring-slate-200/80 backdrop-blur">
                <RefreshCw
                  className={cn('h-3.5 w-3.5 text-primary', isRefreshing && 'animate-spin')}
                  style={isRefreshing ? undefined : { transform: `rotate(${pullProgress * 180}deg)` }}
                />
                <span>{pullIndicatorLabel}</span>
              </div>
            </div>
          ) : null}

          <main
            ref={mainRef}
            className="flex-1 min-h-0 overflow-y-auto px-4 pb-6 sm:px-6 lg:p-8 lg:pb-0"
            style={{ overscrollBehaviorY: 'contain' }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={resetPullState}
          >
            <div
              className={cn(!isPulling && 'transition-transform duration-200 ease-out')}
              style={pullDistance ? { transform: `translateY(${pullDistance}px)` } : undefined}
            >
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
