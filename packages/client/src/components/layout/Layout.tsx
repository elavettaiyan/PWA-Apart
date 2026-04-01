import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard, Building2, Receipt, MessageSquareWarning,
  Wallet, BarChart3, LogOut, Menu, X, Settings, KeyRound, Megaphone,
  ShieldCheck, ClipboardList,
} from 'lucide-react';
import { isNonSecurityServiceStaff, isSecurityServiceStaff } from '@/lib/serviceStaff';
import { useAuthStore } from '../../store/authStore';
import { cn } from '../../lib/utils';
import BrandMark from '../ui/BrandMark';
import api from '../../lib/api';
import { MenuVisibilityResponse, NavigationMenuId, SOCIETY_ADMINS } from '../../types';
import { getFallbackMenuVisibility, getVisibleMenuIdsForUser, getVisibleNavigationItemsForUser } from '../../lib/menuConfig';

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
  reports: BarChart3,
  settings: Settings,
};

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, logout, setUser, setTokens, setActiveSociety } = useAuthStore();
  const activeSocietyId = user?.activeSocietyId || user?.societyId || '';

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

  const switchSocietyMutation = useMutation({
    mutationFn: async (societyId: string) => (await api.post('/auth/switch-society', { societyId })).data,
    onSuccess: (data, societyId) => {
      setTokens(data.accessToken, data.refreshToken);
      setActiveSociety(societyId);
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

  const handleLogout = () => {
    queryClient.clear();
    logout();
    navigate('/login');
  };

  const effectiveMenuVisibility = menuVisibilityData || getFallbackMenuVisibility(activeSocietyId);
  const visibleNavigationItems = getVisibleNavigationItemsForUser(user, effectiveMenuVisibility);
  const visibleMenuIds = getVisibleMenuIdsForUser(user, effectiveMenuVisibility);
  const visibleMenuIdSet = new Set(visibleMenuIds);

  return (
    <div className="min-h-screen flex bg-background">
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
        <div className="flex flex-col h-full p-5 space-y-1">
          {/* Logo */}
          <div className="mb-6 px-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <BrandMark size={36} className="rounded-xl text-primary" />
              <div>
                <h1 className="font-headline font-extrabold text-primary text-xl tracking-tight">Dwell Hub</h1>
                <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mt-0.5">Apartment Console</p>
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
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile Top App Bar */}
        <header className="lg:hidden fixed top-0 z-30 w-full bg-white/95 backdrop-blur-xl shadow-card">
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
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{user?.role?.replace('_', ' ')}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
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
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mt-1">{user?.role?.replace('_', ' ')}</p>
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

              {/* Settings gear */}
              {visibleMenuIdSet.has('settings') && (
                <button
                  onClick={() => navigate('/settings')}
                  className="p-2 rounded-xl text-slate-400 hover:text-primary hover:bg-primary/5 transition-colors"
                >
                  <Settings className="w-5 h-5" />
                </button>
              )}

              {/* Profile Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setProfileOpen(!profileOpen)}
                  className="min-h-10 min-w-10 flex items-center gap-3 pl-4 border-l border-slate-100 hover:opacity-80 transition touch-manipulation"
                >
                  <div className="text-right">
                    <p className="text-sm font-semibold text-on-surface">{user?.name}</p>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">{user?.role?.replace('_', ' ')}</p>
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
        <main className="flex-1 pt-20 pb-6 px-4 sm:px-6 lg:pt-0 lg:pb-0 lg:p-8 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
