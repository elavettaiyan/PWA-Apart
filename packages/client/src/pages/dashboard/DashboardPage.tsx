import { useQuery } from '@tanstack/react-query';
import {
  Building2, Users, Receipt, MessageSquareWarning,
  Wallet, TrendingUp, TrendingDown, Home, CreditCard,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { PageLoader } from '../../components/ui/Loader';
import { useAuthStore } from '../../store/authStore';
import type { DashboardData } from '../../types';

export default function DashboardPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  return isAdmin ? <AdminDashboard /> : <ResidentDashboard />;
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
