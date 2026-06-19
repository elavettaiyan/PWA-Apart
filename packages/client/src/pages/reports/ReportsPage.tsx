import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  BarChart3, TrendingUp, TrendingDown, Users, AlertTriangle,
  DollarSign, Download, Loader2,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from 'recharts';
import api from '../../lib/api';
import { formatCurrency, getMonthName, cn } from '../../lib/utils';
import { PageLoader } from '../../components/ui/Loader';
import type { CollectionReport, PnLReport, ResidentReport } from '../../types';
import toast from 'react-hot-toast';

const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#64748b'];

type ReportTab = 'collection' | 'residents' | 'defaulters' | 'expenses' | 'pnl';

type PnlPreset = 'month' | 'quarter' | 'year';

function formatDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getPresetRange(preset: PnlPreset) {
  const today = new Date();

  if (preset === 'month') {
    return {
      from: formatDateInputValue(new Date(today.getFullYear(), today.getMonth(), 1)),
      to: formatDateInputValue(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
    };
  }

  if (preset === 'quarter') {
    const quarterStartMonth = Math.floor(today.getMonth() / 3) * 3;
    return {
      from: formatDateInputValue(new Date(today.getFullYear(), quarterStartMonth, 1)),
      to: formatDateInputValue(new Date(today.getFullYear(), quarterStartMonth + 3, 0)),
    };
  }

  return {
    from: formatDateInputValue(new Date(today.getFullYear(), 0, 1)),
    to: formatDateInputValue(new Date(today.getFullYear(), 11, 31)),
  };
}

function getFilenameFromDisposition(disposition?: string | null) {
  if (!disposition) {
    return null;
  }

  const match = disposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] || null;
}

async function downloadReportFile(endpoint: string, fallbackFilename: string) {
  const response = await api.get(endpoint, { responseType: 'blob' });
  const contentType = response.headers['content-type'];
  const blob = new Blob([response.data], {
    type: (typeof contentType === 'string' ? contentType : '') || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const disposition = response.headers['content-disposition'];
  link.download = getFilenameFromDisposition(typeof disposition === 'string' ? disposition : null) || fallbackFilename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<ReportTab>('collection');
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [pnlFrom, setPnlFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [pnlTo, setPnlTo] = useState(`${new Date().getFullYear()}-12-31`);

  const tabs: { id: ReportTab; label: string; icon: React.ElementType }[] = [
    { id: 'collection', label: 'Collection Report', icon: TrendingUp },
    { id: 'residents', label: 'Resident Report', icon: Users },
    { id: 'defaulters', label: 'Defaulters', icon: AlertTriangle },
    { id: 'expenses', label: 'Expense Summary', icon: DollarSign },
    { id: 'pnl', label: 'P&L Report', icon: BarChart3 },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="mt-1 text-sm text-on-surface-variant">Analyze collections, residents, defaulters, and expense trends.</p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-5 -mx-1 px-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition whitespace-nowrap',
              activeTab === tab.id
                ? 'bg-primary text-white shadow-sm'
                : 'bg-white text-[#64748B] hover:bg-[#F8FAFC]',
            )}
            style={activeTab !== tab.id ? { boxShadow: '0 1px 4px -1px rgba(0,0,0,0.04)' } : undefined}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'collection' && <CollectionReportTab month={month} year={year} setMonth={setMonth} setYear={setYear} />}
      {activeTab === 'residents' && <ResidentReportTab />}
      {activeTab === 'defaulters' && <DefaultersTab />}
      {activeTab === 'expenses' && <ExpenseSummaryTab />}
      {activeTab === 'pnl' && <PnLTab from={pnlFrom} to={pnlTo} setFrom={setPnlFrom} setTo={setPnlTo} />}
    </div>
  );
}

