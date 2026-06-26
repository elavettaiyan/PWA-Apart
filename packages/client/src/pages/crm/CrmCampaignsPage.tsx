import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Megaphone, Plus, RefreshCw } from 'lucide-react';
import api from '../../lib/api';
import { PageLoader } from '../../components/ui/Loader';
import {
  CampaignHistoryEntry,
  CampaignMailModal,
  getCampaignStatusLabel,
  getCampaignStatusTone,
} from './campaignMail';

export default function CrmCampaignsPage() {
  const [showCampaignModal, setShowCampaignModal] = useState(false);

  const { data: campaignHistory = [], isLoading, refetch, isFetching } = useQuery<CampaignHistoryEntry[]>({
    queryKey: ['crm-campaign-history'],
    queryFn: async () => (await api.get('/admin/crm/campaign-mails/history')).data,
    refetchInterval: (query) => {
      const records = (query.state.data as CampaignHistoryEntry[] | undefined) || [];
      return records.some((entry) => entry.status === 'QUEUED' || entry.status === 'PROCESSING') ? 2000 : false;
    },
  });

  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
            Platform Controls
          </p>
          <h1 className="page-title flex items-center gap-2">
            <Megaphone className="w-6 h-6 text-indigo-500" />
            Campaigns
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Queue publish mails, track delivery progress, and review send outcomes without blocking the UI.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => refetch()}
            className="btn-outline flex items-center gap-2 text-sm"
            disabled={isFetching}
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setShowCampaignModal(true)}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <Plus className="w-4 h-4" />
            Publish Mail
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-5 shadow-card space-y-4">
        <div>
          <p className="text-sm font-semibold text-slate-800">Campaign history</p>
          <p className="mt-1 text-xs text-slate-500">
            Campaigns are processed in the background at up to 2 emails per second. Status updates refresh automatically while a job is still running.
          </p>
        </div>

        {campaignHistory.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-400">
            No publish mail history yet.
          </div>
        ) : (
          <div className="space-y-3">
            {campaignHistory.map((entry) => {
              const processedCount = entry.sentCount + entry.failedCount;
              const progressPercent = entry.recipientCount > 0
                ? Math.min(100, Math.round((processedCount / entry.recipientCount) * 100))
                : 100;

              return (
                <div key={entry.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-800">{entry.subject}</p>
                        <span className={`badge text-[11px] ${getCampaignStatusTone(entry.status)}`}>
                          {getCampaignStatusLabel(entry.status)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {new Date(entry.createdAt).toLocaleString()} · {entry.performedBy.name} · {entry.targetMode === 'all' ? 'All users' : 'Specific emails'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-[11px]">
                      <span className="badge bg-slate-100 text-slate-600">Eligible {entry.recipientCount}</span>
                      <span className="badge bg-emerald-100 text-emerald-700">Sent {entry.sentCount}</span>
                      <span className="badge bg-amber-100 text-amber-700">Skipped {entry.skippedCount}</span>
                      <span className="badge bg-red-100 text-red-600">Failed {entry.failedCount}</span>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>Progress</span>
                      <span>{processedCount} / {entry.recipientCount} delivered attempts</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-indigo-500 transition-all"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>

                  {entry.skippedCount > 0 ? (
                    <p className="mt-3 text-xs text-slate-500">
                      {entry.skippedCount} recipient{entry.skippedCount === 1 ? '' : 's'} skipped due to unsubscribe preference.
                    </p>
                  ) : null}

                  {entry.lastErrorMessage ? (
                    <p className="mt-2 text-xs text-red-500">{entry.lastErrorMessage}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <CampaignMailModal isOpen={showCampaignModal} onClose={() => setShowCampaignModal(false)} />
    </div>
  );
}
