import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard, Building2, Receipt, MessageSquareWarning,
  Wallet, ScrollText, BarChart3, LogOut, Menu, X, ChevronDown, User, Settings, KeyRound,
  HelpCircle, Plus, CreditCard, Wrench,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { cn } from '../../lib/utils';
import api from '../../lib/api';
import { SOCIETY_ADMINS, SOCIETY_MANAGERS, FINANCIAL_ROLES } from '../../types';

const allNavigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard, roles: '*' as const },
  { name: 'Flats & Residents', href: '/flats', icon: Building2, roles: ['SUPER_ADMIN', ...SOCIETY_MANAGERS] },
  { name: 'My Flat', href: '/my-flat', icon: Building2, roles: ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER', 'OWNER', 'TENANT', 'SERVICE_STAFF'] },
  { name: 'Billing', href: '/billing', icon: Receipt, roles: '*' as const },
  { name: 'Complaints', href: '/complaints', icon: MessageSquareWarning, roles: '*' as const },
  { name: 'Expenses', href: '/expenses', icon: Wallet, roles: ['SUPER_ADMIN', ...FINANCIAL_ROLES] },
  { name: 'Association Bylaws', href: '/bylaws', icon: ScrollText, roles: '*' as const },
  { name: 'Reports', href: '/reports', icon: BarChart3, roles: ['SUPER_ADMIN', ...FINANCIAL_ROLES] },
  { name: 'Settings', href: '/settings', icon: Settings, roles: ['SUPER_ADMIN', ...SOCIETY_ADMINS] },
  { name: 'Manage Staff', href: '/staff', icon: User, roles: ['SUPER_ADMIN', ...SOCIETY_ADMINS] },
];

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [barsVisible, setBarsVisible] = useState(true);
  const lastScrollY = useRef(0);
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, logout, setUser, setTokens, setActiveSociety } = useAuthStore();

  // Hide mobile header & bottom nav on scroll down, show on scroll up
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      if (y < 10) { setBarsVisible(true); }
      else if (y > lastScrollY.current + 5) { setBarsVisible(false); }
      else if (y < lastScrollY.current - 5) { setBarsVisible(true); }
      lastScrollY.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const { data: societiesData } = useQuery<{ activeSocietyId?: string; societies: Array<{ id: string; name: string; role?: string }> }>({
    queryKey: ['my-societies'],
    queryFn: async () => (await api.get('/auth/my-societies')).data,
    enabled: !!user,
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

  // Mobile bottom nav items — role-aware
  const isResident = ['OWNER', 'TENANT'].includes(user?.role || '');
  const bottomNavItems = isResident
    ? [
        { name: 'Hub', href: '/', icon: 'grid_view', filled: true },
        { name: 'Payments', href: '/billing', icon: 'account_balance_wallet', filled: false },
        { name: 'Service', href: '/complaints', icon: 'construction', filled: false },
        { name: 'Profile', href: '/settings', icon: 'person', filled: false },
      ]
    : [
        { name: 'Hub', href: '/', icon: 'grid_view', filled: true },
        { name: 'Billing', href: '/billing', icon: 'receipt_long', filled: false },
        { name: 'Residents', href: '/flats', icon: 'group', filled: false },
        { name: 'More', href: '/settings', icon: 'menu', filled: false },
      ];

  return (
    <div className="min-h-screen flex bg-background">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-on-surface/30 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — Editorial Design (desktop & mobile drawer) */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 bg-primary flex flex-col transform transition-transform lg:static lg:z-0 lg:translate-x-0',
          sidebarOpen ? 'block translate-x-0' : 'hidden -translate-x-full lg:block',
        )}
      >
        <div className="flex flex-col h-full p-6 space-y-2">
          {/* Logo */}
          <div className="mb-10 px-2 flex items-center justify-between">
            <div>
              <h1 className="font-headline font-extrabold text-white text-2xl tracking-tight">Dwell Hub</h1>
              <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest mt-1">Management Portal</p>
            </div>
            <button className="lg:hidden" onClick={() => setSidebarOpen(false)}>
              <X className="w-5 h-5 text-white/60" />
            </button>
          </div>

          {/* Nav Links */}
          <nav className="flex-1 space-y-1 overflow-y-auto hide-scrollbar">
            {allNavigation
              .filter((item) => item.roles === '*' || item.roles.includes(user?.role || ''))
              .map((item) => {
              const isActive = location.pathname === item.href ||
                (item.href !== '/' && location.pathname.startsWith(item.href));
              return (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => {
                    setSidebarOpen(false);
                    navigate(item.href);
                  }}
                  className={cn(
                    'w-full text-left flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 touch-manipulation',
                    isActive
                      ? 'bg-white/15 text-white font-semibold'
                      : 'text-white/60 hover:bg-white/10 hover:translate-x-1',
                  )}
                >
                  <item.icon className={cn('w-5 h-5 pointer-events-none', isActive ? 'text-white' : 'text-white/40')} />
                  <span className="pointer-events-none">{item.name}</span>
                </button>
              );
            })}
          </nav>

          {/* Bottom Actions */}
          <div className="pt-6 border-t border-white/10 space-y-1">
            {/* <button
              onClick={() => navigate('/complaints')}
              className="w-full bg-white text-primary font-bold py-3 rounded-xl mb-4 flex items-center justify-center gap-2 hover:bg-white/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>New Request</span>
            </button> */}
            <button
              onClick={() => navigate('/settings')}
              className="w-full flex items-center gap-3 px-4 py-2 text-white/40 hover:text-white transition-colors text-sm"
            >
              <HelpCircle className="w-5 h-5" />
              <span>Help Center</span>
            </button>
            {/* <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-2 text-white/40 hover:text-rose-300 transition-colors text-sm"
            >
              <LogOut className="w-5 h-5" />
              <span>Logout</span>
            </button> */}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile Top App Bar */}
        <header className={cn(
          'lg:hidden fixed top-0 z-30 w-full flex justify-between items-center px-5 py-3 bg-surface/80 backdrop-blur-xl transition-transform duration-300',
          barsVisible ? 'translate-y-0' : '-translate-y-full',
        )}>
          <div className="flex items-center gap-3">
            <button
              className="p-1.5 -ml-1 rounded-lg hover:bg-surface-container"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="w-5 h-5 text-on-surface-variant" />
            </button>
            <span className="font-headline text-xl font-bold tracking-tight text-primary">Dwell Hub</span>
          </div>
          <div className="flex items-center gap-3">
            {(societiesData?.societies?.length || 0) > 1 && (
              <select
                className="select text-xs w-32 py-1.5 rounded-lg"
                value={user?.societyId || societiesData?.activeSocietyId || ''}
                onChange={(e) => switchSocietyMutation.mutate(e.target.value)}
                disabled={switchSocietyMutation.isPending}
              >
                {societiesData?.societies.map((society) => (
                  <option key={society.id} value={society.id}>{society.name}</option>
                ))}
              </select>
            )}
            <button className="text-on-surface-variant hover:text-primary transition-colors relative p-1">
              <span className="material-symbols-outlined text-2xl">notifications</span>
              <span className="absolute top-0.5 right-0.5 bg-error w-2 h-2 rounded-full border-2 border-surface"></span>
            </button>
          </div>
        </header>

        {/* Desktop Top App Bar — glassmorphism */}
        <header className="hidden lg:block sticky top-0 z-30 bg-surface-container-lowest/80 backdrop-blur-xl">
          <div className="flex items-center justify-between px-8 py-4">
            <div className="flex items-center gap-4">
              {/* Search Bar */}
              {/* <div className="flex items-center bg-surface-container-low rounded-full px-4 py-2 w-96">
                <span className="material-symbols-outlined text-outline mr-2 text-xl">search</span>
                <input
                  className="bg-transparent border-none focus:ring-0 focus:outline-none text-sm w-full placeholder:text-outline text-on-surface"
                  placeholder="Search residents, bills, or units..."
                  type="text"
                />
              </div> */}
            </div>

            <div className="flex items-center gap-4">
              {(societiesData?.societies?.length || 0) > 1 && (
                <select
                  className="select w-56"
                  value={user?.societyId || societiesData?.activeSocietyId || ''}
                  onChange={(e) => switchSocietyMutation.mutate(e.target.value)}
                  disabled={switchSocietyMutation.isPending}
                >
                  {societiesData?.societies.map((society) => (
                    <option key={society.id} value={society.id}>{society.name}</option>
                  ))}
                </select>
              )}

              {/* Notifications */}
              <button className="text-outline hover:text-primary transition-colors relative">
                <span className="material-symbols-outlined">notifications</span>
                <span className="absolute -top-1 -right-1 bg-error w-2 h-2 rounded-full border-2 border-surface-container-lowest"></span>
              </button>

              {/* Settings gear */}
              <button
                onClick={() => navigate('/settings')}
                className="text-outline hover:text-primary transition-colors"
              >
                <span className="material-symbols-outlined">settings</span>
              </button>

              {/* Profile Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setProfileOpen(!profileOpen)}
                  className="min-h-10 min-w-10 flex items-center gap-3 pl-4 border-l border-outline-variant/30 hover:opacity-80 transition touch-manipulation"
                >
                  <div className="text-right">
                    <p className="text-sm font-bold text-primary">{user?.name}</p>
                    <p className="text-[10px] text-outline uppercase tracking-widest font-bold">{user?.role?.replace('_', ' ')}</p>
                  </div>
                  <div className="w-10 h-10 bg-secondary-container rounded-full flex items-center justify-center ring-2 ring-primary/10">
                    <span className="text-sm font-bold text-on-secondary-container">
                      {user?.name?.charAt(0).toUpperCase()}
                    </span>
                  </div>
                </button>

                {profileOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setProfileOpen(false)} />
                    <div className="absolute right-0 mt-2 w-56 z-50 bg-surface-container-lowest rounded-2xl editorial-shadow py-2">
                      <div className="px-4 py-3 border-b border-outline-variant/15">
                        <p className="text-sm font-bold text-primary">{user?.name}</p>
                        <p className="text-xs text-outline">{user?.email}</p>
                        {societiesData?.societies?.length ? (
                          <p className="text-xs text-on-surface-variant mt-1 truncate">
                            {societiesData.societies.find(s => s.id === user?.societyId)?.name}
                          </p>
                        ) : null}
                      </div>
                      <button
                        onClick={() => {
                          setProfileOpen(false);
                          navigate('/settings/change-password');
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-on-surface hover:bg-surface-container-low transition"
                      >
                        <KeyRound className="w-4 h-4" />
                        Change Password
                      </button>
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-error hover:bg-error-container/30 transition"
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

        {/* Page Content — mobile: extra top/bottom padding for fixed bars */}
        <main className="flex-1 pt-16 pb-24 px-4 sm:px-6 lg:pt-0 lg:pb-0 lg:p-8 overflow-auto">{children}</main>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav className={cn(
        'lg:hidden fixed bottom-0 left-0 right-0 z-50 flex justify-around items-center px-4 pt-2 pb-3 mobile-bottom-safe bg-surface/80 backdrop-blur-xl rounded-t-3xl shadow-[0_-4px_20px_0_rgba(0,0,0,0.04)] border-t border-on-surface/5 transition-transform duration-300',
        barsVisible ? 'translate-y-0' : 'translate-y-full',
      )}>
        {bottomNavItems.map((item) => {
          const isActive = location.pathname === item.href ||
            (item.href !== '/' && location.pathname.startsWith(item.href));
          return (
            <button
              key={item.name}
              onClick={() => navigate(item.href)}
              className={cn(
                'flex flex-col items-center justify-center px-4 py-1.5 rounded-2xl transition-all duration-300 touch-manipulation',
                isActive
                  ? 'bg-primary text-on-primary'
                  : 'text-on-surface hover:bg-surface-container',
              )}
            >
              <span
                className="material-symbols-outlined text-xl mb-0.5"
                style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
              >
                {item.icon}
              </span>
              <span className="text-[10px] uppercase tracking-wider font-bold">{item.name}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
