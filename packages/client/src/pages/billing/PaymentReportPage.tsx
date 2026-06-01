import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { formatCurrency, formatDate, getMonthName, getStatusColor } from '../../lib/utils';
import { PageLoader, EmptyState } from '../../components/ui/Loader';
import { useAuthStore } from '../../store/authStore';
import type { PaymentHistoryItem } from '../../types';

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'INITIATED', label: 'Initiated' },
  { value: 'SUCCESS', label: 'Success' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'REFUNDED', label: 'Refunded' },
];

interface ReportResponse {
  payments: PaymentHistoryItem[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export default function PaymentReportPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [exportLoading, setExportLoading] = useState(false);

  function buildParams(overrides: Record<string, string> = {}) {
    const params = new URLSearchParams({ page: String(page), limit: '50' });
    if (statusFilter) params.set('status', statusFilter);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    // SUPER_ADMIN must pass societyId
    if (user?.role === 'SUPER_ADMIN' && user?.societyId) params.set('societyId', user.societyId);
    Object.entries(overrides).forEach(([k, v]) => params.set(k, v));
    return params;
  }

  const { data, isLoading, isError } = useQuery<ReportResponse>({
    queryKey: ['payment-report', page, statusFilter, startDate, endDate, user?.societyId],
    queryFn: async () => {
      const { data } = await api.get<ReportResponse>(`/payments/report?${buildParams()}`);
      return data;
    },
    staleTime: 30_000,
  });

  async function handleExportCsv() {
    setExportLoading(true);
    try {
      const params = buildParams({ export: 'csv' });
      const response = await api.get(`/payments/report?${params}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([response.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `payments-report-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('CSV export failed. Please try again.');
    } finally {
      setExportLoading(false);
    }
  }

  function handleFilterChange() {
    setPage(1);
  }

  if (isLoading) return <PageLoader />;

  const payments = data?.payments ?? [];
  const totalPages = data?.pages ?? 1;

  return (
    <div className="page-container max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/billing')} className="btn btn-ghost btn-sm" aria-label="Back to billing">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="page-title mb-0">Online Payment Report</h1>
            <p className="text-sm text-base-content/60 mt-0.5">
              PhonePe payment reconciliation — {data?.total ?? 0} records
            </p>
          </div>
        </div>
        <button
          className="btn btn-outline btn-sm gap-2"
          onClick={handleExportCsv}
          disabled={exportLoading || payments.length === 0}
        >
          <Download className="w-4 h-4" />
          {exportLoading ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {/* Filters */}
      <div className="card bg-base-100 shadow-sm mb-4 p-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <select
            className="select select-bordered select-sm"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); handleFilterChange(); }}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <input
            type="date"
            className="input input-bordered input-sm"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); handleFilterChange(); }}
          />

          <input
            type="date"
            className="input input-bordered input-sm"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); handleFilterChange(); }}
          />
        </div>
      </div>

      {isError && (
        <div className="alert alert-error mb-4">Failed to load payment report. Please try again.</div>
      )}

      {!isLoading && payments.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No online payments found"
          description="No PhonePe payments match your filters."
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block card bg-base-100 shadow-sm overflow-x-auto">
            <table className="table table-zebra w-full text-sm">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Flat / Block</th>
                  <th>Period</th>
                  <th className="text-right">Amount</th>
                  <th>Merchant Txn ID</th>
                  <th>PhonePe Txn ID</th>
                  <th>Gateway Ref ID</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap">
                      {p.paidAt ? formatDate(p.paidAt) : formatDate(p.createdAt ?? '')}
                    </td>
                    <td>
                      <span className="font-medium">{p.bill.flat.flatNumber}</span>
                      <span className="text-base-content/50 ml-1 text-xs">{p.bill.flat.block.name}</span>
                    </td>
                    <td className="whitespace-nowrap">
                      {getMonthName(p.bill.month)} {p.bill.year}
                    </td>
                    <td className="text-right font-medium">{formatCurrency(p.amount)}</td>
                    <td>
                      <span className="font-mono text-xs text-base-content/70">{p.merchantTransId ?? '—'}</span>
                    </td>
                    <td>
                      <span className="font-mono text-xs text-base-content/70">{p.transactionId ?? '—'}</span>
                    </td>
                    <td>
                      <span className="font-mono text-xs font-semibold text-primary">{p.gatewayRefId ?? '—'}</span>
                    </td>
                    <td>
                      <span className={`badge badge-sm ${getStatusColor(p.status)}`}>{p.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="md:hidden space-y-3">
            {payments.map((p) => (
              <div key={p.id} className="card bg-base-100 shadow-sm p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-medium">
                      {p.bill.flat.flatNumber} · {p.bill.flat.block.name}
                    </p>
                    <p className="text-sm text-base-content/60">
                      {getMonthName(p.bill.month)} {p.bill.year}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{formatCurrency(p.amount)}</p>
                    <span className={`badge badge-sm mt-1 ${getStatusColor(p.status)}`}>{p.status}</span>
                  </div>
                </div>
                <div className="text-xs text-base-content/60 space-y-0.5">
                  <p>{p.paidAt ? formatDate(p.paidAt) : formatDate(p.createdAt ?? '')}</p>
                  {p.merchantTransId && <p>Merchant: <span className="font-mono">{p.merchantTransId}</span></p>}
                  {p.transactionId && <p>PhonePe: <span className="font-mono">{p.transactionId}</span></p>}
                  {p.gatewayRefId && (
                    <p>Gateway Ref: <span className="font-mono font-semibold text-primary">{p.gatewayRefId}</span></p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <button
                className="btn btn-sm btn-outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Prev
              </button>
              <span className="text-sm text-base-content/70">
                Page {page} of {totalPages} &nbsp;·&nbsp; {data?.total ?? 0} records
              </span>
              <button
                className="btn btn-sm btn-outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
