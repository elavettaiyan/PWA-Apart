import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3, TrendingUp, TrendingDown, Users, AlertTriangle,
  FileText, DollarSign,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from 'recharts';
import api from '../../lib/api';
import { formatCurrency, getMonthName, cn } from '../../lib/utils';
import { PageLoader } from '../../components/ui/Loader';
import type { CollectionReport, PnLReport } from '../../types';

const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#64748b'];

type ReportTab = 'collection' | 'defaulters' | 'expenses' | 'pnl';

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<ReportTab>('collection');
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [pnlFrom, setPnlFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [pnlTo, setPnlTo] = useState(`${new Date().getFullYear()}-12-31`);

  const tabs: { id: ReportTab; label: string; icon: React.ElementType }[] = [
    { id: 'collection', label: 'Collection Report', icon: TrendingUp },
    { id: 'defaulters', label: 'Defaulters', icon: AlertTriangle },
    { id: 'expenses', label: 'Expense Summary', icon: DollarSign },
    { id: 'pnl', label: 'P&L Report', icon: BarChart3 },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="text-sm text-gray-500 mt-1">Financial reports and analytics</p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-2 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition',
              activeTab === tab.id
                ? 'bg-primary-600 text-white shadow-sm'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50',
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'collection' && <CollectionReportTab month={month} year={year} setMonth={setMonth} setYear={setYear} />}
      {activeTab === 'defaulters' && <DefaultersTab />}
      {activeTab === 'expenses' && <ExpenseSummaryTab />}
      {activeTab === 'pnl' && <PnLTab from={pnlFrom} to={pnlTo} setFrom={setPnlFrom} setTo={setPnlTo} />}
    </div>
  );
}

