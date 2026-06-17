import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, CalendarDays, CheckCheck, CheckCircle2, Clock3, History, MapPin, Megaphone, Pencil, Pin, Plus, RotateCcw, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import Modal from '../../components/ui/Modal';
import { EmptyState, PageLoader } from '../../components/ui/Loader';
import api from '../../lib/api';
import { cn } from '../../lib/utils';
import { formatDateTime, getStatusColor } from '../../lib/utils';
import { useAuthStore } from '../../store/authStore';
import { SOCIETY_MANAGERS, type Announcement, type ApprovalRequest, type SocietyEvent } from '../../types';
import { AnnouncementForm } from '../announcements/AnnouncementsPage';
import { EventForm } from '../events/EventsPage';

type CommunityTab = 'inbox' | 'history';

type CommunityFeedItem =
  | {
    id: string;
    kind: 'announcement';
    bucket: CommunityTab;
    sortTimestamp: number;
    announcement: Announcement;
  }
  | {
    id: string;
    kind: 'event';
    bucket: CommunityTab;
    sortTimestamp: number;
    event: SocietyEvent;
  }
  | {
    id: string;
    kind: 'approval';
    bucket: CommunityTab;
    sortTimestamp: number;
    approval: ApprovalRequest;
  };

const COMMUNITY_TABS: Array<{ id: CommunityTab; label: string; icon: typeof Megaphone }> = [
  { id: 'inbox', label: 'Inbox', icon: Megaphone },
  { id: 'history', label: 'History', icon: History },
];

function getCommunityTab(value: string | null): CommunityTab {
  return value === 'history' ? 'history' : 'inbox';
}

function invalidateDashboardShortcuts(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  queryClient.invalidateQueries({ queryKey: ['my-dashboard'] });
}

function getAnnouncementBucket(announcement: Announcement): CommunityTab {
  return announcement.isRead ? 'history' : 'inbox';
}

function getEventBucket(event: SocietyEvent): CommunityTab {
  const eventStart = new Date(event.startAt).getTime();
  const now = Date.now();
  if (event.status === 'SCHEDULED' && eventStart >= now) {
    return 'inbox';
  }
  return 'history';
}

function getApprovalBucket(approval: ApprovalRequest): CommunityTab {
  return approval.status === 'PENDING' ? 'inbox' : 'history';
}

function canReviewApproval(approval: ApprovalRequest, userRole?: string | null) {
  if (!userRole) return false;
  return userRole === 'SUPER_ADMIN' || approval.approverRoles.includes(userRole as any);
}

function getApprovalTitle(actionType: ApprovalRequest['actionType']) {
  return actionType === 'TENANT_REGISTRATION' ? 'Tenant registration' : 'Tenant profile change';
}

function getApprovalSummary(approval: ApprovalRequest) {
  const flatLabel = approval.flat?.block?.name
    ? `${approval.flat.block.name} - ${approval.flat.flatNumber}`
    : approval.flat?.flatNumber || 'flat';

  if (approval.actionType === 'TENANT_REGISTRATION') {
    const tenantName = typeof approval.pendingData?.name === 'string' ? approval.pendingData.name : approval.tenant?.name || 'A tenant';
    return `${tenantName} was submitted for ${flatLabel}.`;
  }

  return `Profile updates were requested for ${approval.tenant?.name || 'the tenant'} in ${flatLabel}.`;
}

