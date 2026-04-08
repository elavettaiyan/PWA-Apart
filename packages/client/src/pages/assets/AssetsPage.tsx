import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Box, Plus, Wrench, CalendarClock, AlertTriangle, CheckCircle2, Clock, Trash2, Eye, Pencil, History, Package } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { formatDate, formatCurrency } from '../../lib/utils';
import { PageLoader, EmptyState } from '../../components/ui/Loader';
import Modal from '../../components/ui/Modal';
import type { Asset, AssetType, ServiceFrequency, AssetDashboard, ServiceJob, ServiceJobStatus, ServiceJobPriority, ServiceHistoryEntry } from '../../types';

// ── Constants ───────────────────────────────────────────

const ASSET_TYPES: { value: AssetType; label: string }[] = [
  { value: 'LIFT', label: 'Lift' },
  { value: 'WATER_TANK', label: 'Water Tank' },
  { value: 'TOILET', label: 'Toilet' },
  { value: 'AUDITORIUM', label: 'Auditorium' },
  { value: 'SEPTIC_TANK', label: 'Septic Tank' },
  { value: 'GARDEN', label: 'Garden' },
  { value: 'GENERATOR', label: 'Generator' },
  { value: 'PUMP', label: 'Pump' },
  { value: 'FIRE_SAFETY', label: 'Fire Safety' },
  { value: 'OTHER', label: 'Other' },
];

const SERVICE_FREQUENCIES: { value: ServiceFrequency; label: string }[] = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'HALF_YEARLY', label: 'Half Yearly' },
  { value: 'YEARLY', label: 'Yearly' },
  { value: 'CUSTOM', label: 'Custom' },
];

const JOB_STATUSES: { value: ServiceJobStatus; label: string; color: string }[] = [
  { value: 'PENDING', label: 'Pending', color: 'bg-amber-100 text-amber-800' },
  { value: 'IN_PROGRESS', label: 'In Progress', color: 'bg-blue-100 text-blue-800' },
  { value: 'COMPLETED', label: 'Completed', color: 'bg-green-100 text-green-800' },
  { value: 'POSTPONED', label: 'Postponed', color: 'bg-slate-100 text-slate-800' },
  { value: 'RESCHEDULED', label: 'Rescheduled', color: 'bg-purple-100 text-purple-800' },
];

const JOB_PRIORITIES: { value: ServiceJobPriority; label: string }[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
];

function getJobStatusColor(status: ServiceJobStatus) {
  return JOB_STATUSES.find((s) => s.value === status)?.color || 'bg-slate-100 text-slate-800';
}

function getAssetTypeLabel(type: AssetType) {
  return ASSET_TYPES.find((t) => t.value === type)?.label || type.replace(/_/g, ' ');
}

// ── Tabs ────────────────────────────────────────────────

type Tab = 'dashboard' | 'assets' | 'jobs';

