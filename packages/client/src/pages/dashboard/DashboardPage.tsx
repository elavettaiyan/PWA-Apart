import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2, Users, Receipt, MessageSquareWarning,
  Wallet, TrendingUp, TrendingDown, Home, CreditCard, Shield, Trash2,
  ChevronRight,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { PageLoader } from '../../components/ui/Loader';
import { useAuthStore } from '../../store/authStore';
import type { DashboardData } from '../../types';
import { FINANCIAL_ROLES } from '../../types';

export default function DashboardPage() {
  const { user } = useAuthStore();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const isManager = FINANCIAL_ROLES.includes(user?.role as any);

  if (isSuperAdmin) return <SuperAdminDashboard />;
  if (isManager) return <AdminDashboard />;
  return <ResidentDashboard />;
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
        <p className="text-[10px] font-bold text-outline uppercase tracking-widest mb-2">Platform Controls</p>
        <h1 className="page-title">Super Admin Panel</h1>
        <p className="text-sm text-on-surface-variant mt-1">All user registrations and full apartment deletion controls</p>
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
          <p className="text-sm font-semibold text-tertiary mt-2 flex items-center gap-2">
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

  return (
    <div className="space-y-8 max-w-2xl mx-auto lg:max-w-none">
      {/* Editorial Header — Mobile-first */}
      <header>
        <p className="section-label mb-2">Your Space</p>
        <h1 className="editorial-title text-4xl font-extrabold text-primary leading-tight">
          Everything<br />Made Clearer.
        </h1>
      </header>

      {/* Financial Health — Dark Hero Card */}
      <div className="bg-primary-container rounded-3xl p-6 text-white relative overflow-hidden">
        <div className="relative z-10">
          <p className="text-[10px] uppercase tracking-widest text-on-primary-container/70 font-bold mb-1">Financial Health</p>
          <h2 className="text-3xl sm:text-4xl font-extrabold editorial-title">{formatCurrency(data?.totalDue ?? 0)}</h2>
          <p className="text-sm text-on-primary-container/70 leading-relaxed mt-2 max-w-[220px]">
            Outstanding balance across pending bills.
          </p>
        </div>
        <div className="absolute -right-8 -bottom-8 w-32 h-32 bg-primary opacity-20 rounded-full blur-3xl"></div>
        <div className="absolute right-6 top-6">
          <span className="material-symbols-outlined text-4xl text-on-primary-container/30">account_balance</span>
        </div>
      </div>

      {/* Bento Mini Cards */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-surface-container-lowest rounded-2xl p-5 flex flex-col justify-between aspect-square">
          <span className="material-symbols-outlined text-primary text-2xl">receipt_long</span>
          <div>
            <p className="text-3xl font-extrabold text-primary editorial-title">{data?.pendingBills ?? 0}</p>
            <p className="text-[10px] uppercase tracking-tight text-outline font-bold">Pending Bills</p>
          </div>
        </div>
        <div className="bg-tertiary-container rounded-2xl p-5 flex flex-col justify-between aspect-square">
          <span className="material-symbols-outlined text-tertiary-fixed text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>trending_up</span>
          <div>
            <p className="text-3xl font-extrabold text-tertiary-fixed editorial-title">{formatCurrency(data?.totalPaid ?? 0)}</p>
            <p className="text-[10px] uppercase tracking-tight text-on-tertiary-container font-bold">Total Paid</p>
          </div>
        </div>
      </div>

      {/* Operations Summary */}
      <section className="space-y-3">
        <h3 className="text-xl font-bold text-primary editorial-title mb-5">Operations Summary</h3>

        {/* Due Amount */}
        <div className="ops-card">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-error-container rounded-2xl flex items-center justify-center">
              <span className="material-symbols-outlined text-error text-xl">account_balance_wallet</span>
            </div>
            <div>
              <h4 className="font-bold text-base text-primary">Amount Due</h4>
              <p className="text-sm text-on-surface-variant">Unpaid maintenance bills</p>
            </div>
          </div>
          <div className="text-xl font-black text-error editorial-title">{formatCurrency(data?.totalDue ?? 0)}</div>
        </div>

        {/* Open Complaints */}
        <div className="ops-card">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-secondary-container rounded-2xl flex items-center justify-center">
              <span className="material-symbols-outlined text-primary text-xl">forum</span>
            </div>
            <div>
              <h4 className="font-bold text-base text-primary">Open Complaints</h4>
              <p className="text-sm text-on-surface-variant">{data?.openComplaints ?? 0} items pending</p>
            </div>
          </div>
          <div className="text-xl font-black text-primary editorial-title">{String(data?.openComplaints ?? 0).padStart(2, '0')}</div>
        </div>
      </section>

      {/* Quick Actions */}
      <section>
        <p className="section-label mb-4">Quick Actions</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <button
            onClick={() => navigate('/billing')}
            className="card-elevated p-5 flex items-center gap-4 hover:bg-surface-container-low transition-colors text-left group"
          >
            <div className="w-12 h-12 bg-secondary-container rounded-2xl flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-on-secondary-container" />
            </div>
            <div>
              <p className="font-bold text-on-surface group-hover:text-primary transition-colors">Pay Bills</p>
              <p className="text-xs text-outline">View & pay maintenance</p>
            </div>
          </button>
          <button
            onClick={() => navigate('/complaints')}
            className="card-elevated p-5 flex items-center gap-4 hover:bg-surface-container-low transition-colors text-left group"
          >
            <div className="w-12 h-12 bg-tertiary-container rounded-2xl flex items-center justify-center">
              <MessageSquareWarning className="w-5 h-5 text-tertiary-fixed" />
            </div>
            <div>
              <p className="font-bold text-on-surface group-hover:text-primary transition-colors">Complaints</p>
              <p className="text-xs text-outline">File or track a complaint</p>
            </div>
          </button>
          <button
            onClick={() => navigate('/my-flat')}
            className="card-elevated p-5 flex items-center gap-4 hover:bg-surface-container-low transition-colors text-left group"
          >
            <div className="w-12 h-12 bg-primary-container rounded-2xl flex items-center justify-center">
              <Home className="w-5 h-5 text-on-primary-container" />
            </div>
            <div>
              <p className="font-bold text-on-surface group-hover:text-primary transition-colors">My Flat</p>
              <p className="text-xs text-outline">View your flat details</p>
            </div>
          </button>
        </div>
      </section>
    </div>
  );
}

/* ─── Admin Dashboard — Editorial Bento Grid ───────────────── */
function AdminDashboard() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const { data } = await api.get('/reports/dashboard');
      return data;
    },
  });

  if (isLoading) return <PageLoader />;

  const occupancyRate = data?.totalFlats ? Math.round(((data?.occupiedFlats || 0) / data.totalFlats) * 100) : 0;
  const pendingBillPercent = data?.totalFlats ? Math.min(Math.round(((data?.pendingBills || 0) / data.totalFlats) * 100), 100) : 0;
  const netBalance = (data?.totalCollected || 0) - (data?.totalExpenses || 0);

  return (
    <div className="space-y-8">
      {/* Editorial Header — matches reference */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h2 className="editorial-title text-3xl sm:text-4xl font-extrabold text-primary">Overview</h2>
          <p className="text-on-surface-variant mt-2 text-base">Your property health at a glance today.</p>
        </div>
        <div className="bg-surface-container px-4 py-2 rounded-lg flex items-center gap-2 text-primary font-medium text-sm">
          <span className="material-symbols-outlined text-lg">calendar_today</span>
          <span>{new Date().toLocaleDateString('en-IN', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
        </div>
      </div>

      {/* Bento Grid — Occupancy Stats (matches reference web layout) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        {/* Total Flats — Large Card */}
        <div className="col-span-2 bg-surface-container-lowest rounded-2xl p-6 lg:p-8 flex flex-col justify-between min-h-[180px] group hover:bg-primary-container transition-colors duration-500">
          <div className="flex justify-between items-start">
            <span className="material-symbols-outlined text-primary group-hover:text-primary-fixed text-3xl">apartment</span>
            <span className="text-[10px] font-bold tracking-widest uppercase text-outline group-hover:text-primary-fixed/50">Capacity</span>
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl lg:text-5xl font-extrabold editorial-title text-primary group-hover:text-white">{data?.totalFlats || 0}</span>
              <span className="text-on-surface-variant group-hover:text-primary-fixed font-bold">Total Flats</span>
            </div>
            <div className="mt-4 w-full bg-surface-container rounded-full h-1.5 overflow-hidden">
              <div className="bg-primary group-hover:bg-white h-full rounded-full transition-all" style={{ width: `${occupancyRate}%` }}></div>
            </div>
            <p className="text-xs text-outline group-hover:text-primary-fixed/50 mt-1">{occupancyRate}% Occupancy</p>
          </div>
        </div>

        {/* Occupied — Teal Card */}
        <div className="bg-tertiary-container rounded-2xl p-5 lg:p-8 flex flex-col justify-between min-h-[160px] lg:min-h-[180px]">
          <div className="flex justify-between items-start">
            <span className="material-symbols-outlined text-tertiary-fixed text-2xl lg:text-3xl">done_all</span>
            <div className="w-2 h-2 rounded-full bg-tertiary-fixed animate-pulse"></div>
          </div>
          <div>
            <span className="text-3xl lg:text-4xl font-extrabold editorial-title text-white">{data?.occupiedFlats || 0}</span>
            <p className="text-on-tertiary-container font-medium text-sm">Occupied Units</p>
          </div>
        </div>

        {/* Vacant */}
        <div className="bg-surface-container-lowest rounded-2xl p-5 lg:p-8 flex flex-col justify-between min-h-[160px] lg:min-h-[180px]">
          <div className="flex justify-between items-start">
            <span className="material-symbols-outlined text-outline text-2xl lg:text-3xl">event_busy</span>
            <span className="bg-surface-container text-outline px-2 py-0.5 rounded text-[10px] font-bold">STABLE</span>
          </div>
          <div>
            <span className="text-3xl lg:text-4xl font-extrabold editorial-title text-primary">{data?.vacantFlats || 0}</span>
            <p className="text-on-surface-variant font-medium text-sm">Vacant Units</p>
          </div>
        </div>
      </div>

      {/* Residents & Complaints Row */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
        <div className="bg-surface-container-lowest rounded-2xl p-5 lg:p-8 flex items-center gap-4 lg:gap-6">
          <div className="bg-secondary-container p-3 lg:p-4 rounded-2xl">
            <span className="material-symbols-outlined text-on-secondary-container text-2xl lg:text-3xl">person</span>
          </div>
          <div>
            <p className="text-on-surface-variant text-xs sm:text-sm font-bold uppercase tracking-tighter">Owners</p>
            <p className="text-2xl lg:text-3xl font-extrabold text-primary editorial-title">{data?.totalOwners || 0}</p>
          </div>
        </div>
        <div className="bg-surface-container-lowest rounded-2xl p-5 lg:p-8 flex items-center gap-4 lg:gap-6">
          <div className="bg-primary-fixed p-3 lg:p-4 rounded-2xl">
            <span className="material-symbols-outlined text-primary text-2xl lg:text-3xl">diversity_3</span>
          </div>
          <div>
            <p className="text-on-surface-variant text-xs sm:text-sm font-bold uppercase tracking-tighter">Tenants</p>
            <p className="text-2xl lg:text-3xl font-extrabold text-primary editorial-title">{data?.totalTenants || 0}</p>
          </div>
        </div>
        <div className="col-span-2 lg:col-span-1 bg-error-container rounded-2xl p-5 lg:p-8 flex items-center justify-between cursor-pointer hover:opacity-90 transition-opacity" onClick={() => navigate('/complaints')}>
          <div className="flex items-center gap-4 lg:gap-6">
            <div className="bg-white p-3 lg:p-4 rounded-2xl">
              <span className="material-symbols-outlined text-error text-2xl lg:text-3xl">warning</span>
            </div>
            <div>
              <p className="text-on-error-container text-xs sm:text-sm font-bold uppercase tracking-tighter">Open Complaints</p>
              <p className="text-2xl lg:text-3xl font-extrabold text-error editorial-title">{data?.openComplaints || 0}</p>
            </div>
          </div>
          <span className="material-symbols-outlined text-error/30 text-4xl lg:text-5xl">arrow_forward_ios</span>
        </div>
      </div>

      {/* Financial Summary — Editorial Dark Block (matches ref web layout) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6">
        {/* Main Financial Card */}
        <div className="lg:col-span-8 bg-primary text-white p-6 sm:p-8 lg:p-10 rounded-2xl relative overflow-hidden">
          <div className="relative z-10 flex flex-col h-full justify-between min-h-[200px]">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
              <div>
                <h3 className="text-primary-fixed-dim text-xs sm:text-sm font-bold uppercase tracking-widest">Financial Summary</h3>
                <p className="text-4xl lg:text-5xl font-extrabold editorial-title mt-2">{formatCurrency(data?.totalCollected || 0)}</p>
                <p className="text-primary-fixed/60 mt-1 text-sm">Total Collected this cycle</p>
              </div>
              <div className="bg-white/10 backdrop-blur px-4 py-2 rounded-xl border border-white/10">
                <p className="text-xs uppercase font-bold text-primary-fixed">Net Balance</p>
                <p className="text-xl sm:text-2xl font-bold">{formatCurrency(netBalance)}</p>
              </div>
            </div>
            <div className="mt-8 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
              <div>
                <p className="text-primary-fixed/60 text-xs font-bold uppercase">Total Expenses</p>
                <p className="text-xl sm:text-2xl font-bold editorial-title">{formatCurrency(data?.totalExpenses || 0)}</p>
              </div>
              <div className="hidden sm:block flex-1 h-px bg-white/10"></div>
              <button
                onClick={() => navigate('/reports')}
                className="bg-primary-fixed text-primary px-5 py-2.5 rounded-lg font-bold flex items-center gap-2 hover:opacity-90 transition-opacity text-sm"
              >
                <span>View Ledger</span>
                <span className="material-symbols-outlined text-lg">trending_up</span>
              </button>
            </div>
          </div>
          {/* Abstract Background */}
          <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 bg-white/5 rounded-full blur-3xl"></div>
          <div className="absolute bottom-0 left-0 -ml-10 -mb-10 w-64 h-64 bg-tertiary-fixed/5 rounded-full blur-2xl"></div>
        </div>

        {/* Billing Status Card */}
        <div className="lg:col-span-4 bg-surface-container-low p-6 lg:p-8 rounded-2xl flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-6">
              <span className="text-outline font-bold uppercase text-[10px] tracking-widest">Billing Status</span>
              {(data?.pendingBills || 0) > 0 && (
                <span className="bg-error/10 text-error px-2 py-0.5 rounded text-[10px] font-bold">ACTION REQUIRED</span>
              )}
            </div>
            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <p className="text-on-surface-variant font-medium">Pending Bills</p>
                <p className="text-2xl lg:text-3xl font-extrabold text-primary editorial-title">{data?.pendingBills || 0}</p>
              </div>
              <div className="w-full bg-surface-container-highest rounded-full h-2">
                <div className="bg-error h-full rounded-full transition-all" style={{ width: `${pendingBillPercent}%` }}></div>
              </div>
              <p className="text-xs text-outline">{pendingBillPercent}% of units have outstanding invoices.</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/billing')}
            className="w-full border border-outline-variant text-primary py-2.5 rounded-lg font-bold mt-6 hover:bg-surface-container transition-colors text-sm"
          >
            Send Reminders
          </button>
        </div>
      </div>
    </div>
  );
}