// ── COLLECTION REPORT ───────────────────────────────────
function CollectionReportTab({ month, year, setMonth, setYear }: any) {
  const { data, isLoading } = useQuery<CollectionReport>({
    queryKey: ['report-collection', month, year],
    queryFn: async () => (await api.get(`/reports/collection?month=${month}&year=${year}`)).data,
  });

  if (isLoading) return <PageLoader />;

  const summary = data?.summary;

  return (
    <div>
      <div className="flex gap-3 mb-6">
        <select className="select w-40" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{getMonthName(i + 1)}</option>)}
        </select>
        <select className="select w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {summary && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="stat-card">
              <p className="stat-label">Total Billed</p>
              <p className="stat-value text-lg">{formatCurrency(summary.totalBilled)}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">Collected</p>
              <p className="text-lg font-bold text-emerald-600">{formatCurrency(summary.totalCollected)}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">Pending</p>
              <p className="text-lg font-bold text-amber-600">{formatCurrency(summary.totalPending)}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">Collection Rate</p>
              <p className="text-lg font-bold text-primary-600">{summary.collectionRate}%</p>
            </div>
          </div>

          {/* Collection bar chart */}
          <div className="card p-6 mb-6">
            <h3 className="font-semibold text-gray-900 mb-4">Payment Status Distribution</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={[
                { name: 'Paid', count: summary.paidCount, fill: '#10b981' },
                { name: 'Pending', count: summary.pendingCount, fill: '#f59e0b' },
                { name: 'Partial', count: summary.partialCount, fill: '#6366f1' },
              ]}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {[
                    { fill: '#10b981' }, { fill: '#f59e0b' }, { fill: '#6366f1' },
                  ].map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

// ── DEFAULTERS ──────────────────────────────────────────
function DefaultersTab() {
  const { data, isLoading } = useQuery<{
    defaulters: any[];
    totalDefaulters: number;
    totalOutstanding: number;
  }>({
    queryKey: ['report-defaulters'],
    queryFn: async () => (await api.get('/reports/defaulters')).data,
  });

  if (isLoading) return <PageLoader />;

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="stat-card">
          <p className="stat-label">Total Defaulters</p>
          <p className="text-2xl font-bold text-red-600">{data?.totalDefaulters || 0}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Total Outstanding</p>
          <p className="text-2xl font-bold text-red-600">{formatCurrency(data?.totalOutstanding || 0)}</p>
        </div>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Flat</th>
              <th>Owner</th>
              <th>Phone</th>
              <th>Pending Bills</th>
              <th>Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {data?.defaulters?.map((d: any, i: number) => (
              <tr key={i}>
                <td>
                  <p className="font-medium">{d.flat.flatNumber}</p>
                  <p className="text-xs text-gray-500">{d.flat.block?.name}</p>
                </td>
                <td>{d.flat.owner?.name || '-'}</td>
                <td className="text-sm text-gray-500">{d.flat.owner?.phone}</td>
                <td><span className="badge badge-danger">{d.bills.length} months</span></td>
                <td className="font-bold text-red-600">{formatCurrency(d.totalOutstanding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── EXPENSE SUMMARY ─────────────────────────────────────
function ExpenseSummaryTab() {
  const { data, isLoading } = useQuery<{
    byCategory: any[];
    total: number;
    monthlyTrend: Record<string, number>;
  }>({
    queryKey: ['report-expense-summary'],
    queryFn: async () => (await api.get('/reports/expense-summary')).data,
  });

  if (isLoading) return <PageLoader />;

  const pieData = data?.byCategory?.map((c: any) => ({
    name: c.category.replace('_', ' '),
    value: c._sum?.amount || 0,
  })) || [];

  const trendData = Object.entries(data?.monthlyTrend || {}).map(([month, amount]) => ({
    month,
    amount,
  }));

  return (
    <div>
      <div className="stat-card mb-6">
        <p className="stat-label">Total Expenses</p>
        <p className="text-2xl font-bold text-red-600">{formatCurrency(data?.total || 0)}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pie Chart */}
        <div className="card p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Expenses by Category</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}>
                {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(value: number) => formatCurrency(value)} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Monthly Trend */}
        <div className="card p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Monthly Expense Trend</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(value: number) => formatCurrency(value)} />
              <Line type="monotone" dataKey="amount" stroke="#ef4444" strokeWidth={2} dot={{ fill: '#ef4444' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ── P&L REPORT ──────────────────────────────────────────
function PnLTab({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  const { data, isLoading } = useQuery<PnLReport>({
    queryKey: ['report-pnl', from, to],
    queryFn: async () => (await api.get(`/reports/pnl?fromDate=${from}&toDate=${to}`)).data,
  });

  if (isLoading) return <PageLoader />;

  // Merge income and expense months for chart
  const allMonths = new Set([
    ...Object.keys(data?.income?.byMonth || {}),
    ...Object.keys(data?.expenses?.byMonth || {}),
  ]);
  const chartData = Array.from(allMonths).sort().map((month) => ({
    month,
    income: data?.income?.byMonth?.[month] || 0,
    expenses: data?.expenses?.byMonth?.[month] || 0,
    profit: (data?.income?.byMonth?.[month] || 0) - (data?.expenses?.byMonth?.[month] || 0),
  }));

  const isProfit = (data?.netProfitLoss || 0) >= 0;

  return (
    <div>
      {/* Date Range Filter */}
      <div className="flex gap-3 mb-6 items-end">
        <div>
          <label className="label">From</label>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label">To</label>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {/* P&L Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="stat-card">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-500" />
            <p className="stat-label">Total Income</p>
          </div>
          <p className="text-2xl font-bold text-emerald-600">{formatCurrency(data?.income?.total || 0)}</p>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2">
            <TrendingDown className="w-5 h-5 text-red-500" />
            <p className="stat-label">Total Expenses</p>
          </div>
          <p className="text-2xl font-bold text-red-600">{formatCurrency(data?.expenses?.total || 0)}</p>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2">
            {isProfit ? <TrendingUp className="w-5 h-5 text-emerald-500" /> : <TrendingDown className="w-5 h-5 text-red-500" />}
            <p className="stat-label">Net {isProfit ? 'Profit' : 'Loss'}</p>
          </div>
          <p className={cn('text-2xl font-bold', isProfit ? 'text-emerald-600' : 'text-red-600')}>
            {formatCurrency(Math.abs(data?.netProfitLoss || 0))}
          </p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Profit Margin</p>
          <p className={cn('text-2xl font-bold', isProfit ? 'text-emerald-600' : 'text-red-600')}>
            {data?.profitMargin || '0'}%
          </p>
        </div>
      </div>

      {/* Income vs Expense Chart */}
      <div className="card p-6 mb-6">
        <h3 className="font-semibold text-gray-900 mb-4">Income vs Expenses (Monthly)</h3>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip formatter={(value: number) => formatCurrency(value)} />
            <Legend />
            <Bar dataKey="income" name="Income" fill="#10b981" radius={[4, 4, 0, 0]} />
            <Bar dataKey="expenses" name="Expenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Expense Breakdown Table */}
      <div className="card p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Expense Breakdown by Category</h3>
        <div className="space-y-3">
          {data?.expenses?.byCategory?.map((cat: any, i: number) => {
            const pct = data.expenses.total > 0 ? ((cat._sum.amount / data.expenses.total) * 100).toFixed(1) : '0';
            return (
              <div key={i} className="flex items-center gap-4">
                <div className="w-32 text-sm font-medium text-gray-700">{cat.category.replace('_', ' ')}</div>
                <div className="flex-1">
                  <div className="h-6 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: COLORS[i % COLORS.length],
                      }}
                    />
                  </div>
                </div>
                <div className="w-24 text-right text-sm font-semibold text-gray-700">
                  {formatCurrency(cat._sum.amount)}
                </div>
                <div className="w-12 text-right text-xs text-gray-500">{pct}%</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
