import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard, Building2, Receipt, MessageSquareWarning,
  Wallet, ScrollText, BarChart3, LogOut, Menu, X, ChevronDown, User, Settings, KeyRound,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { cn } from '../../lib/utils';
import api from '../../lib/api';

const allNavigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard, roles: '*' as const },
  { name: 'Flats & Residents', href: '/flats', icon: Building2, roles: ['SUPER_ADMIN', 'ADMIN'] },
  { name: 'My Flat', href: '/my-flat', icon: Building2, roles: ['OWNER', 'TENANT'] },
  { name: 'Billing', href: '/billing', icon: Receipt, roles: '*' as const },
  { name: 'Complaints', href: '/complaints', icon: MessageSquareWarning, roles: '*' as const },
  { name: 'Expenses', href: '/expenses', icon: Wallet, roles: ['SUPER_ADMIN', 'ADMIN'] },
  { name: 'Association Bylaws', href: '/bylaws', icon: ScrollText, roles: '*' as const },
  { name: 'Reports', href: '/reports', icon: BarChart3, roles: ['SUPER_ADMIN', 'ADMIN'] },
  { name: 'Settings', href: '/settings', icon: Settings, roles: ['SUPER_ADMIN', 'ADMIN'] },
];

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

  return (
    <div className="min-h-screen flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 transform transition-transform lg:static lg:z-0 lg:translate-x-0',
          sidebarOpen ? 'block translate-x-0' : 'hidden -translate-x-full lg:block',
        )}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-100">
            <div className="w-9 h-9 bg-primary-600 rounded-xl flex items-center justify-center">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Resilynk</h1>
              <p className="text-[10px] text-gray-400 -mt-0.5 uppercase tracking-wider">Management</p>
            </div>
            <button className="lg:hidden ml-auto" onClick={() => setSidebarOpen(false)}>
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          {/* Nav Links */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
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
                    'w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all touch-manipulation',
                    isActive
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                  )}
                >
                  <item.icon className={cn('w-5 h-5 pointer-events-none', isActive ? 'text-primary-600' : 'text-gray-400')} />
                  <span className="pointer-events-none">{item.name}</span>
                </button>
              );
            })}
          </nav>

          {/* User Info */}
          <div className="border-t border-gray-100 p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-primary-100 rounded-full flex items-center justify-center">
                <User className="w-4 h-4 text-primary-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{user?.name}</p>
                <p className="text-xs text-gray-500 truncate">{user?.role?.replace('_', ' ')}</p>
              </div>
            </div>
            {societiesData?.societies?.length ? (
              <p className="mt-2 text-xs text-gray-400 truncate" title={societiesData.societies.find(s => s.id === user?.societyId)?.name}>
                {societiesData.societies.find(s => s.id === user?.societyId)?.name}
              </p>
            ) : null}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-200">
          <div className="flex items-center justify-between px-4 sm:px-6 py-3">
            <button
              className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-gray-100"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="w-5 h-5 text-gray-600" />
            </button>

            <div className="flex-1 flex items-center justify-end gap-3">
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
            </div>

            {/* Profile Dropdown */}
            <div className="relative">
              <button
                onClick={() => setProfileOpen(!profileOpen)}
                className="min-h-10 min-w-10 flex items-center gap-2 p-1.5 rounded-lg hover:bg-gray-100 transition touch-manipulation"
              >
                <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center pointer-events-none">
                  <span className="text-sm font-semibold text-primary-600">
                    {user?.name?.charAt(0).toUpperCase()}
                  </span>
                </div>
                <ChevronDown className="w-4 h-4 text-gray-400 hidden sm:block pointer-events-none" />
              </button>

              {profileOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setProfileOpen(false)} />
                  <div className="absolute right-0 mt-2 w-56 z-50 bg-white rounded-xl shadow-lg border border-gray-200 py-2">
                    <div className="px-4 py-2 border-b border-gray-100">
                      <p className="text-sm font-medium text-gray-900">{user?.name}</p>
                      <p className="text-xs text-gray-500">{user?.email}</p>
                    </div>
                    <button
                      onClick={() => {
                        setProfileOpen(false);
                        navigate('/settings/change-password');
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition"
                    >
                      <KeyRound className="w-4 h-4" />
                      Change Password
                    </button>
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition"
                    >
                      <LogOut className="w-4 h-4" />
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 sm:p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
