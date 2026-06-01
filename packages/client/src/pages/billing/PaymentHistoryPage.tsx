import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CreditCard, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { formatCurrency, formatDate, getMonthName, getStatusColor } from '../../lib/utils';
import { PageLoader, EmptyState } from '../../components/ui/Loader';
import { useAuthStore } from '../../store/authStore';
import type { PaymentHistoryItem, PaymentMethod } from '../../types';

const FINANCIAL_ROLES = ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER'];
const METHOD_LABELS: Record<PaymentMethod, string> = {
  PHONEPE: 'PhonePe',
  CASH: 'Cash',
  CHEQUE: 'Cheque',
  BANK_TRANSFER: 'Bank Transfer',
  UPI_OTHER: 'UPI',
};

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'INITIATED', label: 'Initiated' },
  { value: 'SUCCESS', label: 'Success' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'REFUNDED', label: 'Refunded' },
];

const METHOD_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Methods' },
  { value: 'PHONEPE', label: 'PhonePe' },
  { value: 'CASH', label: 'Cash' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'UPI_OTHER', label: 'UPI Other' },
];

interface HistoryResponse {
  payments: PaymentHistoryItem[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export default function PaymentHistoryPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'SUPER_ADMIN' || FINANCIAL_ROLES.includes(user?.role ?? '');

  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [checkingId, setCheckingId] = useState<string | null>(null);

  async function handleCheckStatus(merchantTransId: string) {
    setCheckingId(merchantTransId);
    try {
      const { data } = await api.get(`/payments/status/${merchantTransId}`);
      const status = data?.status;
      if (status === 'SUCCESS') {
        toast.success('Payment confirmed as successful.');
        queryClient.invalidateQueries({ queryKey: ['payment-history'] });
      } else if (status === 'FAILED') {
        toast.error('Payment confirmed as failed.');
        queryClient.invalidateQueries({ queryKey: ['payment-history'] });
      } else {
        toast('Payment is still pending with PhonePe.', { icon: '⏳' });
      }
    } catch {
      toast.error('Could not check payment status. Please try again.');
    } finally {
      setCheckingId(null);
    }
  }

  const { data, isLoading, isError } = useQuery<HistoryResponse>({
    queryKey: ['payment-history', page, statusFilter, methodFilter, startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (statusFilter) params.set('status', statusFilter);
      if (methodFilter) params.set('method', methodFilter);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      const { data } = await api.get<HistoryResponse>(`/payments/history?${params}`);
      return data;
    },
    staleTime: 30_000,
  });

  function handleFilterChange() {
    setPage(1);
  }

  if (isLoading) return <PageLoader />;

  const payments = data?.payments ?? [];
  const totalPages = data?.pages ?? 1;

  return (
    <div className="page-container max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/billing')} className="btn btn-ghost btn-sm" aria-label="Back to billing">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="page-title mb-0">Payment History</h1>
          <p className="text-sm text-base-content/60 mt-0.5">
            {isAdmin ? 'All payments for your society' : 'Your payment transactions'}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="card bg-base-100 shadow-sm mb-4 p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <select
            className="select select-bordered select-sm"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); handleFilterChange(); }}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <select
            className="select select-bordered select-sm"
            value={methodFilter}
            onChange={(e) => { setMethodFilter(e.target.value); handleFilterChange(); }}
          >
            {METHOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <input
            type="date"
            className="input input-bordered input-sm"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); handleFilterChange(); }}
            placeholder="From"
          />

          <input
            type="date"
            className="input input-bordered input-sm"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); handleFilterChange(); }}
            placeholder="To"
          />
        </div>
      </div>

      {isError && (
        <div className="alert alert-error mb-4">Failed to load payment history. Please try again.</div>
      )}

      {!isLoading && payments.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="No payments found"
          description="No payment records match your filters."
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block card bg-base-100 shadow-sm overflow-x-auto">
            <table className="table table-zebra w-full text-sm">
              <thead>
                <tr>
                  <th>Date</th>
                  {isAdmin && <th>Flat / Block</th>}
                  <th>Period</th>
                  <th className="text-right">Amount</th>
                  <th>Method</th>
                  <th>Status</th>
                  <th>PhonePe Txn ID</th>
                  <th>Gateway Ref</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap">
                      {p.paidAt ? formatDate(p.paidAt) : formatDate(p.createdAt ?? '')}
                    </td>
                    {isAdmin && (
                      <td>
                        <span className="font-medium">{p.bill.flat.flatNumber}</span>
                        <span className="text-base-content/50 ml-1 text-xs">{p.bill.flat.block.name}</span>
                      </td>
                    )}
                    <td className="whitespace-nowrap">
                      {getMonthName(p.bill.month)} {p.bill.year}
                    </td>
                    <td className="text-right font-medium">{formatCurrency(p.amount)}</td>
                    <td>{METHOD_LABELS[p.method] ?? p.method}</td>
                    <td>
                      <span className={`badge badge-sm ${getStatusColor(p.status)}`}>{p.status}</span>
                    </td>
                    <td>
                      <span className="font-mono text-xs text-base-content/70">{p.transactionId ?? '—'}</span>
                    </td>
                    <td>
                      <span className="font-mono text-xs text-base-content/70">{p.gatewayRefId ?? '—'}</span>
                    </td>
                    <td>
                      {p.status === 'INITIATED' && p.merchantTransId && (
                        <button
                          className="btn btn-xs btn-outline gap-1"
                          disabled={checkingId === p.merchantTransId}
                          onClick={() => handleCheckStatus(p.merchantTransId!)}
                        >
                          <RefreshCw className={`w-3 h-3 ${checkingId === p.merchantTransId ? 'animate-spin' : ''}`} />
                          {checkingId === p.merchantTransId ? 'Checking…' : 'Check'}
                        </button>
                      )}
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
                      {getMonthName(p.bill.month)} {p.bill.year}
                    </p>
                    {isAdmin && (
                      <p className="text-sm text-base-content/60">
                        {p.bill.flat.flatNumber} · {p.bill.flat.block.name}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{formatCurrency(p.amount)}</p>
                    <span className={`badge badge-sm mt-1 ${getStatusColor(p.status)}`}>{p.status}</span>
                  </div>
                </div>
                <div className="text-xs text-base-content/60 space-y-0.5">
                  <p>{p.paidAt ? formatDate(p.paidAt) : formatDate(p.createdAt ?? '')} · {METHOD_LABELS[p.method] ?? p.method}</p>
                  {p.transactionId && <p>PhonePe: <span className="font-mono">{p.transactionId}</span></p>}
                  {p.gatewayRefId && <p>Ref: <span className="font-mono">{p.gatewayRefId}</span></p>}
                </div>
                {p.status === 'INITIATED' && p.merchantTransId && (
                  <button
                    className="btn btn-xs btn-outline gap-1 mt-3"
                    disabled={checkingId === p.merchantTransId}
                    onClick={() => handleCheckStatus(p.merchantTransId!)}
                  >
                    <RefreshCw className={`w-3 h-3 ${checkingId === p.merchantTransId ? 'animate-spin' : ''}`} />
                    {checkingId === p.merchantTransId ? 'Checking…' : 'Check Status'}
                  </button>
                )}
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
