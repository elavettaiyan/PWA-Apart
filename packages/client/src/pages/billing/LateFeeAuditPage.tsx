import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowLeft, History, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { EmptyState, PageLoader } from '../../components/ui/Loader';
import { useAuthStore } from '../../store/authStore';
import { formatDate, formatDateTime } from '../../lib/utils';
import type { LateFeeJobRun } from '../../types';

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All Statuses' },
  { value: 'true', label: 'Success' },
  { value: 'false', label: 'Failed' },
];

const TRIGGER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All Sources' },
  { value: 'MANUAL', label: 'Manual Run' },
  { value: 'SCHEDULED', label: 'Scheduled Run' },
];

interface LateFeeAuditResponse {
  runs: LateFeeJobRun[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export default function LateFeeAuditPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [page, setPage] = useState(1);
  const [successFilter, setSuccessFilter] = useState('');
  const [triggerFilter, setTriggerFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  function buildParams() {
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (successFilter) params.set('success', successFilter);
    if (triggerFilter) params.set('triggerSource', triggerFilter);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (user?.role === 'SUPER_ADMIN' && user?.societyId) params.set('societyId', user.societyId);
    return params;
  }

  function handleFilterChange() {
    setPage(1);
  }

  const { data, isLoading, isFetching, isError } = useQuery<LateFeeAuditResponse>({
    queryKey: ['late-fee-audit', user?.societyId || 'no-society', page, successFilter, triggerFilter, startDate, endDate],
    queryFn: async () => {
      const { data } = await api.get<LateFeeAuditResponse>(`/billing/late-fee-runs?${buildParams()}`);
      return data;
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  if (isLoading && !data) return <PageLoader />;

  const runs = data?.runs ?? [];
  const totalPages = data?.pages ?? 1;

  return (
    <div className="page-container max-w-6xl">
      <div className="mb-6 flex items-center gap-3">
        <button onClick={() => navigate('/billing')} className="btn btn-ghost btn-sm" aria-label="Back to billing">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="page-title mb-0">Late Fee Scheduler Audit</h1>
          <p className="mt-0.5 text-sm text-base-content/60">Scheduled and manual late fee runs for your society.</p>
        </div>
      </div>

      <div className="card bg-base-100 shadow-sm mb-4 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs text-base-content/60">Audit rows stay visible while filters update.</p>
          {isFetching ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-base-200 px-2 py-1 text-xs text-base-content/60">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Updating...
            </span>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <select
            className="select select-bordered select-sm"
            value={successFilter}
            onChange={(e) => {
              setSuccessFilter(e.target.value);
              handleFilterChange();
            }}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>

          <select
            className="select select-bordered select-sm"
            value={triggerFilter}
            onChange={(e) => {
              setTriggerFilter(e.target.value);
              handleFilterChange();
            }}
          >
            {TRIGGER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>

          <input
            type="date"
            className="input input-bordered input-sm"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              handleFilterChange();
            }}
          />

          <input
            type="date"
            className="input input-bordered input-sm"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value);
              handleFilterChange();
            }}
          />
        </div>
      </div>

      {isError ? <div className="alert alert-error mb-4">Failed to load late fee audit log. Please try again.</div> : null}

      {!isLoading && runs.length === 0 ? (
        <EmptyState
          icon={History}
          title="No audit runs found"
          description="No late fee scheduler runs match your filters."
        />
      ) : (
        <>
          <div className="hidden md:block card bg-base-100 shadow-sm overflow-x-auto">
            <table className="table table-zebra w-full text-sm">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Completed</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Triggered By</th>
                  <th className="text-right">Scanned</th>
                  <th className="text-right">Updated</th>
                  <th className="text-right">Failed</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="whitespace-nowrap">{formatDateTime(run.startedAt)}</td>
                    <td className="whitespace-nowrap">{formatDateTime(run.completedAt)}</td>
                    <td>{run.triggerSource === 'MANUAL' ? 'Manual Run' : 'Scheduled Run'}</td>
                    <td>
                      <span className={`badge badge-sm ${run.success ? 'badge-success' : 'badge-error'}`}>
                        {run.success ? 'SUCCESS' : 'FAILED'}
                      </span>
                    </td>
                    <td>{run.triggeredBy?.name || 'System Scheduler'}</td>
                    <td className="text-right font-medium">{run.billsScannedCount}</td>
                    <td className="text-right font-medium text-success">{run.updatedBillsCount}</td>
                    <td className="text-right font-medium text-error">{run.failedBillsCount}</td>
                    <td className="max-w-xs text-xs text-base-content/70">{run.errorMessage || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {runs.map((run) => (
              <div key={run.id} className="card bg-base-100 shadow-sm p-4">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{run.triggerSource === 'MANUAL' ? 'Manual Run' : 'Scheduled Run'}</p>
                    <p className="text-sm text-base-content/60">Started {formatDateTime(run.startedAt)}</p>
                    <p className="text-xs text-base-content/50">Completed {formatDateTime(run.completedAt)}</p>
                  </div>
                  <span className={`badge badge-sm ${run.success ? 'badge-success' : 'badge-error'}`}>
                    {run.success ? 'SUCCESS' : 'FAILED'}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-xl bg-base-200 px-3 py-2">
                    <span className="block text-base-content/60">Scanned</span>
                    <span className="mt-1 block text-sm font-semibold">{run.billsScannedCount}</span>
                  </div>
                  <div className="rounded-xl bg-base-200 px-3 py-2">
                    <span className="block text-base-content/60">Updated</span>
                    <span className="mt-1 block text-sm font-semibold text-success">{run.updatedBillsCount}</span>
                  </div>
                  <div className="rounded-xl bg-base-200 px-3 py-2">
                    <span className="block text-base-content/60">Failed</span>
                    <span className="mt-1 block text-sm font-semibold text-error">{run.failedBillsCount}</span>
                  </div>
                </div>

                <div className="mt-3 space-y-1 text-xs text-base-content/60">
                  <p>Triggered by: {run.triggeredBy?.name || 'System Scheduler'}</p>
                  <p>Date: {formatDate(run.startedAt)}</p>
                  {run.errorMessage ? <p className="text-error">{run.errorMessage}</p> : null}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-base-content/60">Page {page} of {totalPages}</p>
            <div className="join">
              <button className="btn btn-sm join-item" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
              <button className="btn btn-sm join-item" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Next</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}