// ── RESIDENT REPORT ─────────────────────────────────────
function ResidentReportTab() {
  const [isExporting, setIsExporting] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [draftFilters, setDraftFilters] = useState({
    name: '',
    mobile: '',
    carNumber: '',
  });
  const [appliedFilters, setAppliedFilters] = useState(draftFilters);
  const pageSize = 20;

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setAppliedFilters((current) => {
        if (
          current.name === draftFilters.name
          && current.mobile === draftFilters.mobile
          && current.carNumber === draftFilters.carNumber
        ) {
          return current;
        }

        return draftFilters;
      });
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [draftFilters]);

  useEffect(() => {
    setPage(1);
  }, [appliedFilters]);

  const queryString = useMemo(() => {
    const searchParams = new URLSearchParams();
    if (appliedFilters.name.trim()) searchParams.set('name', appliedFilters.name.trim());
    if (appliedFilters.mobile.trim()) searchParams.set('mobile', appliedFilters.mobile.trim());
    if (appliedFilters.carNumber.trim()) searchParams.set('carNumber', appliedFilters.carNumber.trim());
    searchParams.set('page', String(page));
    searchParams.set('pageSize', String(pageSize));
    return searchParams.toString();
  }, [appliedFilters, page]);

  const exportQueryString = useMemo(() => {
    const exportParams = new URLSearchParams();
    if (appliedFilters.name.trim()) exportParams.set('name', appliedFilters.name.trim());
    if (appliedFilters.mobile.trim()) exportParams.set('mobile', appliedFilters.mobile.trim());
    if (appliedFilters.carNumber.trim()) exportParams.set('carNumber', appliedFilters.carNumber.trim());
    return exportParams.toString();
  }, [appliedFilters]);

  const { data, isLoading, isFetching, isError, error } = useQuery<ResidentReport>({
    queryKey: ['report-residents', appliedFilters.name, appliedFilters.mobile, appliedFilters.carNumber, page, pageSize],
    queryFn: async () => (await api.get(`/reports/residents?${queryString}`)).data,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  if (isLoading && !data) return <PageLoader />;

  if (isError) {
    return (
      <div className="rounded-2xl border border-error/20 bg-error/5 px-4 py-6 text-sm text-error">
        {((error as any)?.response?.data?.error as string | undefined) || 'Failed to load resident report.'}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-on-surface-variant">
          <p>All residents are shown by default. Use filters only when needed.</p>
          {isFetching ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-container px-2 py-1 text-xs text-on-surface-variant">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Updating...
            </span>
          ) : null}
        </div>
        <button type="button" className="btn-secondary" onClick={() => setShowFilters((current) => !current)}>
          {showFilters ? 'Hide Filters' : 'Show Filters'}
        </button>
      </div>

      {showFilters && (
        <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="label">Name</label>
            <input
              className="input"
              value={draftFilters.name}
              onChange={(e) => setDraftFilters((current) => ({ ...current, name: e.target.value }))}
              placeholder="Search by resident name"
            />
          </div>
          <div>
            <label className="label">Mobile Number</label>
            <input
              className="input"
              value={draftFilters.mobile}
              onChange={(e) => setDraftFilters((current) => ({ ...current, mobile: e.target.value }))}
              placeholder="Search by mobile number"
            />
          </div>
          <div>
            <label className="label">Car Number</label>
            <input
              className="input"
              value={draftFilters.carNumber}
              onChange={(e) => setDraftFilters((current) => ({ ...current, carNumber: e.target.value }))}
              placeholder="Search by car number"
            />
          </div>
          <div className="md:col-span-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-outline-variant/10 bg-surface-container/40 px-4 py-3">
            <p className="text-xs text-on-surface-variant">
              Search updates automatically after you pause typing.
            </p>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setDraftFilters({ name: '', mobile: '', carNumber: '' });
                setAppliedFilters({ name: '', mobile: '', carNumber: '' });
                setPage(1);
              }}
              disabled={!draftFilters.name && !draftFilters.mobile && !draftFilters.carNumber}
            >
              Clear Filters
            </button>
          </div>
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="grid grid-cols-3 gap-4">
          <div className="stat-card">
            <p className="stat-label">Total Residents</p>
            <p className="text-2xl font-bold text-on-surface">{data?.summary.totalResidents || 0}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Owners</p>
            <p className="text-2xl font-bold text-sky-900">{data?.summary.owners || 0}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Tenants</p>
            <p className="text-2xl font-bold text-emerald-900">{data?.summary.tenants || 0}</p>
          </div>
        </div>
        <button
          type="button"
          className="btn-secondary"
          disabled={isExporting}
          onClick={async () => {
            try {
              setIsExporting(true);
              await downloadReportFile(`/reports/residents/export${exportQueryString ? `?${exportQueryString}` : ''}`, 'resident-report.xlsx');
            } catch (error: any) {
              toast.error(error.response?.data?.error || 'Failed to export resident report');
            } finally {
              setIsExporting(false);
            }
          }}
        >
          <Download className="h-4 w-4" /> {isExporting ? 'Exporting...' : 'Export Excel'}
        </button>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Resident</th>
              <th>Relation</th>
              <th>Mobile</th>
              <th>Car Number</th>
              <th>Flat</th>
              <th>Block</th>
            </tr>
          </thead>
          <tbody>
            {data?.residents?.map((resident, index) => (
              <tr key={`${resident.relation}-${resident.flatNumber}-${resident.mobile}-${index}`}>
                <td>
                  <p className="font-medium">{resident.name}</p>
                  <p className="text-xs text-on-surface-variant">{resident.email || '—'}</p>
                </td>
                <td>
                  <span className={cn('badge', resident.relation === 'OWNER' ? 'badge-info' : 'badge-success')}>
                    {resident.relation}
                  </span>
                </td>
                <td>{resident.mobile || '—'}</td>
                <td>{resident.carNumber || '—'}</td>
                <td>{resident.flatNumber}</td>
                <td>{resident.blockName || '—'}</td>
              </tr>
            ))}
            {(!data?.residents || data.residents.length === 0) && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-on-surface-variant">No residents matched the selected filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-sm text-on-surface-variant">
          Showing page {data?.pagination.page || 1} of {data?.pagination.totalPages || 1} · {data?.pagination.totalItems || 0} residents
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={!data || data.pagination.page <= 1}
            onClick={() => setPage((current) => Math.max(current - 1, 1))}
          >
            Previous
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={!data || data.pagination.page >= data.pagination.totalPages}
            onClick={() => setPage((current) => (!data ? current : Math.min(current + 1, data.pagination.totalPages)))}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

// ── COLLECTION REPORT ───────────────────────────────────
function CollectionReportTab({ month, year, setMonth, setYear }: any) {
  const [isExporting, setIsExporting] = useState(false);
  const { data, isLoading, isFetching } = useQuery<CollectionReport>({
    queryKey: ['report-collection', month, year],
    queryFn: async () => (await api.get(`/reports/collection?month=${month}&year=${year}`)).data,
    placeholderData: keepPreviousData,
  });

  if (isLoading && !data) return <PageLoader />;

  const summary = data?.summary;

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-3">
        <select className="select w-40" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{getMonthName(i + 1)}</option>)}
        </select>
        <select className="select w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        {isFetching ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-container px-3 py-2 text-xs text-on-surface-variant">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Updating...
          </span>
        ) : null}
        <button
          type="button"
          className="btn-secondary"
          disabled={isExporting}
          onClick={async () => {
            try {
              setIsExporting(true);
              await downloadReportFile(`/reports/collection/export?month=${month}&year=${year}`, `collection-report-${year}-${String(month).padStart(2, '0')}.xlsx`);
            } catch (error: any) {
              toast.error(error.response?.data?.error || 'Failed to export collection report');
            } finally {
              setIsExporting(false);
            }
          }}
        >
          <Download className="h-4 w-4" /> {isExporting ? 'Exporting...' : 'Export Excel'}
        </button>
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
              <p className="text-lg font-bold text-emerald-900">{formatCurrency(summary.totalCollected)}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">Pending</p>
              <p className="text-lg font-bold text-warning">{formatCurrency(summary.totalPending)}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">Collection Rate</p>
              <p className="text-lg font-bold text-primary">{summary.collectionRate}%</p>
            </div>
          </div>

          {/* Collection bar chart */}
          <div className="card p-6 mb-6">
            <h3 className="font-semibold text-on-surface mb-4">Payment Status Distribution</h3>
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
  const [isExporting, setIsExporting] = useState(false);
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
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="grid grid-cols-2 gap-4">
          <div className="stat-card">
            <p className="stat-label">Total Defaulters</p>
            <p className="text-2xl font-bold text-rose-900">{data?.totalDefaulters || 0}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Total Outstanding</p>
            <p className="text-2xl font-bold text-rose-900">{formatCurrency(data?.totalOutstanding || 0)}</p>
          </div>
        </div>
        <button
          type="button"
          className="btn-secondary"
          disabled={isExporting}
          onClick={async () => {
            try {
              setIsExporting(true);
              await downloadReportFile('/reports/defaulters/export', 'defaulters-report.xlsx');
            } catch (error: any) {
              toast.error(error.response?.data?.error || 'Failed to export defaulters report');
            } finally {
              setIsExporting(false);
            }
          }}
        >
          <Download className="h-4 w-4" /> {isExporting ? 'Exporting...' : 'Export Excel'}
        </button>
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
            {data?.defaulters?.map((d: any, i: number) => {
              const activeOwner = d.flat.owner?.isActive === false ? null : d.flat.owner;
              return (
              <tr key={i}>
                <td>
                  <p className="font-medium">{d.flat.flatNumber}</p>
                  <p className="text-xs text-on-surface-variant">{d.flat.block?.name}</p>
                </td>
                <td>{activeOwner?.name || '-'}</td>
                <td className="text-sm text-on-surface-variant">{activeOwner?.phone}</td>
                <td><span className="badge badge-danger">{d.bills.length} months</span></td>
                <td className="font-bold text-rose-900">{formatCurrency(d.totalOutstanding)}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── EXPENSE SUMMARY ─────────────────────────────────────
function ExpenseSummaryTab() {
  const [isExporting, setIsExporting] = useState(false);
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
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="stat-card">
          <p className="stat-label">Total Expenses</p>
          <p className="text-2xl font-bold text-rose-900">{formatCurrency(data?.total || 0)}</p>
        </div>
        <button
          type="button"
          className="btn-secondary"
          disabled={isExporting}
          onClick={async () => {
            try {
              setIsExporting(true);
              await downloadReportFile('/reports/expense-summary/export', 'expense-summary-report.xlsx');
            } catch (error: any) {
              toast.error(error.response?.data?.error || 'Failed to export expense summary');
            } finally {
              setIsExporting(false);
            }
          }}
        >
          <Download className="h-4 w-4" /> {isExporting ? 'Exporting...' : 'Export Excel'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pie Chart */}
        <div className="card p-6">
          <h3 className="font-semibold text-on-surface mb-4">Expenses by Category</h3>
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
          <h3 className="font-semibold text-on-surface mb-4">Monthly Expense Trend</h3>
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
  const [isExporting, setIsExporting] = useState(false);
  const { data, isLoading, isFetching } = useQuery<PnLReport>({
    queryKey: ['report-pnl', from, to],
    queryFn: async () => (await api.get(`/reports/pnl?fromDate=${from}&toDate=${to}`)).data,
    placeholderData: keepPreviousData,
  });

  if (isLoading && !data) return <PageLoader />;

  // Merge income and expense months for chart
  const allMonths = new Set([
    ...Object.keys(data?.billedIncome?.byMonth || {}),
    ...Object.keys(data?.collectedIncome?.byMonth || {}),
    ...Object.keys(data?.expenses?.byMonth || {}),
  ]);
  const chartData = Array.from(allMonths).sort().map((month) => ({
    month,
    billedIncome: data?.billedIncome?.byMonth?.[month] || 0,
    collectedIncome: data?.collectedIncome?.byMonth?.[month] || 0,
    expenses: data?.expenses?.byMonth?.[month] || 0,
    profit: (data?.billedIncome?.byMonth?.[month] || 0) - (data?.expenses?.byMonth?.[month] || 0),
  }));

  const isProfit = (data?.netProfitLoss || 0) >= 0;
  const isCashPositive = (data?.cashSurplus || 0) >= 0;
  const agingData = [
    { label: 'Current', value: data?.receivables?.agingBuckets.current || 0 },
    { label: '1-30 Days', value: data?.receivables?.agingBuckets.days1To30 || 0 },
    { label: '31-60 Days', value: data?.receivables?.agingBuckets.days31To60 || 0 },
    { label: '61-90 Days', value: data?.receivables?.agingBuckets.days61To90 || 0 },
    { label: '90+ Days', value: data?.receivables?.agingBuckets.days90Plus || 0 },
  ];
  const incomeBreakdownData = [
    { label: 'Maintenance', value: data?.billedIncome?.byComponent.baseAmount || 0 },
    { label: 'Water', value: data?.billedIncome?.byComponent.waterCharge || 0 },
    { label: 'Parking', value: data?.billedIncome?.byComponent.parkingCharge || 0 },
    { label: 'Sinking Fund', value: data?.billedIncome?.byComponent.sinkingFund || 0 },
    { label: 'Repair Fund', value: data?.billedIncome?.byComponent.repairFund || 0 },
    { label: 'Other', value: data?.billedIncome?.byComponent.otherCharges || 0 },
    { label: 'Late Fee', value: data?.billedIncome?.byComponent.lateFee || 0 },
  ].filter((item) => item.value > 0);
  const billKindBreakdownData = [
    { label: 'Maintenance Bills', value: data?.billedIncome?.byKind?.maintenance || 0 },
    { label: 'Opening Balances', value: data?.billedIncome?.byKind?.openingBalance || 0 },
    { label: 'Special Charges', value: data?.billedIncome?.byKind?.special || 0 },
  ].filter((item) => item.value > 0);
  const specialChargeBreakdownData = [
    { label: 'Fines', value: data?.billedIncome?.bySpecialCategory?.fine || 0 },
    { label: 'Damage', value: data?.billedIncome?.bySpecialCategory?.damage || 0 },
    { label: 'Common Item Breakage', value: data?.billedIncome?.bySpecialCategory?.commonItemBreakage || 0 },
    { label: 'Other Special', value: data?.billedIncome?.bySpecialCategory?.other || 0 },
  ].filter((item) => item.value > 0);

  return (
    <div>
      {/* Date Range Filter */}
      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap gap-2">
          {([
            { id: 'month', label: 'This Month' },
            { id: 'quarter', label: 'This Quarter' },
            { id: 'year', label: 'This Year' },
          ] as Array<{ id: PnlPreset; label: string }>).map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="rounded-lg border border-outline-variant/15 bg-white px-3 py-2 text-sm font-medium text-on-surface-variant transition hover:bg-surface-container-low"
              onClick={() => {
                const range = getPresetRange(preset.id);
                setFrom(range.from);
                setTo(range.to);
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div>
            <label className="label">From</label>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          {isFetching ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-container px-3 py-2 text-xs text-on-surface-variant sm:mb-0">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Updating...
            </span>
          ) : null}
          <button
            type="button"
            className="btn-secondary sm:mb-0"
            disabled={isExporting}
            onClick={async () => {
              try {
                setIsExporting(true);
                await downloadReportFile(`/reports/pnl/export?fromDate=${from}&toDate=${to}`, `pnl-report-${from}-to-${to}.xlsx`);
              } catch (error: any) {
                toast.error(error.response?.data?.error || 'Failed to export P&L report');
              } finally {
                setIsExporting(false);
              }
            }}
          >
            <Download className="h-4 w-4" /> {isExporting ? 'Exporting...' : 'Export Excel'}
          </button>
        </div>
      </div>

      {/* P&L Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4 mb-6">
        <div className="stat-card">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-700" />
            <p className="stat-label">Billed Income</p>
          </div>
          <p className="text-2xl font-bold text-emerald-900">{formatCurrency(data?.billedIncome?.total || 0)}</p>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-sky-700" />
            <p className="stat-label">Collected Income</p>
          </div>
          <p className="text-2xl font-bold text-sky-900">{formatCurrency(data?.collectedIncome?.total || 0)}</p>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2">
            <TrendingDown className="w-5 h-5 text-rose-700" />
            <p className="stat-label">Total Expenses</p>
          </div>
          <p className="text-2xl font-bold text-rose-900">{formatCurrency(data?.expenses?.total || 0)}</p>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2">
            {isProfit ? <TrendingUp className="w-5 h-5 text-emerald-700" /> : <TrendingDown className="w-5 h-5 text-rose-700" />}
            <p className="stat-label">Accrual {isProfit ? 'Profit' : 'Loss'}</p>
          </div>
          <p className={cn('text-2xl font-bold', isProfit ? 'text-emerald-900' : 'text-rose-900')}>
            {formatCurrency(Math.abs(data?.netProfitLoss || 0))}
          </p>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2">
            {isCashPositive ? <TrendingUp className="w-5 h-5 text-emerald-700" /> : <TrendingDown className="w-5 h-5 text-rose-700" />}
            <p className="stat-label">Cash Surplus</p>
          </div>
          <p className={cn('text-2xl font-bold', isCashPositive ? 'text-emerald-900' : 'text-rose-900')}>
            {formatCurrency(Math.abs(data?.cashSurplus || 0))}
          </p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Receivables</p>
          <p className="text-2xl font-bold text-warning">{formatCurrency(data?.receivables?.totalOutstanding || 0)}</p>
          <p className="mt-1 text-xs text-on-surface-variant">Margin {data?.profitMargin || '0'}%</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="card p-6">
          <h3 className="font-semibold text-on-surface mb-4">Reserve Fund Position</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl bg-[#F8FAFC] p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-[#94A3B8]">Sinking fund billed</p>
              <p className="mt-1 text-lg font-semibold text-on-surface">{formatCurrency(data?.reserveFunds?.sinkingFundBilled || 0)}</p>
              <p className="mt-1 text-xs text-[#94A3B8]">Collected {formatCurrency(data?.reserveFunds?.sinkingFundCollected || 0)}</p>
            </div>
            <div className="rounded-xl bg-[#F8FAFC] p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-[#94A3B8]">Repair fund billed</p>
              <p className="mt-1 text-lg font-semibold text-on-surface">{formatCurrency(data?.reserveFunds?.repairFundBilled || 0)}</p>
              <p className="mt-1 text-xs text-[#94A3B8]">Collected {formatCurrency(data?.reserveFunds?.repairFundCollected || 0)}</p>
            </div>
            <div className="rounded-xl bg-[#F8FAFC] px-4 py-3 sm:col-span-2">
              <p className="text-sm text-on-surface-variant">
                Outstanding reserve collections: {formatCurrency((data?.reserveFunds?.sinkingFundOutstanding || 0) + (data?.reserveFunds?.repairFundOutstanding || 0))}
              </p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <h3 className="font-semibold text-on-surface mb-4">Receivables Aging</h3>
          <div className="space-y-3">
            {agingData.map((bucket) => (
              <div key={bucket.label} className="flex items-center justify-between gap-4 rounded-xl bg-surface-container-low px-4 py-3">
                <p className="text-sm font-medium text-on-surface">{bucket.label}</p>
                <p className="text-sm font-semibold text-on-surface-variant">{formatCurrency(bucket.value)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card p-6 mb-6">
        <h3 className="font-semibold text-on-surface mb-4">Billed vs Collected vs Expenses</h3>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip formatter={(value: number) => formatCurrency(value)} />
            <Legend />
            <Bar dataKey="billedIncome" name="Billed Income" fill="#10b981" radius={[4, 4, 0, 0]} />
            <Bar dataKey="collectedIncome" name="Collected Income" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
            <Bar dataKey="expenses" name="Expenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="card p-6">
          <h3 className="font-semibold text-on-surface mb-4">Billed Income Breakdown</h3>
          <div className="space-y-3">
            {incomeBreakdownData.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-4 rounded-xl bg-surface-container-low px-4 py-3">
                <p className="text-sm font-medium text-on-surface">{item.label}</p>
                <p className="text-sm font-semibold text-on-surface-variant">{formatCurrency(item.value)}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-6">
          <h3 className="font-semibold text-on-surface mb-4">Billing Type Breakdown</h3>
          <div className="space-y-3">
            {billKindBreakdownData.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-4 rounded-xl bg-surface-container-low px-4 py-3">
                <p className="text-sm font-medium text-on-surface">{item.label}</p>
                <p className="text-sm font-semibold text-on-surface-variant">{formatCurrency(item.value)}</p>
              </div>
            ))}
            {specialChargeBreakdownData.length ? <div className="border-t border-outline-variant/15 pt-3" /> : null}
            {specialChargeBreakdownData.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-4 rounded-xl bg-white px-4 py-3 border border-outline-variant/10">
                <p className="text-sm font-medium text-on-surface">{item.label}</p>
                <p className="text-sm font-semibold text-on-surface-variant">{formatCurrency(item.value)}</p>
              </div>
            ))}
            {!billKindBreakdownData.length && !specialChargeBreakdownData.length ? (
              <p className="text-sm text-on-surface-variant">No opening balance or special charge billing in this period.</p>
            ) : null}
          </div>
        </div>

        <div className="card p-6 lg:col-span-2">
          <h3 className="font-semibold text-on-surface mb-4">Expense Breakdown by Category</h3>
          <div className="space-y-3">
            {data?.expenses?.byCategory?.map((cat: any, i: number) => {
              const pct = data.expenses.total > 0 ? ((cat._sum.amount / data.expenses.total) * 100).toFixed(1) : '0';
              return (
                <div key={i} className="flex items-center gap-4">
                  <div className="w-32 text-sm font-medium text-on-surface-variant">{cat.category.replace('_', ' ')}</div>
                  <div className="flex-1">
                    <div className="h-6 bg-surface-container rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: COLORS[i % COLORS.length],
                        }}
                      />
                    </div>
                  </div>
                  <div className="w-24 text-right text-sm font-semibold text-on-surface-variant">
                    {formatCurrency(cat._sum.amount)}
                  </div>
                  <div className="w-12 text-right text-xs text-on-surface-variant">{pct}%</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
