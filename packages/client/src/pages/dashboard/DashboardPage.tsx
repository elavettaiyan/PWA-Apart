import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2, Users, Receipt, MessageSquareWarning,
  Wallet, TrendingUp, TrendingDown, Home, CreditCard, Shield, Trash2,
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
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Super Admin Panel</h1>
          <p className="text-sm text-gray-500 mt-1">All user registrations and full apartment deletion controls</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="stat-card">
          <p className="stat-label">Registered Users</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{users.length}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Registered Apartments</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{societies.length}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Super Admin Scope</p>
          <p className="text-sm font-semibold text-emerald-700 mt-2 flex items-center gap-2">
            <Shield className="w-4 h-4" /> Platform-wide
          </p>
        </div>
      </div>

      <div className="card p-5 mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">All User Registrations</h2>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">Apartment</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-gray-50">
                  <td className="py-2 pr-4 font-medium text-gray-900">{user.name}</td>
                  <td className="py-2 pr-4 text-gray-700">{user.email}</td>
                  <td className="py-2 pr-4 text-gray-700">{user.role.replace('_', ' ')}</td>
                  <td className="py-2 pr-4 text-gray-600">{user.society?.name || '-'}</td>
                  <td className="py-2 pr-4">
                    <span className={user.isActive ? 'badge badge-success' : 'badge badge-neutral'}>
                      {user.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="py-2 text-gray-500">{new Date(user.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Apartment Registrations</h2>
        <p className="text-sm text-gray-500 mb-4">Delete removes the society and all linked blocks, flats, users, bills, complaints, and expenses.</p>

        <div className="space-y-3">
          {societies.map((society) => (
            <div key={society.id} className="rounded-xl border border-gray-100 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">{society.name}</p>
                <p className="text-xs text-gray-500 mt-1">{society.city}, {society.state}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Users: {society._count.users} · Blocks: {society._count.blocks} · Complaints: {society._count.complaints} · Expenses: {society._count.expenses}
                </p>
              </div>
              <button
                type="button"
                className="btn-secondary text-red-600 border-red-200 hover:bg-red-50"
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
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-800">Confirm full deletion: {resolvedSociety.name}</p>
            <p className="text-xs text-red-700 mt-1">Type the apartment name exactly to continue.</p>
            <div className="mt-3 flex flex-col sm:flex-row gap-2">
              <input
                className="input"
                value={confirmationName}
                onChange={(event) => setConfirmationName(event.target.value)}
                placeholder={`Type ${resolvedSociety.name}`}
              />
              <button
                type="button"
                className="btn-primary bg-red-600 hover:bg-red-700 focus:ring-red-500 disabled:opacity-50"
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

  const cards = [
    { label: 'Pending Bills', value: data?.pendingBills ?? 0, icon: Receipt, color: 'bg-orange-50 text-orange-600' },
    { label: 'Total Due', value: formatCurrency(data?.totalDue ?? 0), icon: Wallet, color: 'bg-red-50 text-red-600' },
    { label: 'Total Paid', value: formatCurrency(data?.totalPaid ?? 0), icon: TrendingUp, color: 'bg-emerald-50 text-emerald-600' },
    { label: 'Open Complaints', value: data?.openComplaints ?? 0, icon: MessageSquareWarning, color: 'bg-amber-50 text-amber-600' },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Welcome, {user?.name}</h1>
          <p className="text-sm text-gray-500 mt-1">Here's what's happening with your flat</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map((c) => (
          <div key={c.label} className="stat-card">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${c.color}`}>
                <c.icon className="w-5 h-5" />
              </div>
              <div>
                <p className="stat-label">{c.label}</p>
                <p className="stat-value">{c.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <button
          onClick={() => navigate('/billing')}
          className="card p-5 flex items-center gap-4 hover:shadow-md transition-shadow text-left"
        >
          <div className="w-12 h-12 bg-primary-50 rounded-xl flex items-center justify-center">
            <CreditCard className="w-6 h-6 text-primary-600" />
          </div>
          <div>
            <p className="font-semibold text-gray-900">Pay Bills</p>
            <p className="text-xs text-gray-500">View & pay your maintenance bills</p>
          </div>
        </button>
        <button
          onClick={() => navigate('/complaints')}
          className="card p-5 flex items-center gap-4 hover:shadow-md transition-shadow text-left"
        >
          <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center">
            <MessageSquareWarning className="w-6 h-6 text-amber-600" />
          </div>
          <div>
            <p className="font-semibold text-gray-900">Complaints</p>
            <p className="text-xs text-gray-500">File or track a complaint</p>
          </div>
        </button>
        <button
          onClick={() => navigate('/my-flat')}
          className="card p-5 flex items-center gap-4 hover:shadow-md transition-shadow text-left"
        >
          <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center">
            <Home className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <p className="font-semibold text-gray-900">My Flat</p>
            <p className="text-xs text-gray-500">View your flat details</p>
          </div>
        </button>
      </div>
    </div>
  );
}

/* ─── Admin Dashboard ──────────────────────────────────────── */
function AdminDashboard() {
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const { data } = await api.get('/reports/dashboard');
      return data;
    },
  });

  if (isLoading) return <PageLoader />;

  const stats = [
    { label: 'Total Flats', value: data?.totalFlats || 0, icon: Building2, color: 'bg-blue-50 text-blue-600' },
    { label: 'Occupied', value: data?.occupiedFlats || 0, icon: Home, color: 'bg-green-50 text-green-600' },
    { label: 'Vacant', value: data?.vacantFlats || 0, icon: Building2, color: 'bg-amber-50 text-amber-600' },
    { label: 'Total Owners', value: data?.totalOwners || 0, icon: Users, color: 'bg-purple-50 text-purple-600' },
    { label: 'Tenants', value: data?.totalTenants || 0, icon: Users, color: 'bg-cyan-50 text-cyan-600' },
    { label: 'Open Complaints', value: data?.openComplaints || 0, icon: MessageSquareWarning, color: 'bg-red-50 text-red-600' },
    { label: 'Pending Bills', value: data?.pendingBills || 0, icon: Receipt, color: 'bg-orange-50 text-orange-600' },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Overview of your apartment complex</p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <div key={stat.label} className="stat-card">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${stat.color}`}>
                <stat.icon className="w-5 h-5" />
              </div>
              <div>
                <p className="stat-label">{stat.label}</p>
                <p className="stat-value">{stat.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Financial Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="stat-card">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-emerald-600" />
            </div>
            <div>
              <p className="stat-label">Total Collected</p>
              <p className="text-xl font-bold text-emerald-600">
                {formatCurrency(data?.totalCollected || 0)}
              </p>
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center">
              <TrendingDown className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <p className="stat-label">Total Expenses</p>
              <p className="text-xl font-bold text-red-600">
                {formatCurrency(data?.totalExpenses || 0)}
              </p>
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary-50 flex items-center justify-center">
              <Wallet className="w-6 h-6 text-primary-600" />
            </div>
            <div>
              <p className="stat-label">Net Balance</p>
              <p className={`text-xl font-bold ${(data?.netBalance || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {formatCurrency(data?.netBalance || 0)}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