export default function AssetsPage() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [typeFilter, setTypeFilter] = useState('');
  const [jobStatusFilter, setJobStatusFilter] = useState('');

  // Asset CRUD modals
  const [showCreate, setShowCreate] = useState(false);
  const [editAsset, setEditAsset] = useState<Asset | null>(null);
  const [viewAsset, setViewAsset] = useState<Asset | null>(null);

  // Job modals
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [createJobAssetId, setCreateJobAssetId] = useState('');
  const [updateJobModal, setUpdateJobModal] = useState<ServiceJob | null>(null);

  // History modal
  const [historyAsset, setHistoryAsset] = useState<Asset | null>(null);
  const [showAddHistory, setShowAddHistory] = useState(false);
  const [addHistoryAssetId, setAddHistoryAssetId] = useState('');

  const queryClient = useQueryClient();

  // ── Queries ─────────────────────────────────────────
  const { data: dashboard, isLoading: dashLoading } = useQuery<AssetDashboard>({
    queryKey: ['assets-dashboard'],
    queryFn: async () => (await api.get('/assets/dashboard')).data,
  });

  const { data: assets = [], isLoading: assetsLoading } = useQuery<Asset[]>({
    queryKey: ['assets', typeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (typeFilter) params.set('type', typeFilter);
      return (await api.get(`/assets?${params.toString()}`)).data;
    },
  });

  const { data: jobs = [], isLoading: jobsLoading } = useQuery<ServiceJob[]>({
    queryKey: ['assets-jobs', jobStatusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (jobStatusFilter) params.set('status', jobStatusFilter);
      return (await api.get(`/assets/jobs/list?${params.toString()}`)).data;
    },
  });

  const { data: blocks = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['blocks'],
    queryFn: async () => (await api.get('/flats/blocks')).data,
  });

  // ── Mutations ───────────────────────────────────────
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['assets'] });
    queryClient.invalidateQueries({ queryKey: ['assets-dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['assets-jobs'] });
  };

  const deleteAssetMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/assets/${id}`),
    onSuccess: () => { toast.success('Asset deleted'); invalidateAll(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to delete'),
  });

  const deleteJobMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/assets/jobs/${id}`),
    onSuccess: () => { toast.success('Job deleted'); invalidateAll(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to delete'),
  });

  // ── Tab rendering ───────────────────────────────────

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'dashboard', label: 'Overview', icon: <Box className="w-4 h-4" /> },
    { key: 'assets', label: 'Assets', icon: <Wrench className="w-4 h-4" /> },
    { key: 'jobs', label: 'Jobs', icon: <CalendarClock className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-headline font-bold text-on-surface sm:text-2xl">Asset Management</h1>
        {tab === 'assets' && (
          <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 text-sm">
            <Plus className="w-4 h-4" /> Add Asset
          </button>
        )}
        {tab === 'jobs' && (
          <button
            onClick={() => {
              setCreateJobAssetId(assets[0]?.id || '');
              setShowCreateJob(true);
            }}
            className="btn-primary flex items-center gap-2 text-sm"
            disabled={assets.length === 0}
          >
            <Plus className="w-4 h-4" /> Schedule Job
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-container rounded-2xl p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-sm font-medium transition ${
              tab === t.key ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ── Dashboard Tab ────────────────────────────── */}
      {tab === 'dashboard' && (
        dashLoading ? <PageLoader /> : dashboard && (
          <div className="space-y-6">
            {/* Stats grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
              <StatCard label="Total Assets" value={dashboard.totalAssets} icon={<Box className="w-5 h-5 text-primary" />} />
              <StatCard label="Active" value={dashboard.activeAssets} icon={<CheckCircle2 className="w-5 h-5 text-green-600" />} />
              <StatCard label="Overdue Jobs" value={dashboard.overdueJobs} icon={<AlertTriangle className="w-5 h-5 text-red-500" />} accent={dashboard.overdueJobs > 0 ? 'text-red-600' : undefined} />
              <StatCard label="Pending Jobs" value={dashboard.pendingJobs} icon={<Clock className="w-5 h-5 text-amber-500" />} />
            </div>

            {/* Upcoming jobs */}
            <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-outline-variant">
              <h2 className="text-base font-headline font-semibold text-on-surface mb-3">Upcoming Jobs</h2>
              {dashboard.upcomingJobs.length === 0 ? (
                <p className="text-sm text-on-surface-variant">No upcoming jobs scheduled.</p>
              ) : (
                <div className="space-y-3">
                  {dashboard.upcomingJobs.map((job) => (
                    <div key={job.id} className="flex items-center justify-between p-3 bg-surface-container rounded-xl">
                      <div>
                        <p className="text-sm font-medium text-on-surface">{job.asset?.name}</p>
                        <p className="text-xs text-on-surface-variant">{job.jobType} · {getAssetTypeLabel(job.asset?.type as AssetType)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-on-surface">{formatDate(job.scheduledDate)}</p>
                        <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${getJobStatusColor(job.status)}`}>
                          {job.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Completed this month */}
            <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-outline-variant">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <span className="text-sm text-on-surface-variant">
                  <span className="font-semibold text-on-surface">{dashboard.completedThisMonth}</span> jobs completed this month
                </span>
              </div>
            </div>
          </div>
        )
      )}

      {/* ── Assets Tab ───────────────────────────────── */}
      {tab === 'assets' && (
        assetsLoading ? <PageLoader /> : (
          <div className="space-y-4">
            {/* Filter chips */}
            <div className="flex gap-2 overflow-x-auto pb-1">
              <FilterChip label="All" active={!typeFilter} onClick={() => setTypeFilter('')} />
              {ASSET_TYPES.map((t) => (
                <FilterChip key={t.value} label={t.label} active={typeFilter === t.value} onClick={() => setTypeFilter(t.value)} />
              ))}
            </div>

            {assets.length === 0 ? (
              <EmptyState icon={Package} title="No Assets" description="No assets found. Add your first asset to get started." />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {assets.map((asset) => (
                  <AssetCard
                    key={asset.id}
                    asset={asset}
                    onView={() => { loadAssetDetail(asset.id); }}
                    onEdit={() => setEditAsset(asset)}
                    onDelete={() => {
                      if (confirm(`Delete "${asset.name}"? All related jobs and history will be removed.`)) {
                        deleteAssetMutation.mutate(asset.id);
                      }
                    }}
                    onHistory={() => { loadAssetHistory(asset); }}
                    onScheduleJob={() => { setCreateJobAssetId(asset.id); setShowCreateJob(true); }}
                  />
                ))}
              </div>
            )}
          </div>
        )
      )}

      {/* ── Jobs Tab ─────────────────────────────────── */}
      {tab === 'jobs' && (
        jobsLoading ? <PageLoader /> : (
          <div className="space-y-4">
            {/* Filter chips */}
            <div className="flex gap-2 overflow-x-auto pb-1">
              <FilterChip label="All" active={!jobStatusFilter} onClick={() => setJobStatusFilter('')} />
              {JOB_STATUSES.map((s) => (
                <FilterChip key={s.value} label={s.label} active={jobStatusFilter === s.value} onClick={() => setJobStatusFilter(s.value)} />
              ))}
            </div>

            {jobs.length === 0 ? (
              <EmptyState icon={CalendarClock} title="No Jobs" description="No service jobs found." />
            ) : (
              <div className="space-y-3">
                {jobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    onUpdate={() => setUpdateJobModal(job)}
                    onDelete={() => {
                      if (confirm('Delete this job?')) deleteJobMutation.mutate(job.id);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )
      )}

      {/* ── Modals ───────────────────────────────────── */}

      {/* Create / Edit Asset */}
      {(showCreate || editAsset) && (
        <AssetFormModal
          asset={editAsset}
          blocks={blocks}
          onClose={() => { setShowCreate(false); setEditAsset(null); }}
          onSuccess={() => { setShowCreate(false); setEditAsset(null); invalidateAll(); }}
        />
      )}

      {/* View Asset Detail */}
      {viewAsset && (
        <AssetDetailModal
          asset={viewAsset}
          onClose={() => setViewAsset(null)}
          onScheduleJob={() => {
            setCreateJobAssetId(viewAsset.id);
            setViewAsset(null);
            setShowCreateJob(true);
          }}
          onAddHistory={() => {
            setAddHistoryAssetId(viewAsset.id);
            setViewAsset(null);
            setShowAddHistory(true);
          }}
        />
      )}

      {/* Create Job */}
      {showCreateJob && (
        <CreateJobModal
          assets={assets}
          defaultAssetId={createJobAssetId}
          onClose={() => setShowCreateJob(false)}
          onSuccess={() => { setShowCreateJob(false); invalidateAll(); }}
        />
      )}

      {/* Update Job Status */}
      {updateJobModal && (
        <UpdateJobModal
          job={updateJobModal}
          onClose={() => setUpdateJobModal(null)}
          onSuccess={() => { setUpdateJobModal(null); invalidateAll(); }}
        />
      )}

      {/* Service History */}
      {historyAsset && (
        <ServiceHistoryModal
          asset={historyAsset}
          onClose={() => setHistoryAsset(null)}
          onAddEntry={() => {
            setAddHistoryAssetId(historyAsset.id);
            setHistoryAsset(null);
            setShowAddHistory(true);
          }}
        />
      )}

      {/* Add Manual History */}
      {showAddHistory && (
        <AddHistoryModal
          assetId={addHistoryAssetId}
          onClose={() => setShowAddHistory(false)}
          onSuccess={() => { setShowAddHistory(false); invalidateAll(); }}
        />
      )}
    </div>
  );

  // Helper to fetch full asset detail
  function loadAssetDetail(id: string) {
    api.get(`/assets/${id}`).then((res) => setViewAsset(res.data)).catch(() => toast.error('Failed to load asset'));
  }

  function loadAssetHistory(asset: Asset) {
    api.get(`/assets/${asset.id}`).then((res) => setHistoryAsset(res.data)).catch(() => toast.error('Failed to load history'));
  }
}

// ═══════════════════════════════════════════════════════
//  Sub-components
// ═══════════════════════════════════════════════════════

function StatCard({ label, value, icon, accent }: { label: string; value: number; icon: React.ReactNode; accent?: string }) {
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-outline-variant">
      <div className="flex items-center gap-2 mb-1">{icon}<span className="text-xs text-on-surface-variant">{label}</span></div>
      <p className={`text-2xl font-bold ${accent || 'text-on-surface'}`}>{value}</p>
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium transition ${
        active ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
      }`}
    >
      {label}
    </button>
  );
}

function AssetCard({ asset, onView, onEdit, onDelete, onHistory, onScheduleJob }: {
  asset: Asset;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onHistory: () => void;
  onScheduleJob: () => void;
}) {
  const isOverdue = asset.nextServiceDate && new Date(asset.nextServiceDate) < new Date();

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-outline-variant hover:shadow-md transition cursor-pointer" onClick={onView}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-on-surface truncate">{asset.name}</h3>
          <p className="text-xs text-on-surface-variant">{getAssetTypeLabel(asset.type)}{asset.block ? ` · ${asset.block.name}` : ''}{asset.location ? ` · ${asset.location}` : ''}</p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${asset.isActive ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>
          {asset.isActive ? 'Active' : 'Inactive'}
        </span>
      </div>

      {asset.periodicServiceRequired && (
        <div className="mt-2 space-y-1">
          {asset.lastServiceDate && (
            <p className="text-xs text-on-surface-variant">Last service: {formatDate(asset.lastServiceDate)}</p>
          )}
          {asset.nextServiceDate && (
            <p className={`text-xs ${isOverdue ? 'text-red-600 font-medium' : 'text-on-surface-variant'}`}>
              {isOverdue ? '⚠ Overdue: ' : 'Next: '}{formatDate(asset.nextServiceDate)}
            </p>
          )}
        </div>
      )}

      {/* Thumbnails */}
      {asset.images.length > 0 && (
        <div className="flex gap-1 mt-2">
          {asset.images.slice(0, 3).map((url, i) => (
            <div key={i} className="w-10 h-10 rounded-lg overflow-hidden bg-slate-100">
              <img src={url} alt="" className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 mt-3 pt-2 border-t border-outline-variant" onClick={(e) => e.stopPropagation()}>
        <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-slate-50 text-on-surface-variant" title="Edit">
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button onClick={onHistory} className="p-1.5 rounded-lg hover:bg-slate-50 text-on-surface-variant" title="History">
          <History className="w-3.5 h-3.5" />
        </button>
        <button onClick={onScheduleJob} className="p-1.5 rounded-lg hover:bg-slate-50 text-on-surface-variant" title="Schedule Job">
          <CalendarClock className="w-3.5 h-3.5" />
        </button>
        <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 ml-auto" title="Delete">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function JobCard({ job, onUpdate, onDelete }: { job: ServiceJob; onUpdate: () => void; onDelete: () => void }) {
  const isOverdue = job.status !== 'COMPLETED' && new Date(job.scheduledDate) < new Date();

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-outline-variant">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-on-surface">{job.asset?.name}</h3>
          <p className="text-xs text-on-surface-variant">{job.jobType} · {getAssetTypeLabel(job.asset?.type as AssetType)}</p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${getJobStatusColor(job.status)}`}>
          {job.status.replace(/_/g, ' ')}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-4 text-xs text-on-surface-variant">
        <span className={isOverdue ? 'text-red-600 font-medium' : ''}>
          {isOverdue ? '⚠ ' : ''}Scheduled: {formatDate(job.scheduledDate)}
        </span>
        {job.assignedTo && <span>Assigned: {job.assignedTo}</span>}
        {job.assignedUser && <span>Assigned: {job.assignedUser.name}</span>}
        <span className={`px-1.5 py-0.5 rounded ${job.priority === 'HIGH' ? 'bg-red-100 text-red-700' : job.priority === 'LOW' ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-700'}`}>
          {job.priority}
        </span>
      </div>

      {job.remarks && <p className="text-xs text-on-surface-variant mt-1 line-clamp-2">{job.remarks}</p>}

      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-outline-variant">
        {job.status !== 'COMPLETED' && (
          <button onClick={onUpdate} className="text-xs text-primary font-medium hover:underline">Update Status</button>
        )}
        <button onClick={onDelete} className="text-xs text-red-500 font-medium hover:underline ml-auto">Delete</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  Modals
// ═══════════════════════════════════════════════════════

function AssetFormModal({ asset, blocks, onClose, onSuccess }: {
  asset: Asset | null;
  blocks: { id: string; name: string }[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isEdit = !!asset;
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);

    const form = new FormData(e.currentTarget);

    // For edit, pass existing images
    if (isEdit && asset.images.length > 0) {
      form.set('existingImages', JSON.stringify(asset.images));
    }

    try {
      if (isEdit) {
        await api.put(`/assets/${asset.id}`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
        toast.success('Asset updated');
      } else {
        await api.post('/assets', form, { headers: { 'Content-Type': 'multipart/form-data' } });
        toast.success('Asset created');
      }
      onSuccess();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={isEdit ? 'Edit Asset' : 'Add Asset'} size="lg">
      <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 overflow-y-auto max-h-[70vh]">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Name */}
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-on-surface-variant mb-1">Name *</label>
            <input name="name" defaultValue={asset?.name} required className="input-field w-full" placeholder="e.g., Lift A" />
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1">Type *</label>
            <select name="type" defaultValue={asset?.type || ''} required className="input-field w-full">
              <option value="">Select type</option>
              {ASSET_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {/* Block */}
          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1">Block / Wing</label>
            <select name="blockId" defaultValue={asset?.blockId || ''} className="input-field w-full">
              <option value="">Common / All</option>
              {blocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>

          {/* Location */}
          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1">Location</label>
            <input name="location" defaultValue={asset?.location || ''} className="input-field w-full" placeholder="e.g., Basement, Terrace" />
          </div>

          {/* Installation Date */}
          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1">Installation Date</label>
            <input name="installationDate" type="date" defaultValue={asset?.installationDate?.slice(0, 10) || ''} className="input-field w-full" />
          </div>

          {/* Vendor */}
          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1">Vendor / Supplier</label>
            <input name="vendor" defaultValue={asset?.vendor || ''} className="input-field w-full" />
          </div>

          {/* Service Contact */}
          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1">Service Contact</label>
            <input name="serviceContact" defaultValue={asset?.serviceContact || ''} className="input-field w-full" placeholder="Phone or email" />
          </div>

          {/* Description */}
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-on-surface-variant mb-1">Description</label>
            <textarea name="description" defaultValue={asset?.description || ''} rows={2} className="input-field w-full" />
          </div>
        </div>

        {/* Periodic Service Section */}
        <fieldset className="border border-outline-variant rounded-xl p-3 sm:p-4">
          <legend className="text-xs font-semibold text-on-surface-variant px-2">Periodic Service</legend>
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="periodicServiceRequired" value="true" defaultChecked={asset?.periodicServiceRequired} className="accent-primary" />
              Requires periodic servicing
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1">Frequency</label>
                <select name="serviceFrequency" defaultValue={asset?.serviceFrequency || ''} className="input-field w-full">
                  <option value="">Select</option>
                  {SERVICE_FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1">Interval (days)</label>
                <input name="serviceIntervalDays" type="number" min={1} defaultValue={asset?.serviceIntervalDays || ''} className="input-field w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1">Last Service Date</label>
                <input name="lastServiceDate" type="date" defaultValue={asset?.lastServiceDate?.slice(0, 10) || ''} className="input-field w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1">Next Service Date</label>
                <input name="nextServiceDate" type="date" defaultValue={asset?.nextServiceDate?.slice(0, 10) || ''} className="input-field w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1">Service Vendor</label>
                <input name="serviceVendor" defaultValue={asset?.serviceVendor || ''} className="input-field w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1">Service Cost (₹)</label>
                <input name="serviceCost" type="number" min={0} step={0.01} defaultValue={asset?.serviceCost || ''} className="input-field w-full" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-on-surface-variant mb-1">Service Notes</label>
                <textarea name="serviceNotes" defaultValue={asset?.serviceNotes || ''} rows={2} className="input-field w-full" />
              </div>
            </div>
          </div>
        </fieldset>

        {/* Images */}
        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Images (max 3, 2MB each)</label>
          <input name="images" type="file" accept="image/*" multiple className="input-field w-full text-sm" />
          {isEdit && asset.images.length > 0 && (
            <div className="flex gap-2 mt-2">
              {asset.images.map((url, i) => (
                <img key={i} src={url} alt="" className="w-16 h-16 rounded-lg object-cover" />
              ))}
            </div>
          )}
        </div>

        {/* Active toggle (edit only) */}
        {isEdit && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isActive" value="true" defaultChecked={asset.isActive} className="accent-primary" />
            Active
          </label>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button type="submit" disabled={submitting} className="btn-primary text-sm">
            {submitting ? 'Saving...' : isEdit ? 'Update' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AssetDetailModal({ asset, onClose, onScheduleJob, onAddHistory }: {
  asset: Asset;
  onClose: () => void;
  onScheduleJob: () => void;
  onAddHistory: () => void;
}) {
  return (
    <Modal isOpen onClose={onClose} title={asset.name} size="lg">
      <div className="p-4 sm:p-6 overflow-y-auto max-h-[70vh] space-y-4">
        {/* Info */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Detail label="Type" value={getAssetTypeLabel(asset.type)} />
          <Detail label="Location" value={asset.location || '—'} />
          <Detail label="Block" value={asset.block?.name || 'Common'} />
          <Detail label="Status" value={asset.isActive ? 'Active' : 'Inactive'} />
          {asset.installationDate && <Detail label="Installed" value={formatDate(asset.installationDate)} />}
          {asset.vendor && <Detail label="Vendor" value={asset.vendor} />}
          {asset.serviceContact && <Detail label="Service Contact" value={asset.serviceContact} />}
        </div>

        {asset.description && (
          <div><p className="text-xs text-on-surface-variant mb-1">Description</p><p className="text-sm">{asset.description}</p></div>
        )}

        {/* Images */}
        {asset.images.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {asset.images.map((url, i) => (
              <img key={i} src={url} alt="" className="w-24 h-24 rounded-xl object-cover cursor-pointer hover:opacity-80" onClick={() => window.open(url, '_blank')} />
            ))}
          </div>
        )}

        {/* Periodic service info */}
        {asset.periodicServiceRequired && (
          <div className="bg-surface-container rounded-xl p-3 space-y-1 text-sm">
            <p className="font-semibold text-on-surface">Periodic Service</p>
            {asset.serviceFrequency && <p className="text-on-surface-variant">Frequency: {asset.serviceFrequency.replace(/_/g, ' ')}</p>}
            {asset.serviceIntervalDays && <p className="text-on-surface-variant">Every {asset.serviceIntervalDays} days</p>}
            {asset.lastServiceDate && <p className="text-on-surface-variant">Last: {formatDate(asset.lastServiceDate)}</p>}
            {asset.nextServiceDate && (<p className={new Date(asset.nextServiceDate) < new Date() ? 'text-red-600 font-medium' : 'text-on-surface-variant'}>Next: {formatDate(asset.nextServiceDate)}</p>)}
            {asset.serviceVendor && <p className="text-on-surface-variant">Vendor: {asset.serviceVendor}</p>}
            {asset.serviceCost != null && <p className="text-on-surface-variant">Cost: {formatCurrency(asset.serviceCost)}</p>}
          </div>
        )}

        {/* Recent Jobs */}
        {asset.serviceJobs && asset.serviceJobs.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-on-surface-variant mb-2">Recent Jobs</p>
            <div className="space-y-2">
              {asset.serviceJobs.map((job) => (
                <div key={job.id} className="flex justify-between text-xs p-2 bg-surface-container rounded-lg">
                  <span>{job.jobType} · {formatDate(job.scheduledDate)}</span>
                  <span className={`px-2 py-0.5 rounded-full ${getJobStatusColor(job.status)}`}>{job.status.replace(/_/g, ' ')}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent History */}
        {asset.serviceHistory && asset.serviceHistory.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-on-surface-variant mb-2">Service History</p>
            <div className="space-y-2">
              {asset.serviceHistory.map((h) => (
                <div key={h.id} className="flex justify-between text-xs p-2 bg-surface-container rounded-lg">
                  <span>{formatDate(h.serviceDate)}{h.vendor ? ` · ${h.vendor}` : ''}</span>
                  {h.cost != null && <span className="font-medium">{formatCurrency(h.cost)}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button onClick={onScheduleJob} className="btn-primary text-sm flex items-center gap-1">
            <CalendarClock className="w-4 h-4" /> Schedule Job
          </button>
          <button onClick={onAddHistory} className="btn-secondary text-sm flex items-center gap-1">
            <History className="w-4 h-4" /> Add History
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-on-surface-variant">{label}</p>
      <p className="font-medium text-on-surface">{value}</p>
    </div>
  );
}

function CreateJobModal({ assets, defaultAssetId, onClose, onSuccess }: {
  assets: Asset[];
  defaultAssetId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);

    const form = new FormData(e.currentTarget);

    try {
      await api.post('/assets/jobs', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Job scheduled');
      onSuccess();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Schedule Service Job">
      <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 overflow-y-auto max-h-[70vh]">
        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Asset *</label>
          <select name="assetId" defaultValue={defaultAssetId} required className="input-field w-full">
            <option value="">Select asset</option>
            {assets.map((a) => <option key={a.id} value={a.id}>{a.name} ({getAssetTypeLabel(a.type)})</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Job Type</label>
          <input name="jobType" defaultValue="Periodic Service" className="input-field w-full" />
        </div>

        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Scheduled Date *</label>
          <input name="scheduledDate" type="date" required className="input-field w-full" />
        </div>

        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Assigned To (name)</label>
          <input name="assignedTo" className="input-field w-full" placeholder="Service vendor or staff name" />
        </div>

        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Priority</label>
          <select name="priority" defaultValue="MEDIUM" className="input-field w-full">
            {JOB_PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Remarks</label>
          <textarea name="remarks" rows={2} className="input-field w-full" />
        </div>

        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Images</label>
          <input name="images" type="file" accept="image/*" multiple className="input-field w-full text-sm" />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button type="submit" disabled={submitting} className="btn-primary text-sm">
            {submitting ? 'Scheduling...' : 'Schedule'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function UpdateJobModal({ job, onClose, onSuccess }: {
  job: ServiceJob;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);

    const form = new FormData(e.currentTarget);

    try {
      await api.patch(`/assets/jobs/${job.id}/status`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Job updated');
      onSuccess();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Update Job Status">
      <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 overflow-y-auto max-h-[70vh]">
        <div className="bg-surface-container rounded-xl p-3 text-sm">
          <p className="font-medium">{job.asset?.name}</p>
          <p className="text-xs text-on-surface-variant">{job.jobType} · Scheduled: {formatDate(job.scheduledDate)}</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Status *</label>
          <select name="status" defaultValue={job.status} required className="input-field w-full">
            {JOB_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Remarks</label>
          <textarea name="remarks" defaultValue={job.remarks || ''} rows={2} className="input-field w-full" />
        </div>

        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Completed Date</label>
          <input name="completedDate" type="date" className="input-field w-full" />
        </div>

        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Reschedule Date</label>
          <input name="scheduledDate" type="date" className="input-field w-full" />
        </div>

        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Vendor</label>
          <input name="vendor" defaultValue="" className="input-field w-full" />
        </div>

        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Cost (₹)</label>
          <input name="cost" type="number" min={0} step={0.01} className="input-field w-full" />
        </div>

        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Invoice URL</label>
          <input name="invoiceUrl" className="input-field w-full" />
        </div>

        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Images</label>
          <input name="images" type="file" accept="image/*" multiple className="input-field w-full text-sm" />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button type="submit" disabled={submitting} className="btn-primary text-sm">
            {submitting ? 'Updating...' : 'Update'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ServiceHistoryModal({ asset, onClose, onAddEntry }: {
  asset: Asset;
  onClose: () => void;
  onAddEntry: () => void;
}) {
  const history = asset.serviceHistory || [];

  return (
    <Modal isOpen onClose={onClose} title={`History: ${asset.name}`} size="lg">
      <div className="p-4 sm:p-6 overflow-y-auto max-h-[70vh] space-y-4">
        {history.length === 0 ? (
          <p className="text-sm text-on-surface-variant text-center py-8">No service history recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {history.map((h) => (
              <div key={h.id} className="bg-surface-container rounded-xl p-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{formatDate(h.serviceDate)}</span>
                  {h.cost != null && <span className="font-medium text-primary">{formatCurrency(h.cost)}</span>}
                </div>
                {h.vendor && <p className="text-xs text-on-surface-variant">Vendor: {h.vendor}</p>}
                {h.notes && <p className="text-xs text-on-surface-variant">{h.notes}</p>}
                {h.job && <p className="text-xs text-on-surface-variant">Job: {h.job.jobType} ({h.job.status})</p>}
                {h.images.length > 0 && (
                  <div className="flex gap-1 mt-1">
                    {h.images.map((url, i) => (
                      <img key={i} src={url} alt="" className="w-10 h-10 rounded-lg object-cover cursor-pointer" onClick={() => window.open(url, '_blank')} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button onClick={onAddEntry} className="btn-primary text-sm flex items-center gap-1">
            <Plus className="w-4 h-4" /> Add Entry
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AddHistoryModal({ assetId, onClose, onSuccess }: {
  assetId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);

    const form = new FormData(e.currentTarget);
    form.set('assetId', assetId);

    try {
      await api.post('/assets/history', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('History entry added');
      onSuccess();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Add Service History">
      <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Service Date *</label>
          <input name="serviceDate" type="date" required className="input-field w-full" />
        </div>

        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Vendor</label>
          <input name="vendor" className="input-field w-full" />
        </div>

        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Notes</label>
          <textarea name="notes" rows={2} className="input-field w-full" />
        </div>

        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Cost (₹)</label>
          <input name="cost" type="number" min={0} step={0.01} className="input-field w-full" />
        </div>

        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Invoice URL</label>
          <input name="invoiceUrl" className="input-field w-full" />
        </div>

        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Images</label>
          <input name="images" type="file" accept="image/*" multiple className="input-field w-full text-sm" />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button type="submit" disabled={submitting} className="btn-primary text-sm">
            {submitting ? 'Saving...' : 'Add Entry'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