export default function CommunityPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [showAnnouncementCreate, setShowAnnouncementCreate] = useState(false);
  const [showEventCreate, setShowEventCreate] = useState(false);
  const [viewAnnouncement, setViewAnnouncement] = useState<Announcement | null>(null);
  const [viewEvent, setViewEvent] = useState<SocietyEvent | null>(null);
  const [viewApproval, setViewApproval] = useState<ApprovalRequest | null>(null);
  const [editingEvent, setEditingEvent] = useState<SocietyEvent | null>(null);
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const canManage = user?.role === 'SUPER_ADMIN' || SOCIETY_MANAGERS.includes((user?.role || '') as any);
  const activeTab = useMemo(() => getCommunityTab(searchParams.get('tab')), [searchParams]);

  const { data: announcements = [], isLoading: announcementsLoading } = useQuery<Announcement[]>({
    queryKey: ['announcements'],
    queryFn: async () => (await api.get('/announcements')).data,
  });

  const { data: events = [], isLoading: eventsLoading } = useQuery<SocietyEvent[]>({
    queryKey: ['events'],
    queryFn: async () => (await api.get('/events')).data,
  });

  const { data: approvals = [], isLoading: approvalsLoading } = useQuery<ApprovalRequest[]>({
    queryKey: ['approvals'],
    queryFn: async () => (await api.get('/approvals')).data,
  });

  const readStateMutation = useMutation({
    mutationFn: ({ announcementId, isRead }: { announcementId: string; isRead: boolean }) => (
      api.patch(`/announcements/${announcementId}/read-state`, { isRead })
    ),
    onSuccess: (_, variables) => {
      toast.success(variables.isRead ? 'Marked as read' : 'Marked as unread');
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
      invalidateDashboardShortcuts(queryClient);
    },
    onError: (error: any) => toast.error(error.response?.data?.error || 'Failed to update read state'),
  });

  const pinMutation = useMutation({
    mutationFn: ({ announcementId, isPinned }: { announcementId: string; isPinned: boolean }) => (
      api.patch(`/announcements/${announcementId}/pin`, { isPinned })
    ),
    onSuccess: (_, variables) => {
      toast.success(variables.isPinned ? 'Announcement pinned' : 'Announcement unpinned');
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
      invalidateDashboardShortcuts(queryClient);
    },
    onError: (error: any) => toast.error(error.response?.data?.error || 'Failed to update pin status'),
  });

  const deleteAnnouncementMutation = useMutation({
    mutationFn: (announcementId: string) => api.delete(`/announcements/${announcementId}`),
    onSuccess: () => {
      toast.success('Announcement deleted');
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
      invalidateDashboardShortcuts(queryClient);
    },
    onError: (error: any) => toast.error(error.response?.data?.error || 'Failed to delete announcement'),
  });

  const deleteEventMutation = useMutation({
    mutationFn: (eventId: string) => api.delete(`/events/${eventId}`),
    onSuccess: () => {
      toast.success('Event deleted');
      queryClient.invalidateQueries({ queryKey: ['events'] });
      invalidateDashboardShortcuts(queryClient);
    },
    onError: (error: any) => toast.error(error.response?.data?.error || 'Failed to delete event'),
  });

  const reminderMutation = useMutation({
    mutationFn: () => api.post('/events/reminders/send'),
    onSuccess: (response) => {
      const count = response.data?.reminderCount || 0;
      toast.success(count > 0 ? `${count} reminders sent` : 'No reminders were due');
    },
    onError: (error: any) => toast.error(error.response?.data?.error || 'Failed to send reminders'),
  });

  const approveApprovalMutation = useMutation({
    mutationFn: (approvalId: string) => api.patch(`/approvals/${approvalId}/approve`),
    onSuccess: () => {
      toast.success('Approval completed');
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['my-flat'] });
      queryClient.invalidateQueries({ queryKey: ['flats'] });
      invalidateDashboardShortcuts(queryClient);
    },
    onError: (error: any) => toast.error(error.response?.data?.error || 'Failed to approve request'),
  });

  const rejectApprovalMutation = useMutation({
    mutationFn: (approvalId: string) => api.patch(`/approvals/${approvalId}/reject`),
    onSuccess: () => {
      toast.success('Approval rejected');
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      invalidateDashboardShortcuts(queryClient);
    },
    onError: (error: any) => toast.error(error.response?.data?.error || 'Failed to reject request'),
  });

  const feedItems = useMemo<CommunityFeedItem[]>(() => {
    const announcementItems: CommunityFeedItem[] = announcements.map((announcement) => ({
      id: `announcement-${announcement.id}`,
      kind: 'announcement',
      bucket: getAnnouncementBucket(announcement),
      sortTimestamp: announcement.isPinned && announcement.pinnedAt
        ? new Date(announcement.pinnedAt).getTime()
        : new Date(announcement.createdAt).getTime(),
      announcement,
    }));

    const eventItems: CommunityFeedItem[] = events.map((event) => ({
      id: `event-${event.id}`,
      kind: 'event',
      bucket: getEventBucket(event),
      sortTimestamp: new Date(event.startAt).getTime(),
      event,
    }));

    const approvalItems: CommunityFeedItem[] = approvals.map((approval) => ({
      id: `approval-${approval.id}`,
      kind: 'approval',
      bucket: getApprovalBucket(approval),
      sortTimestamp: new Date(approval.createdAt).getTime(),
      approval,
    }));

    return [...announcementItems, ...eventItems, ...approvalItems]
      .filter((item) => item.bucket === activeTab)
      .sort((left, right) => {
        if (activeTab === 'inbox') {
          if (left.kind === 'announcement' && right.kind === 'announcement') {
            if (left.announcement.isPinned !== right.announcement.isPinned) {
              return left.announcement.isPinned ? -1 : 1;
            }
          }
          if (left.kind === 'announcement' && left.announcement.isPinned && right.kind === 'event') {
            return -1;
          }
          if (right.kind === 'announcement' && right.announcement.isPinned && left.kind === 'event') {
            return 1;
          }
          if (left.kind === 'event' && right.kind === 'event') {
            return left.sortTimestamp - right.sortTimestamp;
          }
          if (left.kind === 'approval' && right.kind === 'event') {
            return -1;
          }
          if (left.kind === 'event' && right.kind === 'approval') {
            return 1;
          }
          return right.sortTimestamp - left.sortTimestamp;
        }

        return right.sortTimestamp - left.sortTimestamp;
      });
  }, [activeTab, announcements, approvals, events]);

  if (announcementsLoading || eventsLoading || approvalsLoading) {
    return <PageLoader />;
  }

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Inbox</h1>
          <p className="text-sm text-on-surface-variant mt-1">Unread announcements, upcoming events, and approval requests are grouped here.</p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <HeaderActionButton onClick={() => setShowAnnouncementCreate(true)}>
              <Plus className="w-4 h-4" /> Announcement
            </HeaderActionButton>
            <HeaderActionButton onClick={() => setShowEventCreate(true)}>
              <Plus className="w-4 h-4" /> Event
            </HeaderActionButton>
          </div>
        ) : null}
      </div>

      <div className="flex gap-8 border-b border-slate-200">
        {COMMUNITY_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                const nextSearchParams = new URLSearchParams(searchParams);
                nextSearchParams.set('tab', tab.id);
                setSearchParams(nextSearchParams, { replace: true });
              }}
              className={cn(
                'inline-flex items-center gap-2 pb-3 text-sm transition-colors',
                isActive
                  ? 'border-b-2 border-blue-600 font-bold text-blue-600'
                  : 'font-medium text-slate-500 hover:text-slate-800',
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {feedItems.length === 0 ? (
        <EmptyState
          icon={activeTab === 'inbox' ? Megaphone : CalendarDays}
          title={activeTab === 'inbox' ? 'Inbox is clear' : 'No history yet'}
          description={activeTab === 'inbox'
            ? 'Unread announcements, upcoming events, and approval requests will appear here.'
            : 'Read announcements, past events, and processed approvals will appear here.'}
        />
      ) : (
        <div className="space-y-3">
          {feedItems.map((item) => item.kind === 'announcement' ? (
            <article
              key={item.id}
              className="bg-white rounded-2xl overflow-hidden transition-all cursor-pointer active:scale-[0.99]"
              style={{ boxShadow: '0 1px 8px -2px rgba(0,0,0,0.04)' }}
              onClick={() => setViewAnnouncement(item.announcement)}
            >
              <div className="flex gap-3 p-4">
                <div className={cn(
                  'flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold',
                  item.announcement.isPinned
                    ? 'bg-primary/10 text-primary'
                    : !item.announcement.isRead
                      ? 'bg-amber-50 text-amber-600'
                      : 'bg-slate-100 text-slate-500',
                )}>
                  {item.announcement.isPinned ? <Pin className="w-4 h-4" /> : <Megaphone className="w-4 h-4" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Announcement</span>
                        {item.announcement.isPinned ? <span className="inline-flex items-center rounded-full bg-primary/8 px-2 py-0.5 text-[10px] font-semibold text-primary">Pinned</span> : null}
                      </div>
                      <h2 className="mt-2 text-[15px] font-semibold text-[#0F172A] leading-snug truncate">{item.announcement.title}</h2>
                      <p className="text-[12px] text-[#94A3B8] mt-0.5">
                        {item.announcement.createdBy?.name || 'Committee'} · {formatDateTime(item.announcement.createdAt)}
                      </p>
                    </div>
                    {!item.announcement.isRead ? <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1" /> : null}
                  </div>
                  <p className="text-[13px] leading-relaxed text-[#64748B] mt-1.5 line-clamp-2 whitespace-pre-wrap">{item.announcement.message}</p>
                </div>
              </div>

              <div className="flex items-center gap-1 px-3 pb-2.5" onClick={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium text-[#64748B] bg-[#F8FAFC] hover:bg-[#F1F5F9] transition"
                  onClick={() => readStateMutation.mutate({ announcementId: item.announcement.id, isRead: !item.announcement.isRead })}
                  disabled={readStateMutation.isPending}
                >
                  {item.announcement.isRead ? <RotateCcw className="w-3 h-3" /> : <CheckCheck className="w-3 h-3" />}
                  {item.announcement.isRead ? 'Unread' : 'Read'}
                </button>
                {canManage ? (
                  <>
                    <button
                      type="button"
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium transition',
                        item.announcement.isPinned
                          ? 'text-primary bg-primary/8 hover:bg-primary/12'
                          : 'text-[#64748B] bg-[#F8FAFC] hover:bg-[#F1F5F9]',
                      )}
                      onClick={() => pinMutation.mutate({ announcementId: item.announcement.id, isPinned: !item.announcement.isPinned })}
                      disabled={pinMutation.isPending}
                    >
                      <Pin className="w-3 h-3" />
                      {item.announcement.isPinned ? 'Unpin' : 'Pin'}
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium text-red-500 bg-red-50 hover:bg-red-100 transition ml-auto"
                      onClick={() => deleteAnnouncementMutation.mutate(item.announcement.id)}
                      disabled={deleteAnnouncementMutation.isPending}
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete
                    </button>
                  </>
                ) : null}
              </div>
            </article>
          ) : item.kind === 'event' ? (
            <article
              key={item.id}
              className="bg-white rounded-2xl overflow-hidden transition-all cursor-pointer active:scale-[0.99]"
              style={{ boxShadow: '0 1px 8px -2px rgba(0,0,0,0.04)' }}
              onClick={() => setViewEvent(item.event)}
            >
              <div className="flex gap-3 p-4">
                <div className={cn(
                  'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full',
                  activeTab === 'history' ? 'bg-slate-100 text-slate-500' : 'bg-blue-50 text-blue-600',
                )}>
                  <CalendarDays className="w-4 h-4" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Event</span>
                        <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', getStatusColor(item.event.status))}>{item.event.status}</span>
                      </div>
                      <h2 className="mt-2 text-[15px] font-semibold text-[#0F172A] leading-snug truncate">{item.event.title}</h2>
                      <p className="text-[12px] text-[#94A3B8] mt-0.5">
                        {item.event.createdBy?.name || 'Committee'} · {formatDateTime(item.event.startAt)}
                      </p>
                    </div>
                  </div>

                  <p className="text-[13px] leading-relaxed text-[#64748B] mt-1.5 line-clamp-2 whitespace-pre-wrap">{item.event.description}</p>

                  <div className="mt-3 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                      <Clock3 className="w-3.5 h-3.5 text-outline flex-shrink-0" />
                      <span>{formatDateTime(item.event.startAt)}{item.event.endAt ? ` – ${formatDateTime(item.event.endAt)}` : ''}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                      <MapPin className="w-3.5 h-3.5 text-outline flex-shrink-0" />
                      <span>{item.event.place}</span>
                    </div>
                  </div>
                </div>
              </div>

              {canManage ? (
                <div className="flex items-center gap-1 px-3 pb-2.5" onClick={(event) => event.stopPropagation()}>
                  {item.event.status === 'SCHEDULED' ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium text-[#64748B] bg-[#F8FAFC] hover:bg-[#F1F5F9] transition"
                      onClick={() => reminderMutation.mutate()}
                      disabled={reminderMutation.isPending}
                    >
                      <BellRing className="w-3 h-3" />
                      {reminderMutation.isPending ? 'Sending...' : 'Reminders'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium text-[#64748B] bg-[#F8FAFC] hover:bg-[#F1F5F9] transition"
                    onClick={() => setEditingEvent(item.event)}
                  >
                    <Pencil className="w-3 h-3" /> Edit
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium text-red-500 bg-red-50 hover:bg-red-100 transition ml-auto"
                    onClick={() => deleteEventMutation.mutate(item.event.id)}
                    disabled={deleteEventMutation.isPending}
                  >
                    <Trash2 className="w-3 h-3" /> Delete
                  </button>
                </div>
              ) : null}
            </article>
          ) : (
            <article
              key={item.id}
              className="cursor-pointer overflow-hidden rounded-2xl bg-white transition-all active:scale-[0.99]"
              style={{ boxShadow: '0 1px 8px -2px rgba(0,0,0,0.04)' }}
              onClick={() => setViewApproval(item.approval)}
            >
              <div className="flex gap-3 p-4">
                <div className={cn(
                  'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full',
                  item.approval.status === 'PENDING'
                    ? 'bg-amber-50 text-amber-600'
                    : item.approval.status === 'APPROVED'
                      ? 'bg-emerald-50 text-emerald-600'
                      : 'bg-slate-100 text-slate-500',
                )}>
                  <ShieldCheck className="h-4 w-4" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Approval</span>
                        <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', item.approval.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700' : item.approval.status === 'REJECTED' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700')}>
                          {item.approval.status}
                        </span>
                      </div>
                      <h2 className="mt-2 truncate text-[15px] font-semibold leading-snug text-[#0F172A]">{getApprovalTitle(item.approval.actionType)}</h2>
                      <p className="mt-0.5 text-[12px] text-[#94A3B8]">
                        {item.approval.requestedBy?.name || 'Resident'} · {formatDateTime(item.approval.createdAt)}
                      </p>
                    </div>
                  </div>

                  <p className="mt-1.5 line-clamp-2 whitespace-pre-wrap text-[13px] leading-relaxed text-[#64748B]">{getApprovalSummary(item.approval)}</p>
                  {item.approval.requesterComment ? (
                    <p className="mt-2 text-xs text-slate-500">Comment: {item.approval.requesterComment}</p>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-1 px-3 pb-2.5" onClick={(event) => event.stopPropagation()}>
                {item.approval.status === 'PENDING' && canReviewApproval(item.approval, user?.role) ? (
                  <>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-medium text-emerald-600 transition hover:bg-emerald-100"
                      onClick={() => approveApprovalMutation.mutate(item.approval.id)}
                      disabled={approveApprovalMutation.isPending}
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      Approve
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1.5 text-[11px] font-medium text-rose-600 transition hover:bg-rose-100"
                      onClick={() => rejectApprovalMutation.mutate(item.approval.id)}
                      disabled={rejectApprovalMutation.isPending}
                    >
                      <XCircle className="h-3 w-3" />
                      Reject
                    </button>
                  </>
                ) : item.approval.status === 'APPROVED' ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-medium text-emerald-600">
                    <CheckCircle2 className="h-3 w-3" /> Approved
                  </span>
                ) : item.approval.status === 'REJECTED' ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1.5 text-[11px] font-medium text-rose-600">
                    <XCircle className="h-3 w-3" /> Rejected
                  </span>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal isOpen={!!viewAnnouncement} onClose={() => setViewAnnouncement(null)} title={viewAnnouncement?.title || 'Announcement'} size="lg">
        {viewAnnouncement ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
              <span>{viewAnnouncement.createdBy?.name || 'Committee'}</span>
              <span>·</span>
              <span>{formatDateTime(viewAnnouncement.createdAt)}</span>
              {viewAnnouncement.isPinned ? <span className="inline-flex items-center rounded-full bg-primary/8 px-2 py-0.5 text-[10px] font-semibold text-primary ml-1">Pinned</span> : null}
            </div>
            <p className="text-sm leading-relaxed text-[#334155] whitespace-pre-wrap">{viewAnnouncement.message}</p>
          </div>
        ) : null}
      </Modal>

      <Modal isOpen={showAnnouncementCreate} onClose={() => setShowAnnouncementCreate(false)} title="New Announcement" size="lg">
        <AnnouncementForm
          onSuccess={() => {
            setShowAnnouncementCreate(false);
            queryClient.invalidateQueries({ queryKey: ['announcements'] });
            invalidateDashboardShortcuts(queryClient);
          }}
        />
      </Modal>

      <Modal isOpen={!!viewEvent} onClose={() => setViewEvent(null)} title={viewEvent?.title || 'Event'} size="lg">
        {viewEvent ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', getStatusColor(viewEvent.status))}>{viewEvent.status}</span>
              <span className="text-xs text-[#94A3B8]">{viewEvent.createdBy?.name || 'Committee'}</span>
            </div>
            <p className="text-sm leading-relaxed text-[#334155] whitespace-pre-wrap">{viewEvent.description}</p>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-on-surface-variant">
                <Clock3 className="w-4 h-4 text-outline flex-shrink-0" />
                <span>{formatDateTime(viewEvent.startAt)}{viewEvent.endAt ? ` – ${formatDateTime(viewEvent.endAt)}` : ''}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-on-surface-variant">
                <MapPin className="w-4 h-4 text-outline flex-shrink-0" />
                <span>{viewEvent.place}</span>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal isOpen={!!viewApproval} onClose={() => setViewApproval(null)} title={viewApproval ? getApprovalTitle(viewApproval.actionType) : 'Approval'} size="lg">
        {viewApproval ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Approval</span>
              <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', viewApproval.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700' : viewApproval.status === 'REJECTED' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700')}>
                {viewApproval.status}
              </span>
            </div>
            <p className="text-sm text-[#94A3B8]">{viewApproval.requestedBy?.name || 'Resident'} · {formatDateTime(viewApproval.createdAt)}</p>
            <p className="text-sm leading-relaxed text-[#334155]">{getApprovalSummary(viewApproval)}</p>
            {viewApproval.requesterComment ? <p className="text-sm text-slate-600">Requester comment: {viewApproval.requesterComment}</p> : null}
            {viewApproval.decisionComment ? <p className="text-sm text-slate-600">Decision comment: {viewApproval.decisionComment}</p> : null}
            {viewApproval.flat ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                Flat: {viewApproval.flat.block?.name ? `${viewApproval.flat.block.name} - ` : ''}{viewApproval.flat.flatNumber}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal isOpen={showEventCreate} onClose={() => setShowEventCreate(false)} title="New Event" size="lg">
        <EventForm
          onSuccess={() => {
            setShowEventCreate(false);
            queryClient.invalidateQueries({ queryKey: ['events'] });
            invalidateDashboardShortcuts(queryClient);
          }}
        />
      </Modal>

      <Modal isOpen={!!editingEvent} onClose={() => setEditingEvent(null)} title="Edit Event" size="lg">
        {editingEvent ? (
          <EventForm
            event={editingEvent}
            onSuccess={() => {
              setEditingEvent(null);
              queryClient.invalidateQueries({ queryKey: ['events'] });
              invalidateDashboardShortcuts(queryClient);
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function HeaderActionButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-lg border border-blue-600 bg-white px-4 py-2 text-sm font-semibold text-blue-600 transition-colors hover:bg-blue-50"
    >
      {children}
    </button>
  );
}