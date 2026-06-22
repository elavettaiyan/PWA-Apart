import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Clock3, LayoutDashboard, ListFilter, MessageSquareWarning, Plus, MessageCircle, AlertTriangle, ImageIcon, Pencil, X } from 'lucide-react';
import { getApiBaseUrl } from '../../lib/platform';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { getStatusColor, formatDate, cn } from '../../lib/utils';
import { PageLoader, EmptyState } from '../../components/ui/Loader';
import Modal from '../../components/ui/Modal';
import { COMPLAINT_CATEGORIES, getDefaultComplaintCategoryForUser, isNonSecurityServiceStaff } from '../../lib/serviceStaff';
import { useAuthStore } from '../../store/authStore';
import { isOwnerViewActive } from '../../lib/ownerView';
import type { Complaint, ComplaintAssigneeOption, ComplaintDashboardData, ComplaintStatus, Flat } from '../../types';

const DASHBOARD_COMPLAINT_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'COMMITTEE_MEMBER'] as const;

type ComplaintModuleTab = 'dashboard' | 'list';

export default function ComplaintsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(null);
  const [moduleTab, setModuleTab] = useState<ComplaintModuleTab>('list');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [minPendingDaysFilter, setMinPendingDaysFilter] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const { user, viewMode } = useAuthStore();
  const ownerViewActive = isOwnerViewActive(user, viewMode);
  const defaultCategory = getDefaultComplaintCategoryForUser(user);
  const isSpecializedStaffView = isNonSecurityServiceStaff(user) && !!defaultCategory;
  const canSeeConversation = user?.role === 'SUPER_ADMIN' || (['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'OWNER', 'TENANT'] as string[]).includes(user?.role || '');
  const canAccessDashboard = !ownerViewActive && DASHBOARD_COMPLAINT_ROLES.includes((user?.role || '') as typeof DASHBOARD_COMPLAINT_ROLES[number]);

  useEffect(() => {
    setModuleTab((current) => (canAccessDashboard ? (current === 'list' ? 'dashboard' : current) : 'list'));
  }, [canAccessDashboard]);

  useEffect(() => {
    if (defaultCategory) {
      setCategoryFilter(defaultCategory);
    }
  }, [defaultCategory]);

  const { data: complaints = [], isLoading } = useQuery<Complaint[]>({
    queryKey: ['complaints', categoryFilter || defaultCategory || 'all', minPendingDaysFilter ?? 'all', ownerViewActive ? 'owner-view' : 'role-view'],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      const effectiveCategory = categoryFilter || defaultCategory;
      if (effectiveCategory) {
        searchParams.set('category', effectiveCategory);
      }
      if (ownerViewActive) {
        searchParams.set('ownerView', 'true');
      }
      if (minPendingDaysFilter) {
        searchParams.set('minPendingDays', String(minPendingDaysFilter));
      }
      const query = searchParams.toString();
      return (await api.get(`/complaints${query ? `?${query}` : ''}`)).data;
    },
  });

  const { data: dashboardData, isLoading: dashboardLoading } = useQuery<ComplaintDashboardData>({
    queryKey: ['complaint-dashboard', user?.activeSocietyId || user?.societyId || 'default'],
    queryFn: async () => (await api.get('/complaints/dashboard')).data,
    enabled: canAccessDashboard,
    staleTime: 60_000,
  });

  const statusCounts = {
    OPEN: complaints.filter((c) => c.status === 'OPEN').length,
    IN_PROGRESS: complaints.filter((c) => c.status === 'IN_PROGRESS').length,
    RESOLVED: complaints.filter((c) => c.status === 'RESOLVED').length,
    CLOSED: complaints.filter((c) => c.status === 'CLOSED').length,
  };

  const filteredComplaints = statusFilter
    ? complaints.filter((c) => c.status === statusFilter)
    : complaints;

  const complaintsDescription = moduleTab === 'dashboard'
    ? 'Monitor complaint health, identify long-pending cases, and drill into the current workload.'
    : ownerViewActive
      ? 'Track issues raised for your home and follow each update in one place.'
      : 'Review, assign, and resolve resident issues from one place.';

  const hasListFilters = Boolean((categoryFilter && categoryFilter !== defaultCategory) || minPendingDaysFilter);

  const resetListFilters = () => {
    setStatusFilter('');
    setCategoryFilter(defaultCategory || '');
    setMinPendingDaysFilter(null);
  };

  const openListDrilldown = (options?: { status?: ComplaintStatus | ''; category?: string; minPendingDays?: number | null }) => {
    setStatusFilter(options?.status ?? '');
    setCategoryFilter(options?.category ?? defaultCategory ?? '');
    setMinPendingDaysFilter(options?.minPendingDays ?? null);
    setModuleTab('list');
  };

  if (moduleTab === 'list' && isLoading) return <PageLoader />;

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className={cn('page-title', ownerViewActive && 'text-2xl text-slate-900')}>Complaints</h1>
          <p className="mt-1 text-sm text-on-surface-variant">{complaintsDescription}</p>
        </div>
        {moduleTab === 'list' && !isSpecializedStaffView && (
          <button
            className={cn(
              'inline-flex self-start items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors',
              ownerViewActive
                ? 'bg-blue-600 text-white shadow-sm hover:bg-blue-700'
                : 'border border-blue-600 bg-white text-blue-600 hover:bg-blue-50'
            )}
            onClick={() => setShowCreate(true)}
          >
            <Plus className="h-4 w-4" /> New Complaint
          </button>
        )}
      </div>

      {canAccessDashboard ? (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {[
            { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
            { id: 'list', label: 'Complaints List', icon: MessageSquareWarning },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setModuleTab(tab.id as ComplaintModuleTab)}
              className={cn(
                'flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition whitespace-nowrap inline-flex items-center gap-1.5',
                moduleTab === tab.id
                  ? 'bg-primary text-white'
                  : 'bg-white text-[#64748B] hover:bg-[#F8FAFC]'
              )}
              style={moduleTab !== tab.id ? { boxShadow: '0 1px 4px -1px rgba(0,0,0,0.04)' } : undefined}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          ))}
        </div>
      ) : null}

      {moduleTab === 'dashboard' ? (
        <ComplaintDashboardTab
          data={dashboardData}
          isLoading={dashboardLoading}
          onOpenListDrilldown={openListDrilldown}
          onPreviewComplaint={setSelectedComplaint}
        />
      ) : (
        <>
          <div className={cn(
            ownerViewActive
              ? 'flex items-center gap-6 overflow-x-auto border-b border-slate-200 pb-0'
              : 'mb-5 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1'
          )}>
            {[
              { label: 'All', value: '', count: complaints.length },
              { label: 'Open', value: 'OPEN', count: statusCounts.OPEN },
              { label: 'In Progress', value: 'IN_PROGRESS', count: statusCounts.IN_PROGRESS },
              { label: 'Resolved', value: 'RESOLVED', count: statusCounts.RESOLVED },
              { label: 'Closed', value: 'CLOSED', count: statusCounts.CLOSED },
            ].map((tab) => (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={cn(
                  ownerViewActive
                    ? 'flex-shrink-0 whitespace-nowrap pb-3 text-sm transition-colors'
                    : 'flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition whitespace-nowrap',
                  ownerViewActive
                    ? statusFilter === tab.value
                      ? 'border-b-2 border-blue-600 font-bold text-blue-600'
                      : 'font-medium text-slate-500 hover:text-slate-800'
                    : statusFilter === tab.value
                      ? 'bg-primary text-white'
                      : 'bg-white text-[#64748B] hover:bg-[#F8FAFC]'
                )}
                style={!ownerViewActive && statusFilter !== tab.value ? { boxShadow: '0 1px 4px -1px rgba(0,0,0,0.04)' } : undefined}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
              <ListFilter className="h-4 w-4 text-slate-400" />
              Filters
            </div>
            <select
              className="select min-w-[180px] py-2"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              disabled={Boolean(defaultCategory)}
            >
              <option value="">All Categories</option>
              {COMPLAINT_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
            {minPendingDaysFilter ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                Long Pending: {minPendingDaysFilter}+ days
              </span>
            ) : null}
            {hasListFilters ? (
              <button
                type="button"
                className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100"
                onClick={resetListFilters}
              >
                Clear Filters
              </button>
            ) : null}
          </div>

          {filteredComplaints.length === 0 ? (
            <EmptyState
              icon={MessageSquareWarning}
              title="No complaints"
              description="All clear! No complaints match the current filters."
            />
          ) : (
            <div className="space-y-3">
              {filteredComplaints.map((complaint) => (
                <div
                  key={complaint.id}
                  className={cn(
                    'overflow-hidden cursor-pointer transition-all',
                    ownerViewActive
                      ? 'rounded-2xl border border-slate-200 bg-white shadow-sm hover:border-blue-200 hover:shadow-md'
                      : 'card-elevated hover:shadow-md'
                  )}
                  onClick={() => setSelectedComplaint(complaint)}
                >
                  <div className={cn('flex items-center justify-between gap-2 px-4', ownerViewActive ? 'pt-4' : 'pt-3')}>
                    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', getStatusColor(complaint.priority))}>{complaint.priority}</span>
                    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', getStatusColor(complaint.status))}>
                      {complaint.status.replace('_', ' ')}
                    </span>
                  </div>

                  <div className={cn('px-4 pt-2', ownerViewActive ? 'pb-3' : 'pb-2')}>
                    <h3 className={cn('leading-snug', ownerViewActive ? 'text-base font-semibold text-slate-900' : 'text-[15px] font-semibold text-on-surface')}>{complaint.title}</h3>
                    <p className={cn('mt-1 line-clamp-2', ownerViewActive ? 'text-sm text-slate-500' : 'text-xs text-on-surface-variant')}>{complaint.description}</p>
                  </div>

                  <div className={cn(
                    'flex items-center gap-3 px-4 pb-3 text-[11px]',
                    ownerViewActive ? 'border-t border-slate-100 bg-slate-50 pt-3 text-slate-500' : 'text-on-surface-variant'
                  )}>
                    <span className="inline-flex items-center gap-1">{complaint.category}</span>
                    {complaint.flat && <span>{complaint.flat.block?.name}-{complaint.flat.flatNumber}</span>}
                    {!ownerViewActive ? <span>{complaint.createdBy?.name}</span> : null}
                    <span>{formatDate(complaint.createdAt)}</span>
                    {canSeeConversation && complaint._count?.comments ? (
                      <span className="inline-flex items-center gap-0.5 ml-auto">
                        <MessageCircle className="w-3 h-3" /> {complaint._count.comments}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Create Complaint Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="New Complaint" size="md">
        <CreateComplaintForm onSuccess={() => {
          setShowCreate(false);
          queryClient.invalidateQueries({ queryKey: ['complaints'] });
          queryClient.invalidateQueries({ queryKey: ['complaint-dashboard'] });
        }} />
      </Modal>

      {/* Complaint Detail Modal */}
      <Modal
        isOpen={!!selectedComplaint}
        onClose={() => setSelectedComplaint(null)}
        title={selectedComplaint?.title || ''}
        size="lg"
      >
        {selectedComplaint && (
          <ComplaintDetail
            key={selectedComplaint.id}
            complaint={selectedComplaint}
            onUpdate={() => {
              queryClient.invalidateQueries({ queryKey: ['complaints'] });
              queryClient.invalidateQueries({ queryKey: ['complaint-dashboard'] });
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function ComplaintDashboardTab({
  data,
  isLoading,
  onOpenListDrilldown,
  onPreviewComplaint,
}: {
  data?: ComplaintDashboardData;
  isLoading: boolean;
  onOpenListDrilldown: (options?: { status?: ComplaintStatus | ''; category?: string; minPendingDays?: number | null }) => void;
  onPreviewComplaint: (complaint: Complaint) => void;
}) {
  if (isLoading && !data) {
    return <PageLoader />;
  }

  const statusCards = [
    {
      label: 'Open Complaints',
      value: data?.openCount || 0,
      tone: 'bg-rose-50 text-rose-700 border-rose-100',
      onClick: () => onOpenListDrilldown({ status: 'OPEN', minPendingDays: null }),
    },
    {
      label: 'In Progress',
      value: data?.inProgressCount || 0,
      tone: 'bg-amber-50 text-amber-700 border-amber-100',
      onClick: () => onOpenListDrilldown({ status: 'IN_PROGRESS', minPendingDays: null }),
    },
    {
      label: 'Total Active',
      value: data?.totalActiveCount || 0,
      tone: 'bg-blue-50 text-blue-700 border-blue-100',
    },
    {
      label: 'Long Pending',
      value: data?.longPendingCount || 0,
      tone: 'bg-violet-50 text-violet-700 border-violet-100',
      helper: data ? `${data.longPendingDays}+ days pending` : undefined,
      onClick: data ? () => onOpenListDrilldown({ minPendingDays: data.longPendingDays, status: '' }) : undefined,
    },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {statusCards.map((card) => {
          const interactive = typeof card.onClick === 'function';
          return (
            <button
              key={card.label}
              type="button"
              className={cn(
                'rounded-2xl border p-4 text-left transition-all',
                card.tone,
                interactive ? 'hover:-translate-y-0.5 hover:shadow-md' : 'cursor-default'
              )}
              onClick={card.onClick}
              disabled={!interactive}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em]">{card.label}</p>
                  <p className="mt-2 text-3xl font-extrabold font-headline">{card.value}</p>
                  {card.helper ? <p className="mt-1 text-xs font-medium opacity-80">{card.helper}</p> : null}
                </div>
                {interactive ? <ArrowRight className="mt-1 h-4 w-4 opacity-70" /> : null}
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="section-label">Category Wise</p>
              <h2 className="mt-1 text-lg font-bold text-slate-900">Complaint distribution by category</h2>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
              Click a category to drill down
            </span>
          </div>

          {(data?.categoryBreakdown.length || 0) === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
              No complaint categories to summarize yet.
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {data?.categoryBreakdown.map((category) => {
                const activeCount = category.openCount + category.inProgressCount;
                const intensity = data.totalActiveCount > 0 ? Math.max((activeCount / data.totalActiveCount) * 100, 8) : 8;

                return (
                  <button
                    key={category.category}
                    type="button"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left transition-all hover:border-blue-200 hover:bg-white hover:shadow-sm"
                    onClick={() => onOpenListDrilldown({ category: category.category, status: '', minPendingDays: null })}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{category.category}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {activeCount} active • {category.resolvedCount} resolved • {category.totalCount} total
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-slate-400" />
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                      <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(intensity, 100)}%` }} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-slate-500">
                      <span className="rounded-full bg-white px-2.5 py-1">Open {category.openCount}</span>
                      <span className="rounded-full bg-white px-2.5 py-1">In Progress {category.inProgressCount}</span>
                      <span className="rounded-full bg-white px-2.5 py-1">Resolved {category.resolvedCount}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-5">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="section-label">Status Mix</p>
                <h2 className="mt-1 text-lg font-bold text-slate-900">Current complaint breakdown</h2>
              </div>
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            </div>
            <div className="mt-4 space-y-2.5">
              {([
                ['OPEN', 'Open'],
                ['IN_PROGRESS', 'In Progress'],
                ['RESOLVED', 'Resolved'],
                ['CLOSED', 'Closed'],
                ['REJECTED', 'Rejected'],
              ] as Array<[ComplaintStatus, string]>).map(([status, label]) => (
                <div key={status} className="flex items-center justify-between rounded-2xl bg-slate-50 px-3.5 py-3">
                  <span className="text-sm font-medium text-slate-600">{label}</span>
                  <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', getStatusColor(status))}>
                    {data?.statusBreakdown?.[status] || 0}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="section-label">Long Pending</p>
                <h2 className="mt-1 text-lg font-bold text-slate-900">Cases pending beyond {data?.longPendingDays || 7} days</h2>
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg border border-blue-600 bg-white px-3 py-2 text-xs font-semibold text-blue-600 transition-colors hover:bg-blue-50"
                onClick={() => onOpenListDrilldown({ minPendingDays: data?.longPendingDays || 7, status: '' })}
              >
                View All
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {(data?.longPendingComplaints.length || 0) === 0 ? (
              <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
                No long-pending complaints right now.
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {data?.longPendingComplaints.map((complaint) => (
                  <button
                    key={complaint.id}
                    type="button"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left transition-all hover:border-blue-200 hover:bg-white hover:shadow-sm"
                    onClick={() => onPreviewComplaint(complaint)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 line-clamp-1">{complaint.title}</p>
                        <p className="mt-1 text-xs text-slate-500 line-clamp-2">{complaint.description}</p>
                      </div>
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                        <Clock3 className="h-3 w-3" />
                        {complaint.pendingDays}d
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span className={cn('rounded-full px-2.5 py-1 font-semibold', getStatusColor(complaint.status))}>{complaint.status.replace('_', ' ')}</span>
                      <span>{complaint.category}</span>
                      {complaint.flat ? <span>{complaint.flat.block?.name}-{complaint.flat.flatNumber}</span> : null}
                      <span>{formatDate(complaint.createdAt)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

const MAX_IMAGES = 2;
const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2 MB

function CreateComplaintForm({ onSuccess }: { onSuccess: () => void }) {
  const [form, setForm] = useState({ title: '', description: '', category: 'Plumbing', priority: 'MEDIUM' });
  const [images, setImages] = useState<File[]>([]);
  const { user } = useAuthStore();
  const activeSocietyId = user?.activeSocietyId || user?.societyId || '';

  const { data: myFlat } = useQuery<Flat | null>({
    queryKey: ['complaint-create-flat', activeSocietyId || 'no-society'],
    queryFn: async () => {
      try {
        const searchParams = new URLSearchParams();
        if (activeSocietyId) {
          searchParams.set('societyId', activeSocietyId);
        }

        const query = searchParams.toString();
        return (await api.get(`/flats/my-flat${query ? `?${query}` : ''}`)).data;
      } catch {
        return null;
      }
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: (formData: FormData) => api.post('/complaints', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
    onSuccess: () => { toast.success('Complaint submitted!'); onSuccess(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const valid: File[] = [];
    for (const file of files) {
      if (valid.length + images.length >= MAX_IMAGES) {
        toast.error(`Maximum ${MAX_IMAGES} images allowed`);
        break;
      }
      if (file.size > MAX_IMAGE_SIZE) {
        toast.error(`"${file.name}" exceeds 2 MB limit`);
        continue;
      }
      valid.push(file);
    }
    setImages((prev) => [...prev, ...valid]);
    e.target.value = ''; // reset input
  };

  const removeImage = (index: number) => setImages((prev) => prev.filter((_, i) => i !== index));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('title', form.title);
    formData.append('description', form.description);
    formData.append('category', form.category);
    formData.append('priority', form.priority);
    if (myFlat?.id) {
      formData.append('flatId', myFlat.id);
    }
    images.forEach((img) => formData.append('images', img));
    mutation.mutate(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Title</label>
        <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required placeholder="Brief description of the issue" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Category</label>
          <select className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {COMPLAINT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Priority</label>
          <select className="select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </select>
        </div>
      </div>
      <div>
        <label className="label">Description</label>
        <textarea className="input min-h-[100px]" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required placeholder="Detailed description..." />
      </div>

      {/* Image Upload */}
      <div>
        <label className="label">Images (max {MAX_IMAGES}, under 2 MB each)</label>
        {images.length < MAX_IMAGES && (
          <label className="flex items-center gap-2 px-4 py-2 border-2 border-dashed border-outline-variant rounded-lg cursor-pointer hover:border-primary transition w-fit">
            <ImageIcon className="w-4 h-4 text-outline" />
            <span className="text-sm text-on-surface-variant">Choose images</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={handleImageChange} />
          </label>
        )}
        {images.length > 0 && (
          <div className="flex gap-3 mt-3">
            {images.map((img, i) => (
              <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border">
                <img src={URL.createObjectURL(img)} alt="" className="w-full h-full object-cover" />
                <button type="button" onClick={() => removeImage(i)} className="absolute top-0.5 right-0.5 bg-black/50 text-white rounded-full p-0.5">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3 pt-4">
        <button type="submit" className="btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Submitting...' : 'Submit Complaint'}
        </button>
      </div>
    </form>
  );
}

function ComplaintDetail({ complaint, onUpdate }: { complaint: Complaint; onUpdate: () => void }) {
  const [resolution, setResolution] = useState('');
  const [comment, setComment] = useState('');
  const [selectedAssigneeId, setSelectedAssigneeId] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(complaint.category);
  const [isEditingCategory, setIsEditingCategory] = useState(false);
  const [isEditingAssignee, setIsEditingAssignee] = useState(false);
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const isManager = user?.role === 'SUPER_ADMIN' || (['ADMIN', 'SECRETARY', 'JOINT_SECRETARY'] as string[]).includes(user?.role || '');
  const isCommitteeMember = user?.role === 'COMMITTEE_MEMBER';
  const isStaff = user?.role === 'SERVICE_STAFF';
  const isResident = (['OWNER', 'TENANT'] as string[]).includes(user?.role || '');
  const canUpdateStatus = isManager || isStaff;
  const canSeeConversation = isManager || isResident;

  const { data: detailComplaint, isLoading: detailLoading, isFetching: detailFetching, isError: detailError } = useQuery<Complaint>({
    queryKey: ['complaint', complaint.id],
    queryFn: async () => (await api.get(`/complaints/${complaint.id}`)).data,
    placeholderData: complaint,
    refetchOnMount: 'always',
    staleTime: 0,
  });

  useEffect(() => {
    setResolution(detailComplaint?.resolution || complaint.resolution || '');
  }, [complaint.id, complaint.resolution, detailComplaint?.id, detailComplaint?.resolution]);

  const activeComplaint = detailComplaint || complaint;
  const isRequester = activeComplaint.createdById === user?.id;
  const isAssignedCommitteeReviewer = isCommitteeMember && activeComplaint.assignedToId === user?.id;
  const canAssignComplaint = isManager || isAssignedCommitteeReviewer;
  const canEditCategory = isManager || activeComplaint.assignedToId === user?.id;
  const assignedServiceStaff = activeComplaint.assignedTo?.role === 'SERVICE_STAFF' ? activeComplaint.assignedTo : null;

  useEffect(() => {
    setSelectedAssigneeId(activeComplaint.assignedToId || '');
    setIsEditingAssignee(false);
  }, [activeComplaint.assignedToId, activeComplaint.id]);

  useEffect(() => {
    setSelectedCategory(activeComplaint.category);
    setIsEditingCategory(false);
  }, [activeComplaint.category, activeComplaint.id]);

  const actionButtons = useMemo(
    () => getComplaintActions(activeComplaint.status, { canManage: canUpdateStatus, isRequester }),
    [activeComplaint.status, canUpdateStatus, isRequester]
  );
  const activityTimeline = activeComplaint.activities || [];

  const { data: assigneeOptions = [] } = useQuery<ComplaintAssigneeOption[]>({
    queryKey: ['complaint-assignees', user?.role, activeComplaint.category],
    queryFn: async () => (await api.get('/complaints/assignees', { params: { category: activeComplaint.category } })).data,
    enabled: canAssignComplaint,
    staleTime: 60_000,
  });

  const actionMutation = useMutation({
    mutationFn: (data: any) => api.post(`/complaints/${complaint.id}/actions`, data),
    onSuccess: () => {
      toast.success('Complaint updated');
      queryClient.invalidateQueries({ queryKey: ['complaint', complaint.id] });
      queryClient.invalidateQueries({ queryKey: ['complaints'] });
      onUpdate();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const noteMutation = useMutation({
    mutationFn: (data: { resolution: string }) => api.patch(`/complaints/${complaint.id}/resolution`, data),
    onSuccess: () => {
      toast.success('Case note saved');
      queryClient.invalidateQueries({ queryKey: ['complaint', complaint.id] });
      queryClient.invalidateQueries({ queryKey: ['complaints'] });
      onUpdate();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save case note'),
  });

  const categoryMutation = useMutation({
    mutationFn: (category: string) => api.patch(`/complaints/${complaint.id}/category`, { category }),
    onSuccess: () => {
      toast.success('Complaint category updated');
      setIsEditingCategory(false);
      setSelectedAssigneeId('');
      queryClient.invalidateQueries({ queryKey: ['complaint', complaint.id] });
      queryClient.invalidateQueries({ queryKey: ['complaints'] });
      queryClient.invalidateQueries({ queryKey: ['complaint-assignees'] });
      onUpdate();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to update complaint category'),
  });

  const commentMutation = useMutation({
    mutationFn: (content: string) => api.post(`/complaints/${complaint.id}/comments`, { content }),
    onSuccess: () => {
      toast.success('Comment added!');
      setComment('');
      queryClient.invalidateQueries({ queryKey: ['complaint', complaint.id] });
      queryClient.invalidateQueries({ queryKey: ['complaints'] });
    },
  });

  if (detailLoading && !detailComplaint) return <PageLoader />;

  const assigneeAction = activeComplaint.assignedToId ? 'REASSIGN' : 'ASSIGN';
  const isAssigneeSelectionUnchanged = selectedAssigneeId === (activeComplaint.assignedToId || '');
  const busy = actionMutation.isPending || noteMutation.isPending || categoryMutation.isPending;
  const flatLabel = activeComplaint.flat
    ? `${activeComplaint.flat.block?.name ? `${activeComplaint.flat.block.name} - ` : ''}${activeComplaint.flat.flatNumber}`
    : null;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Description</p>
        <p className="text-sm text-on-surface-variant">{activeComplaint.description}</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Category</p>
            {!isEditingCategory ? (
              <div className="mt-1.5 flex items-start gap-2">
                <span className="font-semibold text-slate-900">{activeComplaint.category}</span>
                {canEditCategory ? (
                  <button
                    type="button"
                    className="inline-flex w-fit items-center justify-center rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700"
                    onClick={() => setIsEditingCategory(true)}
                    disabled={busy}
                    aria-label="Edit category"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  className="select h-9 min-w-[180px] py-1"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  disabled={categoryMutation.isPending}
                >
                  {COMPLAINT_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
                <button
                  type="button"
                  className="inline-flex items-center rounded-lg border border-blue-600 bg-white px-3 py-1.5 text-xs font-semibold text-blue-600 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400"
                  onClick={() => categoryMutation.mutate(selectedCategory)}
                  disabled={categoryMutation.isPending || selectedCategory === activeComplaint.category}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100"
                  onClick={() => {
                    setSelectedCategory(activeComplaint.category);
                    setIsEditingCategory(false);
                  }}
                  disabled={categoryMutation.isPending}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {flatLabel ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Block & Flat</p>
              <p className="mt-1.5 text-sm font-semibold text-slate-900 break-words">{flatLabel}</p>
            </div>
          ) : null}

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Priority</p>
            <div className="mt-1.5"><span className={cn('badge w-fit', getStatusColor(activeComplaint.priority))}>{activeComplaint.priority}</span></div>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Created By</p>
            <p className="mt-1.5 text-sm font-semibold text-slate-900">{activeComplaint.createdBy?.name || '—'}</p>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Date</p>
            <p className="mt-1.5 text-sm font-semibold text-slate-900">{formatDate(activeComplaint.createdAt)}</p>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Current Status</p>
            <div className="mt-1.5"><span className={cn('badge w-fit', getStatusColor(activeComplaint.status))}>{activeComplaint.status.replace('_', ' ')}</span></div>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Current Assignee</p>
            {!isEditingAssignee ? (
              <div className="mt-1.5 flex items-start gap-2">
                <span className="font-semibold text-slate-900">{activeComplaint.assignedTo?.name || 'Unassigned'}</span>
                {canAssignComplaint ? (
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700"
                    onClick={() => setIsEditingAssignee(true)}
                    disabled={busy}
                    aria-label="Edit current owner"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  className="select min-w-[220px]"
                  value={selectedAssigneeId}
                  onChange={(e) => setSelectedAssigneeId(e.target.value)}
                >
                  <option value="">Select a team member</option>
                  {assigneeOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {formatAssigneeOption(option)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  onClick={() => actionMutation.mutate({ action: assigneeAction, assignedToId: selectedAssigneeId }, {
                    onSuccess: () => setIsEditingAssignee(false),
                  })}
                  disabled={busy || !selectedAssigneeId || isAssigneeSelectionUnchanged}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100"
                  onClick={() => {
                    setSelectedAssigneeId(activeComplaint.assignedToId || '');
                    setIsEditingAssignee(false);
                  }}
                  disabled={busy}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {activeComplaint.closureRequestedAt ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Awaiting Resident Confirmation</p>
              <p className="mt-1.5 text-sm font-semibold text-slate-900">{formatDate(activeComplaint.closureRequestedAt)}</p>
            </div>
          ) : null}

          {activeComplaint.closedAt ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Closed At</p>
              <p className="mt-1.5 text-sm font-semibold text-slate-900">{formatDate(activeComplaint.closedAt)}</p>
            </div>
          ) : null}
        </div>
      </div>

      {assignedServiceStaff ? (
        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3.5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">Service Person</p>
            <p className="mt-1.5 text-base font-semibold text-blue-950">{assignedServiceStaff.name}</p>
          </div>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {assignedServiceStaff.phone ? (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">Phone</p>
                <p className="mt-1 text-sm font-medium text-blue-950">{assignedServiceStaff.phone}</p>
              </div>
            ) : null}
            {assignedServiceStaff.email ? (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">Email</p>
                <p className="mt-1 text-sm font-medium text-blue-950 break-all">{assignedServiceStaff.email}</p>
              </div>
            ) : null}
            {assignedServiceStaff.specialization ? (
              <div className="sm:col-span-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">Specialization</p>
                <p className="mt-1 text-sm font-medium text-blue-950">{assignedServiceStaff.specialization}</p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Complaint Images */}
      {activeComplaint.images && activeComplaint.images.length > 0 && (
        <div>
          <h4 className="font-semibold text-on-surface mb-2 text-sm">Attachments</h4>
          <div className="flex gap-3 flex-wrap">
            {activeComplaint.images.map((img, i) => {
              const src = img.startsWith('data:') ? img : `${getApiBaseUrl().replace('/api', '')}${img}`;
              return (
                <a key={i} href={src} target="_blank" rel="noopener noreferrer" className="block w-24 h-24 rounded-lg overflow-hidden border hover:shadow-md transition">
                  <img src={src} alt={`Attachment ${i + 1}`} className="w-full h-full object-cover" />
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* Case Actions */}
      {(canUpdateStatus || isRequester) && (
        <div className="space-y-2.5 rounded-2xl border border-slate-200 bg-white p-3.5">
          <div>
            <h4 className="font-semibold text-slate-900">Case Actions</h4>
            <p className="mt-1 text-sm text-slate-500">Use the actions below to update the complaint and move it through the workflow.</p>
          </div>

          <div className="flex flex-wrap gap-2">
            {actionButtons.map((action) => (
              <button
                key={action.status}
                type="button"
                className={cn(
                  'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                  action.tone === 'primary'
                    ? 'bg-blue-600 text-white shadow-sm hover:bg-blue-700'
                    : action.tone === 'danger'
                      ? 'border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                      : 'border border-blue-600 bg-white text-blue-600 hover:bg-blue-50'
                )}
                onClick={() => actionMutation.mutate({ action: action.action, resolution: resolution.trim() || undefined })}
                disabled={busy || activeComplaint.status === action.status}
              >
                {action.label}
              </button>
            ))}
          </div>

          <div>
            <label className="label">Case note</label>
            <textarea
              className="input min-h-[96px]"
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              placeholder="Add closure notes, workaround details, or the resolution summary..."
            />
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg border border-blue-600 bg-white px-3 py-2 text-sm font-semibold text-blue-600 transition-colors hover:bg-blue-50"
              onClick={() => noteMutation.mutate({ resolution: resolution.trim() })}
              disabled={busy || resolution.trim() === (activeComplaint.resolution || '').trim()}
            >
              Save Note
            </button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
        <div className="flex items-center justify-between gap-3">
          <h4 className="font-semibold text-slate-900">Case Timeline</h4>
          {detailFetching ? <span className="text-xs font-medium text-slate-500">Syncing updates...</span> : null}
        </div>
        <div className="mt-2.5 space-y-2.5">
          {detailError ? (
            <p className="text-sm text-rose-600">Unable to load the complaint history right now.</p>
          ) : activityTimeline.length === 0 ? (
            <p className="text-sm text-slate-500">No case activity recorded yet.</p>
          ) : (
            activityTimeline.map((activity) => (
              <div key={activity.id} className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{activity.message}</p>
                    <p className="mt-1 text-xs text-slate-500">{activity.actorName} • {formatDate(activity.createdAt)}</p>
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500 shadow-sm">{formatActivityType(activity.type)}</span>
                </div>
                {renderActivityMetadata(activity)}
              </div>
            ))
          )}
        </div>
      </div>

      {canSeeConversation ? (
        <div className="border-t pt-4">
          <h4 className="font-semibold text-on-surface mb-3">Conversation</h4>
          {activeComplaint.comments?.map((c) => (
            <div key={c.id} className="mb-3 p-3 bg-[#F8FAFC] rounded-lg">
              <div className="flex justify-between text-xs text-on-surface-variant mb-1">
                <span className="font-medium">{c.authorName}</span>
                <span>{formatDate(c.createdAt)}</span>
              </div>
              <p className="text-sm text-on-surface-variant">{c.content}</p>
            </div>
          ))}
          <div className="flex gap-2 mt-3">
            <input
              className="input flex-1"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add a message..."
            />
            <button
              className="btn-primary btn-sm"
              onClick={() => comment && commentMutation.mutate(comment)}
              disabled={commentMutation.isPending || !comment}
            >
              Send
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function getComplaintActions(status: Complaint['status'], context: { canManage: boolean; isRequester: boolean }) {
  const actions: Array<{ label: string; action: 'START_PROGRESS' | 'RESOLVE' | 'CLOSE' | 'REOPEN' | 'REJECT'; status: Complaint['status']; tone: 'primary' | 'secondary' | 'danger' }> = [];

  if (context.canManage) {
    switch (status) {
      case 'OPEN':
        actions.push(
          { label: 'Start Progress', action: 'START_PROGRESS', status: 'IN_PROGRESS', tone: 'primary' },
          { label: 'Reject', action: 'REJECT', status: 'REJECTED', tone: 'danger' },
        );
        break;
      case 'IN_PROGRESS':
        actions.push(
          { label: 'Resolve', action: 'RESOLVE', status: 'RESOLVED', tone: 'primary' },
          { label: 'Move Back To Open', action: 'REOPEN', status: 'OPEN', tone: 'secondary' },
        );
        break;
      case 'RESOLVED':
      case 'CLOSED':
      case 'REJECTED':
        actions.push({ label: 'Reopen', action: 'REOPEN', status: 'OPEN', tone: 'secondary' });
        break;
      default:
        break;
    }
  }

  if (context.isRequester) {
    if (status === 'RESOLVED') {
      actions.push(
        { label: 'Confirm Closure', action: 'CLOSE', status: 'CLOSED', tone: 'primary' },
        { label: 'Reopen', action: 'REOPEN', status: 'OPEN', tone: 'secondary' },
      );
    }
  }

  return actions;
}

function formatActivityType(type: string) {
  return type.replace(/_/g, ' ');
}

function renderActivityMetadata(activity: NonNullable<Complaint['activities']>[number]) {
  const metadata = activity.metadata || {};
  const lines: string[] = [];

  if (typeof metadata.fromStatus === 'string' && typeof metadata.toStatus === 'string') {
    lines.push(`From ${metadata.fromStatus} to ${metadata.toStatus}`);
  }
  if (typeof metadata.assignedToName === 'string' && metadata.assignedToName) {
    lines.push(`Assigned to ${metadata.assignedToName}`);
  }
  if (typeof metadata.assignedToRole === 'string' && metadata.assignedToRole) {
    lines.push(`Role ${formatRoleLabel(metadata.assignedToRole)}`);
  }
  if (typeof metadata.assignedToSpecialization === 'string' && metadata.assignedToSpecialization) {
    lines.push(`Specialization ${metadata.assignedToSpecialization}`);
  }
  if (typeof metadata.assignedToPhone === 'string' && metadata.assignedToPhone) {
    lines.push(`Phone ${metadata.assignedToPhone}`);
  }
  if (typeof metadata.assignedToEmail === 'string' && metadata.assignedToEmail) {
    lines.push(`Email ${metadata.assignedToEmail}`);
  }
  if (typeof metadata.previousAssigneeName === 'string' && metadata.previousAssigneeName) {
    lines.push(`Previous owner: ${metadata.previousAssigneeName}`);
  }
  if (typeof metadata.resolution === 'string' && metadata.resolution) {
    lines.push(metadata.resolution);
  }
  if (typeof metadata.priority === 'string' && typeof metadata.category === 'string') {
    lines.push(`Priority ${metadata.priority} • ${metadata.category}`);
  }

  if (lines.length === 0) return null;

  return (
    <div className="mt-2 space-y-1 text-xs text-slate-500">
      {lines.map((line, index) => (
        <p key={`${activity.id}-${index}`}>{line}</p>
      ))}
    </div>
  );
}

function formatRoleLabel(role: string) {
  return role.replace(/_/g, ' ');
}

function formatAssigneeOption(option: ComplaintAssigneeOption) {
  const details = [formatRoleLabel(option.role)];
  if (option.specialization) {
    details.push(option.specialization);
  }

  return `${option.name} • ${details.join(' • ')}`;
}
