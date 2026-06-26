import { useQuery } from '@tanstack/react-query';
import {
  Building2, Users, MessageSquareWarning, Receipt,
  Shield,
  ChevronRight,
  DatabaseZap,
  CreditCard,
  CheckCircle2,
  ClipboardList,
  TrendingUp,
  Megaphone,
  CalendarDays,
  UserRound,
  Package,
} from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { PageLoader } from '../../components/ui/Loader';
import { getDefaultAuthenticatedRoute } from '../../lib/serviceStaff';
import { useAuthStore } from '../../store/authStore';
import { getDisplayUserForView } from '../../lib/ownerView';
import type { DashboardData } from '../../types';
import { FINANCIAL_ROLES, SOCIETY_ADMINS } from '../../types';

export default function DashboardPage() {
  const { user, viewMode } = useAuthStore();
  const displayUser = getDisplayUserForView(user, viewMode);
  const isSuperAdmin = displayUser?.role === 'SUPER_ADMIN';
  const isManager = FINANCIAL_ROLES.includes(displayUser?.role as any);
  const defaultRoute = getDefaultAuthenticatedRoute(user);

  if (defaultRoute !== '/') {
    return <Navigate to={defaultRoute} replace />;
  }

  if (isSuperAdmin) return <SuperAdminDashboard />;
  if (isManager) return <AdminDashboard />;
  return <ResidentDashboard />;
}

function Greeting({ name }: { name?: string }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return (
    <p className="text-on-surface-variant text-sm font-body">
      {greeting}{name ? `, ${name.split(' ')[0]}` : ''}
    </p>
  );
}

type RegisteredUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  society: { id: string; name: string } | null;
};

type SocietyRecord = {
  id: string;
  name: string;
  city: string;
  state: string;
  createdAt: string;
  _count: {
    users: number;
    blocks: number;
    complaints: number;
    expenses: number;
  };
};

type MyDashboardData = {
  pendingBills: number;
  totalDue: number;
  totalPaid: number;
  openComplaints: number;
  unreadAnnouncements: number;
  upcomingEvents: number;
  recentVisitors: number;
  recentDeliveries: number;
};

