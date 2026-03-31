import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2, Users, MessageSquareWarning,
  Shield, Trash2,
  ChevronRight,
} from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { PageLoader } from '../../components/ui/Loader';
import { getDefaultAuthenticatedRoute } from '../../lib/serviceStaff';
import { useAuthStore } from '../../store/authStore';
import type { DashboardData } from '../../types';
import { FINANCIAL_ROLES, SOCIETY_ADMINS } from '../../types';

export default function DashboardPage() {
  const { user } = useAuthStore();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const isManager = FINANCIAL_ROLES.includes(user?.role as any);
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

/* ─── Super Admin Dashboard ────────────────────────────────── */
function SuperAdminDashboard() {
  const queryClient = useQueryClient();
  const [societyToDelete, setSocietyToDelete] = useState<string | null>(null);
  const [confirmationName, setConfirmationName] = useState('');

  const { data: users = [], isLoading: usersLoading } = useQuery<RegisteredUser[]>({
    queryKey: ['admin-registrations'],
    queryFn: async () => (await api.get('/admin/users')).data,
  });

  const { data: societies = [], isLoading: societiesLoading } = useQuery<SocietyRecord[]>({
    queryKey: ['admin-societies'],
    queryFn: async () => (await api.get('/admin/societies')).data,
  });

  const deleteSociety = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.delete(`/admin/societies/${id}`, { data: { confirmationName: name } }),
    onSuccess: () => {
      toast.success('Apartment and all linked data deleted');
      setSocietyToDelete(null);
      setConfirmationName('');
      queryClient.invalidateQueries({ queryKey: ['admin-societies'] });
      queryClient.invalidateQueries({ queryKey: ['admin-registrations'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to delete apartment');
    },
  });

  if (usersLoading || societiesLoading) return <PageLoader />;

  const resolvedSociety = societies.find((society) => society.id === societyToDelete);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <p className="text-[10px] font-bold text-outline uppercase tracking-widest mb-1">Platform Controls</p>
        <h1 className="page-title">Super Admin</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="stat-card">
          <p className="stat-label">Registered Users</p>
          <p className="text-2xl font-bold text-on-surface mt-1">{users.length}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Registered Apartments</p>
          <p className="text-2xl font-bold text-on-surface mt-1">{societies.length}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Super Admin Scope</p>
          <p className="text-sm font-semibold text-emerald-700 mt-2 flex items-center gap-2">
            <Shield className="w-4 h-4" /> Platform-wide
          </p>
        </div>
      </div>

      {/* Users Table */}
      <div className="card p-6">
        <h2 className="text-lg font-headline font-bold text-primary mb-4">All User Registrations</h2>
        <div className="table-container">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th className="py-3 px-4 text-left text-[10px] font-bold text-outline uppercase tracking-widest">Name</th>
                <th className="py-3 px-4 text-left text-[10px] font-bold text-outline uppercase tracking-widest">Email</th>
                <th className="py-3 px-4 text-left text-[10px] font-bold text-outline uppercase tracking-widest">Role</th>
                <th className="py-3 px-4 text-left text-[10px] font-bold text-outline uppercase tracking-widest">Apartment</th>
                <th className="py-3 px-4 text-left text-[10px] font-bold text-outline uppercase tracking-widest">Status</th>
                <th className="py-3 px-4 text-left text-[10px] font-bold text-outline uppercase tracking-widest">Created</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="py-3 px-4 font-medium text-on-surface">{user.name}</td>
                  <td className="py-3 px-4 text-on-surface-variant">{user.email}</td>
                  <td className="py-3 px-4 text-on-surface-variant">{user.role.replace('_', ' ')}</td>
                  <td className="py-3 px-4 text-on-surface-variant">{user.society?.name || '-'}</td>
                  <td className="py-3 px-4">
                    <span className={user.isActive ? 'badge badge-success' : 'badge badge-neutral'}>
                      {user.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-outline">{new Date(user.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Societies */}
      <div className="card p-6">
        <h2 className="text-lg font-headline font-bold text-primary mb-1">Apartment Registrations</h2>
        <p className="text-sm text-on-surface-variant mb-5">Delete removes the society and all linked blocks, flats, users, bills, complaints, and expenses.</p>

        <div className="space-y-3">
          {societies.map((society) => (
            <div key={society.id} className="bg-surface-container-low rounded-xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-on-surface">{society.name}</p>
                <p className="text-xs text-on-surface-variant mt-1">{society.city}, {society.state}</p>
                <p className="text-xs text-outline mt-1">
                  Users: {society._count.users} · Blocks: {society._count.blocks} · Complaints: {society._count.complaints} · Expenses: {society._count.expenses}
                </p>
              </div>
              <button
                type="button"
                className="btn-secondary text-error hover:bg-error-container/30"
                onClick={() => {
                  setSocietyToDelete(society.id);
                  setConfirmationName('');
                }}
              >
                <Trash2 className="w-4 h-4" /> Delete Entire Apartment
              </button>
            </div>
          ))}
        </div>

        {resolvedSociety && (
          <div className="mt-5 rounded-xl bg-error-container/30 p-4">
            <p className="text-sm font-bold text-on-error-container">Confirm full deletion: {resolvedSociety.name}</p>
            <p className="text-xs text-on-error-container/80 mt-1">Type the apartment name exactly to continue.</p>
            <div className="mt-3 flex flex-col sm:flex-row gap-2">
              <input
                className="input"
                value={confirmationName}
                onChange={(event) => setConfirmationName(event.target.value)}
                placeholder={`Type ${resolvedSociety.name}`}
              />
              <button
                type="button"
                className="btn-primary bg-error hover:bg-error/90 disabled:opacity-50"
                disabled={deleteSociety.isPending || confirmationName.trim() !== resolvedSociety.name}
                onClick={() => deleteSociety.mutate({ id: resolvedSociety.id, name: confirmationName.trim() })}
              >
                {deleteSociety.isPending ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Resident (Owner / Tenant) Dashboard ──────────────────── */
function ResidentDashboard() {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const { data, isLoading } = useQuery<any>({
    queryKey: ['my-dashboard'],
    queryFn: async () => (await api.get('/reports/my-dashboard')).data,
  });

  if (isLoading) return <PageLoader />;

  const hasDue = (data?.totalDue ?? 0) > 0;

  return (
    <div className="space-y-6 max-w-2xl mx-auto lg:max-w-none">
      {/* Header */}
      <header>
        <Greeting name={user?.name} />
        <h1 className="text-2xl font-extrabold text-primary font-headline mt-1">My Dashboard</h1>
      </header>

      {/* Financial strip */}
      <div className="grid grid-cols-2 gap-4">
        {/* Outstanding */}
        <div className={`rounded-2xl p-5 ${hasDue ? 'bg-error-container/30' : 'bg-tertiary-container/20'}`}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">Outstanding</p>
          <p className={`text-2xl font-extrabold font-headline ${hasDue ? 'text-error' : 'text-tertiary'}`}>
            {formatCurrency(data?.totalDue ?? 0)}
          </p>
          <p className="text-xs text-on-surface-variant mt-1">
            {data?.pendingBills ?? 0} bill{(data?.pendingBills ?? 0) !== 1 ? 's' : ''} unpaid
          </p>
        </div>
        {/* Paid */}
        <div className="rounded-2xl p-5 bg-surface-container-low">
          <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">Total Paid</p>
          <p className="text-2xl font-extrabold font-headline text-primary">
            {formatCurrency(data?.totalPaid ?? 0)}
          </p>
          <p className="text-xs text-on-surface-variant mt-1">Lifetime payments</p>
        </div>
      </div>

      {/* Active complaints */}
      {(data?.openComplaints ?? 0) > 0 && (
        <button
          onClick={() => navigate('/complaints')}
          className="w-full rounded-2xl border border-outline-variant/15 bg-surface-container-lowest p-4 flex items-center justify-between hover:border-primary/20 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
              <MessageSquareWarning className="w-5 h-5 text-amber-700" />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold text-on-surface">{data.openComplaints} open complaint{data.openComplaints !== 1 ? 's' : ''}</p>
              <p className="text-xs text-on-surface-variant">Tap to view status</p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-on-surface-variant" />
        </button>
      )}
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
          <h1 className="text-2xl font-extrabold text-primary font-headline mt-1">Dashboard</h1>
          <p className="text-xs text-on-surface-variant mt-1">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            <span className="mx-2">·</span>
            <span className="text-primary font-semibold">{roleLabel}</span>
          </p>
        </div>
      </div>

      {/* ── Financial Summary (visible to all FINANCIAL_ROLES) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl bg-primary p-5 text-on-primary col-span-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-on-primary/50 mb-1">Total Collected</p>
          <p className="text-3xl font-extrabold font-headline">{formatCurrency(data?.totalCollected || 0)}</p>
          <div className="flex items-center gap-4 mt-3 text-sm">
            <span className="text-on-primary/70">Expenses: {formatCurrency(data?.totalExpenses || 0)}</span>
            <span className="text-on-primary/40">·</span>
            <span className={netBalance >= 0 ? 'text-tertiary-fixed' : 'text-error-container'}>
              Net: {formatCurrency(netBalance)}
            </span>
          </div>
        </div>
        <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-lowest p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Pending Bills</p>
          <p className="text-3xl font-extrabold font-headline text-error">{data?.pendingBills || 0}</p>
          <div className="mt-2 w-full bg-surface-container-high rounded-full h-1.5">
            <div className="bg-error h-full rounded-full" style={{ width: `${pendingBillPercent}%` }} />
          </div>
          <p className="text-[10px] text-on-surface-variant mt-1">{pendingBillPercent}% of flats</p>
        </div>
        <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-lowest p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Open Complaints</p>
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

      {/* ── Occupancy (Admin / Secretary / Joint Secretary) ── */}
      {(isAdmin || user?.role === 'JOINT_SECRETARY') && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-2xl bg-surface-container-low p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Total Flats</p>
              <Building2 className="w-4 h-4 text-on-surface-variant" />
            </div>
            <p className="text-2xl font-extrabold font-headline text-primary">{data?.totalFlats || 0}</p>
            <div className="mt-2 w-full bg-surface-container-high rounded-full h-1.5">
              <div className="bg-primary h-full rounded-full" style={{ width: `${occupancyRate}%` }} />
            </div>
            <p className="text-[10px] text-on-surface-variant mt-1">{occupancyRate}% occupied</p>
          </div>
          <div className="rounded-2xl bg-surface-container-low p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Owners</p>
              <Users className="w-4 h-4 text-on-surface-variant" />
            </div>
            <p className="text-2xl font-extrabold font-headline text-on-surface">{data?.totalOwners || 0}</p>
          </div>
          <div className="rounded-2xl bg-surface-container-low p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Tenants</p>
              <Users className="w-4 h-4 text-on-surface-variant" />
            </div>
            <p className="text-2xl font-extrabold font-headline text-on-surface">{data?.totalTenants || 0}</p>
          </div>
        </div>
      )}
    </div>
  );
}