/* ─── Super Admin Dashboard ────────────────────────────────── */
function SuperAdminDashboard() {
  const navigate = useNavigate();

  const { data: users = [], isLoading: usersLoading } = useQuery<RegisteredUser[]>({
    queryKey: ['admin-registrations'],
    queryFn: async () => (await api.get('/admin/users')).data,
  });

  const { data: societies = [], isLoading: societiesLoading } = useQuery<SocietyRecord[]>({
    queryKey: ['admin-societies'],
    queryFn: async () => (await api.get('/admin/societies')).data,
  });

  if (usersLoading || societiesLoading) return <PageLoader />;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Platform Controls</p>
        <h1 className="page-title">Super Admin</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-6 shadow-card">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-500" />
            </div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Registered Users</p>
          </div>
          <p className="text-3xl font-extrabold text-on-surface font-headline">{users.length}</p>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-card">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-violet-500" />
            </div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Registered Apartments</p>
          </div>
          <p className="text-3xl font-extrabold text-on-surface font-headline">{societies.length}</p>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-card">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
              <Shield className="w-5 h-5 text-emerald-500" />
            </div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Admin Scope</p>
          </div>
          <p className="text-sm font-semibold text-emerald-600 mt-2 flex items-center gap-2">
            Platform-wide
          </p>
        </div>
      </div>

      {/* CRM Quick Access */}
      <button
        type="button"
        onClick={() => navigate('/crm')}
        className="w-full bg-white rounded-2xl p-5 shadow-card hover:shadow-card-hover transition-shadow text-left flex items-center justify-between gap-4"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center shrink-0">
            <DatabaseZap className="w-6 h-6 text-indigo-500" />
          </div>
          <div>
            <p className="text-sm font-bold text-on-surface">CRM — Society Management</p>
            <p className="text-xs text-slate-500 mt-0.5">
              View contacts, manage subscriptions, extend trials, deactivate societies, export data
            </p>
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-slate-300 shrink-0" />
      </button>

      <button
        type="button"
        onClick={() => navigate('/crm/campaigns')}
        className="w-full bg-white rounded-2xl p-5 shadow-card hover:shadow-card-hover transition-shadow text-left flex items-center justify-between gap-4"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-sky-50 flex items-center justify-center shrink-0">
            <Megaphone className="w-6 h-6 text-sky-500" />
          </div>
          <div>
            <p className="text-sm font-bold text-on-surface">Campaigns</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Queue publish mails, monitor 2-per-second delivery, and review campaign history
            </p>
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-slate-300 shrink-0" />
      </button>

      {/* Users Table */}
      <div className="bg-white rounded-2xl p-6 shadow-card">
        <h2 className="text-lg font-headline font-bold text-on-surface mb-4">All User Registrations</h2>
        <div className="table-container">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Apartment</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="py-3 px-4 font-medium text-on-surface">{user.name}</td>
                  <td className="py-3 px-4 text-slate-500">{user.email}</td>
                  <td className="py-3 px-4 text-slate-500">{user.role.replace('_', ' ')}</td>
                  <td className="py-3 px-4 text-slate-500">{user.society?.name || '-'}</td>
                  <td className="py-3 px-4">
                    <span className={user.isActive ? 'badge badge-success' : 'badge badge-neutral'}>
                      {user.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-400">{new Date(user.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── Resident (Owner / Tenant) Dashboard ──────────────────── */
function ResidentDashboard() {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const { data, isLoading } = useQuery<MyDashboardData>({
    queryKey: ['my-dashboard'],
    queryFn: async () => (await api.get('/reports/my-dashboard')).data,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  if (isLoading) return <PageLoader />;

  const hasDue = (data?.totalDue ?? 0) > 0;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.name?.split(' ')[0] || '';

  return (
    <div className="space-y-5 max-w-2xl mx-auto lg:max-w-none">
      {/* Header */}
      <header className="pt-1">
        <p className="text-on-surface-variant text-sm">
          {greeting}{firstName ? `, ${firstName}` : ''} 👋
        </p>
        <h1 className="text-2xl font-extrabold text-on-surface font-headline mt-0.5 tracking-tight">My Dashboard</h1>
      </header>

      {/* Hero — Outstanding Dues */}
      <div className="hero-card p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/50 mb-2">Outstanding Dues</p>
        <p className={`text-4xl font-extrabold font-headline mb-1 ${hasDue ? 'text-white' : 'text-white/70'}`}>
          {formatCurrency(data?.totalDue ?? 0)}
        </p>
        <p className="text-sm text-white/40 mb-5">
          {data?.pendingBills ?? 0} bill{(data?.pendingBills ?? 0) !== 1 ? 's' : ''} pending
        </p>
        {hasDue ? (
          <button
            className="btn-accent w-full justify-center rounded-[14px] py-3 text-sm"
            onClick={() => navigate('/billing')}
          >
            <CreditCard className="w-4 h-4" />
            Pay Now
          </button>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="w-4 h-4 text-[#00C4B4]" />
            <span className="text-white/60">All dues cleared</span>
          </div>
        )}
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 gap-3">
        {/* Open Complaints */}
        <button
          className="glass-card p-4 text-left active:scale-[0.98] transition-transform"
          onClick={() => navigate('/complaints')}
        >
          <div className="w-9 h-9 rounded-[10px] bg-amber-50 flex items-center justify-center mb-3">
            <ClipboardList className="w-4.5 h-4.5 text-amber-500" />
          </div>
          <p className="text-xl font-extrabold text-on-surface font-headline leading-none">
            {data?.openComplaints ?? 0}
          </p>
          <p className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-wider mt-1">
            Open Complaints
          </p>
        </button>

        {/* Pending Bills */}
        <div className="glass-card p-4">
          <div className="w-9 h-9 rounded-[10px] bg-[#CCFBF1] flex items-center justify-center mb-3">
            <Receipt className="w-4.5 h-4.5 text-[#0F766E]" />
          </div>
          <p className="text-xl font-extrabold text-on-surface font-headline leading-none">
            {data?.pendingBills ?? 0}
          </p>
          <p className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-wider mt-1">
            Pending Bills
          </p>
        </div>
      </div>

      {/* Total Paid Lifetime */}
      <div className="glass-card p-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-on-surface-variant mb-1">
            Total Paid
          </p>
          <p className="text-2xl font-extrabold font-headline text-on-surface">
            {formatCurrency(data?.totalPaid ?? 0)}
          </p>
          <p className="text-xs text-on-surface-variant mt-0.5">Lifetime payments</p>
        </div>
        <div className="w-12 h-12 rounded-[14px] bg-emerald-50 flex items-center justify-center shrink-0">
          <TrendingUp className="w-6 h-6 text-emerald-500" />
        </div>
      </div>

      {/* Active Complaints CTA — only shown when > 0 */}
      {(data?.openComplaints ?? 0) > 0 && (
        <button
          onClick={() => navigate('/complaints')}
          className="glass-card w-full p-4 flex items-center justify-between hover:shadow-card-hover transition-shadow text-left"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-50 rounded-[12px] flex items-center justify-center">
              <MessageSquareWarning className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-on-surface">
                {data?.openComplaints ?? 0} open complaint{(data?.openComplaints ?? 0) !== 1 ? 's' : ''}
              </p>
              <p className="text-xs text-on-surface-variant">Tap to view & track status</p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-outline" />
        </button>
      )}

      {/* Community and entry shortcuts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => navigate('/community')}
          className="glass-card p-4 text-left flex items-center justify-between gap-3 hover:shadow-card-hover active:scale-[0.98] transition-all"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative w-11 h-11 rounded-[14px] bg-indigo-50 flex items-center justify-center shrink-0">
              <Megaphone className="w-5 h-5 text-indigo-500" />
              <CalendarDays className="w-3.5 h-3.5 text-violet-500 absolute -right-1 -bottom-1 bg-white rounded-full p-0.5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-on-surface">Inbox</p>
              <p className="text-xs text-on-surface-variant mt-0.5">
                {data?.unreadAnnouncements ?? 0} unread · {data?.upcomingEvents ?? 0} upcoming
              </p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-outline shrink-0" />
        </button>

        <button
          type="button"
          onClick={() => navigate('/entry-activity')}
          className="glass-card p-4 text-left flex items-center justify-between gap-3 hover:shadow-card-hover active:scale-[0.98] transition-all"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative w-11 h-11 rounded-[14px] bg-emerald-50 flex items-center justify-center shrink-0">
              <UserRound className="w-5 h-5 text-emerald-500" />
              <Package className="w-3.5 h-3.5 text-orange-500 absolute -right-1 -bottom-1 bg-white rounded-full p-0.5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-on-surface">Visitors & Deliveries</p>
              <p className="text-xs text-on-surface-variant mt-0.5">
                {data?.recentVisitors ?? 0} visitors · {data?.recentDeliveries ?? 0} deliveries recently
              </p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-outline shrink-0" />
        </button>
      </div>
    </div>
  );
}

/* ─── Admin Dashboard — Role-aware overview ────────────────── */
function AdminDashboard() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isAdmin = SOCIETY_ADMINS.includes(user?.role as any);

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => (await api.get('/reports/dashboard')).data,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  if (isLoading) return <PageLoader />;

  const occupancyRate = data?.totalFlats ? Math.round(((data?.occupiedFlats || 0) / data.totalFlats) * 100) : 0;
  const netBalance = (data?.totalCollected || 0) - (data?.totalExpenses || 0);
  const pendingBillPercent = data?.totalFlats ? Math.min(Math.round(((data?.pendingBills || 0) / data.totalFlats) * 100), 100) : 0;

  const roleLabel = user?.role?.replace('_', ' ') || 'Manager';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <Greeting name={user?.name} />
          <h1 className="text-2xl font-extrabold text-on-surface font-headline mt-1">Dashboard</h1>
          <p className="text-xs text-slate-400 mt-1">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            <span className="mx-2">·</span>
            <span className="text-primary font-semibold">{roleLabel}</span>
          </p>
        </div>
      </div>

      {/* ── Financial Summary ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl bg-primary p-6 text-on-primary col-span-2 shadow-card">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-on-primary/50 mb-1">Total Collected</p>
          <p className="text-3xl font-extrabold font-headline">{formatCurrency(data?.totalCollected || 0)}</p>
          <div className="flex items-center gap-4 mt-3 text-sm">
            <span className="text-on-primary/70">Expenses: {formatCurrency(data?.totalExpenses || 0)}</span>
            <span className="text-on-primary/30">·</span>
            <span className={netBalance >= 0 ? 'text-emerald-200' : 'text-red-200'}>
              Net: {formatCurrency(netBalance)}
            </span>
          </div>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-card">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
              <Receipt className="w-4 h-4 text-red-500" />
            </div>
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Pending Bills</p>
          <p className="text-3xl font-extrabold font-headline text-red-500">{data?.pendingBills || 0}</p>
          <div className="mt-2 w-full bg-slate-100 rounded-full h-1.5">
            <div className="bg-red-400 h-full rounded-full transition-all" style={{ width: `${pendingBillPercent}%` }} />
          </div>
          <p className="text-[10px] text-slate-400 mt-1">{pendingBillPercent}% of flats</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-card">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
              <MessageSquareWarning className="w-4 h-4 text-amber-500" />
            </div>
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Open Complaints</p>
          <p className="text-3xl font-extrabold font-headline text-on-surface">{data?.openComplaints || 0}</p>
          {(data?.openComplaints || 0) > 0 && (
            <button
              onClick={() => navigate('/complaints')}
              className="mt-2 text-xs font-semibold text-primary hover:underline flex items-center gap-1"
            >
              View all <ChevronRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* ── Quick Shortcuts ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => navigate('/community')}
          className="rounded-2xl bg-white p-5 shadow-card hover:shadow-card-hover transition-shadow text-left flex items-center justify-between gap-4"
        >
          <div className="flex items-center gap-4 min-w-0">
            <div className="relative w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center shrink-0">
              <Megaphone className="w-6 h-6 text-indigo-500" />
              <CalendarDays className="w-4 h-4 text-violet-500 absolute -right-1 -bottom-1 bg-white rounded-full p-0.5 shadow-sm" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-on-surface">Inbox</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {data?.unreadAnnouncements || 0} unread announcements · {data?.upcomingEvents || 0} upcoming events
              </p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-300 shrink-0" />
        </button>

        <button
          type="button"
          onClick={() => navigate('/entry-activity')}
          className="rounded-2xl bg-white p-5 shadow-card hover:shadow-card-hover transition-shadow text-left flex items-center justify-between gap-4"
        >
          <div className="flex items-center gap-4 min-w-0">
            <div className="relative w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center shrink-0">
              <UserRound className="w-6 h-6 text-emerald-500" />
              <Package className="w-4 h-4 text-orange-500 absolute -right-1 -bottom-1 bg-white rounded-full p-0.5 shadow-sm" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-on-surface">Visitors & Deliveries</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {data?.recentVisitors || 0} recent visitors · {data?.recentDeliveries || 0} recent deliveries
              </p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-300 shrink-0" />
        </button>
      </div>

      {/* ── Occupancy ── */}
      {(isAdmin || user?.role === 'JOINT_SECRETARY') && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-2xl bg-white p-5 shadow-card">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Total Flats</p>
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <Building2 className="w-4 h-4 text-blue-500" />
              </div>
            </div>
            <p className="text-2xl font-extrabold font-headline text-primary">{data?.totalFlats || 0}</p>
            <div className="mt-2 w-full bg-slate-100 rounded-full h-1.5">
              <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${occupancyRate}%` }} />
            </div>
            <p className="text-[10px] text-slate-400 mt-1">{occupancyRate}% occupied</p>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow-card">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Owners</p>
              <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center">
                <Users className="w-4 h-4 text-violet-500" />
              </div>
            </div>
            <p className="text-2xl font-extrabold font-headline text-on-surface">{data?.totalOwners || 0}</p>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow-card">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Tenants</p>
              <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                <Users className="w-4 h-4 text-emerald-500" />
              </div>
            </div>
            <p className="text-2xl font-extrabold font-headline text-on-surface">{data?.totalTenants || 0}</p>
          </div>
        </div>
      )}
    </div>
  );
}
