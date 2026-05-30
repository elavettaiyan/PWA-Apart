import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  Mail,
  Phone,
  User,
  CheckCircle2,
  XCircle,
  CreditCard,
  Clock,
  FileText,
  Tag,
  X,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { PageLoader } from '../../components/ui/Loader';
import { formatCurrency } from '../../lib/utils';

// ── Types ──────────────────────────────────────────────────────

type AdminContact = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  createdAt: string;
};

type SubscriptionPayment = {
  id: string;
  status: string;
  amountPaise: number;
  paidAt: string | null;
  failureReason: string | null;
  razorpayPaymentId: string | null;
  createdAt: string;
};

type LatestSubscription = {
  id: string;
  status: string;
  lockedFlatCount: number;
  includedFlatCount: number;
  amountPerFlatPaise: number;
  amountPaise: number;
  startDate: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextBillingAt: string | null;
  cancelledAt: string | null;
  expiresAt: string | null;
  overdueStartedAt: string | null;
  notes: string | null;
  createdAt: string;
  payments: SubscriptionPayment[];
};

type CrmDetail = {
  id: string;
  name: string;
  communityType: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  registrationNo: string | null;
  isActive: boolean;
  isPremium: boolean;
  hadPremiumSubscription: boolean;
  premiumOverrideUntil: string | null;
  premiumOverrideActive: boolean;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  crmNotes: string | null;
  crmTags: string[];
  createdAt: string;
  updatedAt: string;
  _count: { users: number; blocks: number; complaints: number; expenses: number };
  adminContacts: AdminContact[];
  latestSubscription: LatestSubscription | null;
  trial: {
    isOnTrial: boolean;
    isExpired: boolean;
    trialStartedAt: string | null;
    trialEndsAt: string | null;
    daysRemaining: number;
    flatLimit: number;
  };
};

type PaymentHistoryResponse = {
  payments: (SubscriptionPayment & {
    premiumSubscription: {
      id: string;
      status: string;
      lockedFlatCount: number;
      amountPaise: number;
      startDate: string | null;
      currentPeriodStart: string | null;
      currentPeriodEnd: string | null;
    };
  })[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

type AuditLog = {
  id: string;
  action: string;
  description: string | null;
  createdAt: string;
  performedBy: { id: string; name: string; email: string };
};

// ── Helpers ────────────────────────────────────────────────────

function fmt(dateStr: string | null | undefined) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    ACTIVE: 'badge-success',
    HALTED: 'bg-red-100 text-red-600',
    CANCELLED: 'bg-red-100 text-red-600',
    PENDING: 'bg-amber-100 text-amber-700',
    SUCCESS: 'badge-success',
    FAILED: 'bg-red-100 text-red-600',
    REFUNDED: 'bg-slate-100 text-slate-500',
  };
  return `badge text-[10px] font-semibold ${map[status] ?? 'badge-neutral'}`;
}

const SUGGESTED_TAGS = ['VIP', 'at-risk', 'churned', 'demo', 'paying', 'onboarding'];

// ── Tabs ───────────────────────────────────────────────────────

const TABS = ['Overview', 'Subscription & Trial', 'Payments', 'Notes & Tags', 'Audit Log'] as const;
type Tab = (typeof TABS)[number];

// ── Main Page ──────────────────────────────────────────────────

export default function CrmSocietyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>('Overview');

  const { data: society, isLoading } = useQuery<CrmDetail>({
    queryKey: ['crm-society', id],
    queryFn: async () => (await api.get(`/admin/crm/societies/${id}`)).data,
    enabled: !!id,
  });

  if (isLoading || !society) return <PageLoader />;

  return (
    <div className="space-y-6">
      {/* Back + Header */}
      <div>
        <button
          type="button"
          onClick={() => navigate('/crm')}
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-on-surface mb-3"
        >
          <ArrowLeft className="w-4 h-4" /> Back to CRM
        </button>
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
              {society.communityType.replace('_', ' ')}
            </p>
            <h1 className="page-title flex items-center gap-2 flex-wrap">
              <Building2 className="w-5 h-5 text-violet-500 shrink-0" />
              {society.name}
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              {society.address}, {society.city}, {society.state} — {society.pincode}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`badge font-semibold ${society.isActive ? 'badge-success' : 'bg-red-100 text-red-600'}`}>
              {society.isActive ? 'Active' : 'Inactive'}
            </span>
            {society.isPremium && <span className="badge bg-violet-100 text-violet-700 font-semibold">Premium</span>}
            {society.premiumOverrideActive && <span className="badge bg-indigo-100 text-indigo-700 font-semibold">Override Active</span>}
            {society.trial.isOnTrial && !society.isPremium && (
              <span className="badge bg-amber-100 text-amber-700 font-semibold">Trial · {society.trial.daysRemaining}d</span>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto gap-1 bg-white rounded-2xl p-1.5 shadow-card">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
              tab === t
                ? 'bg-primary text-white shadow-sm'
                : 'text-slate-500 hover:text-on-surface hover:bg-slate-50'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'Overview' && <OverviewTab society={society} queryClient={queryClient} societyId={id!} />}
      {tab === 'Subscription & Trial' && <SubscriptionTab society={society} queryClient={queryClient} societyId={id!} />}
      {tab === 'Payments' && <PaymentsTab societyId={id!} />}
      {tab === 'Notes & Tags' && <NotesTagsTab society={society} queryClient={queryClient} societyId={id!} />}
      {tab === 'Audit Log' && <AuditLogTab societyId={id!} />}
    </div>
  );
}

// ── Overview Tab ───────────────────────────────────────────────

function OverviewTab({
  society,
  queryClient,
  societyId,
}: {
  society: CrmDetail;
  queryClient: ReturnType<typeof useQueryClient>;
  societyId: string;
}) {
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmName, setConfirmName] = useState('');

  const deleteSociety = useMutation({
    mutationFn: () =>
      api.delete(`/admin/societies/${societyId}`, { data: { confirmationName: confirmName } }),
    onSuccess: () => {
      toast.success('Society and all linked data deleted');
      queryClient.invalidateQueries({ queryKey: ['crm-societies'] });
      navigate('/crm');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to delete'),
  });

  const toggleStatus = useMutation({
    mutationFn: (isActive: boolean) =>
      api.patch(`/admin/crm/societies/${societyId}/status`, { isActive }),
    onSuccess: () => {
      toast.success(society.isActive ? 'Society deactivated' : 'Society activated');
      queryClient.invalidateQueries({ queryKey: ['crm-society', societyId] });
      queryClient.invalidateQueries({ queryKey: ['crm-societies'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Users', value: society._count.users },
          { label: 'Blocks', value: society._count.blocks },
          { label: 'Complaints', value: society._count.complaints },
          { label: 'Expenses', value: society._count.expenses },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-2xl p-4 shadow-card text-center">
            <p className="text-2xl font-extrabold font-headline text-on-surface">{value}</p>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Admin Contacts */}
      <div className="bg-white rounded-2xl p-5 shadow-card">
        <h2 className="text-sm font-bold text-on-surface mb-4 flex items-center gap-2">
          <User className="w-4 h-4 text-slate-400" /> Admin Contacts
        </h2>
        {society.adminContacts.length === 0 ? (
          <p className="text-sm text-slate-400 italic">No admin contacts found.</p>
        ) : (
          <div className="space-y-3">
            {society.adminContacts.map((c) => (
              <div key={c.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-slate-50 rounded-xl p-3">
                <div>
                  <p className="text-sm font-semibold text-on-surface">{c.name}</p>
                  <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                    {c.role.replace('_', ' ')}
                  </p>
                </div>
                <div className="flex flex-col sm:items-end gap-1 text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <Mail className="w-3 h-3" /> {c.email}
                  </span>
                  {c.phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="w-3 h-3" /> {c.phone}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="bg-white rounded-2xl p-5 shadow-card">
        <h2 className="text-sm font-bold text-on-surface mb-4">Society Details</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {[
            { label: 'Registration No', value: society.registrationNo || '—' },
            { label: 'Community Type', value: society.communityType.replace(/_/g, ' ') },
            { label: 'Registered', value: fmt(society.createdAt) },
            { label: 'Last Updated', value: fmt(society.updatedAt) },
          ].map(({ label, value }) => (
            <div key={label}>
              <dt className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</dt>
              <dd className="text-on-surface mt-0.5">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Activate / Deactivate */}
      <div className="bg-white rounded-2xl p-5 shadow-card">
        <h2 className="text-sm font-bold text-on-surface mb-1">Society Status</h2>
        <p className="text-xs text-slate-500 mb-4">
          Deactivating a society prevents all members from logging in via the premium lifecycle gate.
        </p>
        {society.isActive ? (
          <button
            type="button"
            disabled={toggleStatus.isPending}
            onClick={() => toggleStatus.mutate(false)}
            className="btn-outline text-red-500 border-red-200 hover:bg-red-50 flex items-center gap-2 text-sm"
          >
            <XCircle className="w-4 h-4" />
            {toggleStatus.isPending ? 'Deactivating...' : 'Deactivate Society'}
          </button>
        ) : (
          <button
            type="button"
            disabled={toggleStatus.isPending}
            onClick={() => toggleStatus.mutate(true)}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <CheckCircle2 className="w-4 h-4" />
            {toggleStatus.isPending ? 'Activating...' : 'Activate Society'}
          </button>
        )}
      </div>

      {/* Delete Society */}
      <div className="bg-white rounded-2xl p-5 shadow-card border border-red-100">
        <h2 className="text-sm font-bold text-red-600 mb-1 flex items-center gap-2">
          <Trash2 className="w-4 h-4" /> Danger Zone
        </h2>
        <p className="text-xs text-slate-500 mb-4">
          Permanently deletes this society and ALL linked data — blocks, flats, users, bills, complaints, and expenses. This cannot be undone.
        </p>
        {!confirmDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="btn-outline text-red-500 border-red-200 hover:bg-red-50 flex items-center gap-2 text-sm"
          >
            <Trash2 className="w-4 h-4" /> Delete Entire Society
          </button>
        ) : (
          <div className="rounded-xl bg-red-50 border border-red-100 p-4">
            <p className="text-sm font-bold text-red-700 mb-1">Confirm deletion: {society.name}</p>
            <p className="text-xs text-red-600/80 mb-3">Type the society name exactly to continue.</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                className="input flex-1"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={`Type ${society.name}`}
              />
              <button
                type="button"
                className="btn-danger disabled:opacity-40"
                disabled={deleteSociety.isPending || confirmName.trim() !== society.name}
                onClick={() => deleteSociety.mutate()}
              >
                {deleteSociety.isPending ? 'Deleting...' : 'Confirm Delete'}
              </button>
              <button
                type="button"
                className="btn-outline text-sm"
                onClick={() => { setConfirmDelete(false); setConfirmName(''); }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Subscription & Trial Tab ───────────────────────────────────

function SubscriptionTab({
  society,
  queryClient,
  societyId,
}: {
  society: CrmDetail;
  queryClient: ReturnType<typeof useQueryClient>;
  societyId: string;
}) {
  const [trialDate, setTrialDate] = useState(
    society.trialEndsAt ? society.trialEndsAt.slice(0, 10) : '',
  );
  const [overrideDate, setOverrideDate] = useState(
    society.premiumOverrideUntil ? society.premiumOverrideUntil.slice(0, 10) : '',
  );

  const extendTrial = useMutation({
    mutationFn: () =>
      api.patch(`/admin/crm/societies/${societyId}/trial`, {
        trialEndsAt: new Date(trialDate).toISOString(),
      }),
    onSuccess: () => {
      toast.success('Trial period updated');
      queryClient.invalidateQueries({ queryKey: ['crm-society', societyId] });
      queryClient.invalidateQueries({ queryKey: ['crm-societies'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const setPremiumOverride = useMutation({
    mutationFn: (value: string | null) =>
      api.patch(`/admin/crm/societies/${societyId}/premium-override`, {
        premiumOverrideUntil: value ? new Date(value).toISOString() : null,
      }),
    onSuccess: () => {
      toast.success('Premium override updated');
      queryClient.invalidateQueries({ queryKey: ['crm-society', societyId] });
      queryClient.invalidateQueries({ queryKey: ['crm-societies'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const sub = society.latestSubscription;

  return (
    <div className="space-y-5">
      {/* Current Subscription */}
      <div className="bg-white rounded-2xl p-5 shadow-card">
        <h2 className="text-sm font-bold text-on-surface mb-4 flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-slate-400" /> Subscription
        </h2>
        {sub ? (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {[
              { label: 'Status', value: <span className={statusBadge(sub.status)}>{sub.status}</span> },
              { label: 'Flats (billed)', value: sub.lockedFlatCount },
              { label: 'Flats (included)', value: sub.includedFlatCount },
              { label: 'Amount', value: formatCurrency(sub.amountPaise / 100) + ' / month' },
              { label: 'Start Date', value: fmt(sub.startDate) },
              { label: 'Period Start', value: fmt(sub.currentPeriodStart) },
              { label: 'Period End', value: fmt(sub.currentPeriodEnd) },
              { label: 'Next Billing', value: fmt(sub.nextBillingAt) },
              { label: 'Cancelled At', value: fmt(sub.cancelledAt) },
              { label: 'Expires At', value: fmt(sub.expiresAt) },
            ].map(({ label, value }) => (
              <div key={label}>
                <dt className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</dt>
                <dd className="text-on-surface mt-0.5">{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-slate-400 italic">No subscription found.</p>
        )}
      </div>

      {/* Trial Period */}
      <div className="bg-white rounded-2xl p-5 shadow-card">
        <h2 className="text-sm font-bold text-on-surface mb-1 flex items-center gap-2">
          <Clock className="w-4 h-4 text-slate-400" /> Trial Period
        </h2>
        <p className="text-xs text-slate-500 mb-4">
          Current trial:{' '}
          {society.trial.trialStartedAt
            ? `${fmt(society.trial.trialStartedAt)} → ${fmt(society.trial.trialEndsAt)}`
            : 'Not started'}
          {society.trial.isOnTrial && (
            <span className="ml-2 text-amber-600 font-semibold">· {society.trial.daysRemaining}d remaining</span>
          )}
          {society.trial.isExpired && <span className="ml-2 text-red-500 font-semibold">· Expired</span>}
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1 block">
              Set Trial End Date
            </label>
            <input
              type="date"
              className="input w-full"
              value={trialDate}
              onChange={(e) => setTrialDate(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              disabled={!trialDate || extendTrial.isPending}
              onClick={() => extendTrial.mutate()}
              className="btn-primary text-sm disabled:opacity-40"
            >
              {extendTrial.isPending ? 'Saving…' : 'Update Trial'}
            </button>
          </div>
        </div>
      </div>

      {/* Premium Override */}
      <div className="bg-white rounded-2xl p-5 shadow-card">
        <h2 className="text-sm font-bold text-on-surface mb-1 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-slate-400" /> Manual Premium Override
        </h2>
        <p className="text-xs text-slate-500 mb-4">
          Grants full premium access until the chosen date regardless of Razorpay subscription status. Current:{' '}
          {society.premiumOverrideUntil
            ? <span className={society.premiumOverrideActive ? 'text-indigo-600 font-semibold' : 'text-red-500'}>{fmt(society.premiumOverrideUntil)}</span>
            : 'None'}
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1 block">
              Override Until
            </label>
            <input
              type="date"
              className="input w-full"
              value={overrideDate}
              onChange={(e) => setOverrideDate(e.target.value)}
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              type="button"
              disabled={!overrideDate || setPremiumOverride.isPending}
              onClick={() => setPremiumOverride.mutate(overrideDate)}
              className="btn-primary text-sm disabled:opacity-40"
            >
              {setPremiumOverride.isPending ? 'Saving…' : 'Set Override'}
            </button>
            {society.premiumOverrideUntil && (
              <button
                type="button"
                disabled={setPremiumOverride.isPending}
                onClick={() => {
                  setOverrideDate('');
                  setPremiumOverride.mutate(null);
                }}
                className="btn-outline text-sm text-red-500 border-red-200 hover:bg-red-50"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Payments Tab ───────────────────────────────────────────────

function PaymentsTab({ societyId }: { societyId: string }) {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery<PaymentHistoryResponse>({
    queryKey: ['crm-payments', societyId, page],
    queryFn: async () =>
      (await api.get(`/admin/crm/societies/${societyId}/payments`, { params: { page, limit: 20 } })).data,
    enabled: !!societyId,
  });

  if (isLoading) return <PageLoader />;

  const { payments = [], pagination } = data ?? {};

  return (
    <div className="bg-white rounded-2xl p-5 shadow-card">
      <h2 className="text-sm font-bold text-on-surface mb-4 flex items-center gap-2">
        <CreditCard className="w-4 h-4 text-slate-400" /> Premium Payment History
        {pagination && <span className="text-xs text-slate-400 font-normal">({pagination.total} total)</span>}
      </h2>

      {payments.length === 0 ? (
        <p className="text-sm text-slate-400 italic text-center py-8">No payments found.</p>
      ) : (
        <>
          <div className="table-container">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Razorpay ID</th>
                  <th>Period</th>
                  <th>Failure Reason</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap">
                      {fmt(p.paidAt ?? p.createdAt)}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-on-surface whitespace-nowrap">
                      {formatCurrency(p.amountPaise / 100)}
                    </td>
                    <td className="py-2.5 px-4">
                      <span className={statusBadge(p.status)}>{p.status}</span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-400 font-mono text-xs">
                      {p.razorpayPaymentId ?? '—'}
                    </td>
                    <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap text-xs">
                      {p.premiumSubscription.currentPeriodStart
                        ? `${fmt(p.premiumSubscription.currentPeriodStart)} → ${fmt(p.premiumSubscription.currentPeriodEnd)}`
                        : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-red-500 text-xs">{p.failureReason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100">
              <button
                type="button"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                className="btn-outline text-sm disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-xs text-slate-400">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                type="button"
                disabled={page === pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="btn-outline text-sm disabled:opacity-40"
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

// ── Notes & Tags Tab ───────────────────────────────────────────

function NotesTagsTab({
  society,
  queryClient,
  societyId,
}: {
  society: CrmDetail;
  queryClient: ReturnType<typeof useQueryClient>;
  societyId: string;
}) {
  const [notes, setNotes] = useState(society.crmNotes ?? '');
  const [tags, setTags] = useState<string[]>(society.crmTags);
  const [tagInput, setTagInput] = useState('');
  const [notesSaved, setNotesSaved] = useState(false);

  const saveMeta = useMutation({
    mutationFn: (data: { crmNotes?: string | null; crmTags?: string[] }) =>
      api.patch(`/admin/crm/societies/${societyId}/crm-meta`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-society', societyId] });
      queryClient.invalidateQueries({ queryKey: ['crm-societies'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save'),
  });

  function saveNotes() {
    saveMeta.mutate({ crmNotes: notes || null });
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 2000);
  }

  function addTag(tag: string) {
    const clean = tag.trim();
    if (!clean || tags.includes(clean)) return;
    const newTags = [...tags, clean];
    setTags(newTags);
    saveMeta.mutate({ crmTags: newTags });
    setTagInput('');
  }

  function removeTag(tag: string) {
    const newTags = tags.filter((t) => t !== tag);
    setTags(newTags);
    saveMeta.mutate({ crmTags: newTags });
  }

  return (
    <div className="space-y-5">
      {/* Notes */}
      <div className="bg-white rounded-2xl p-5 shadow-card">
        <h2 className="text-sm font-bold text-on-surface mb-1 flex items-center gap-2">
          <FileText className="w-4 h-4 text-slate-400" /> Internal Notes
        </h2>
        <p className="text-xs text-slate-500 mb-4">
          Visible only to super admins. Not shown to society members.
        </p>
        <textarea
          rows={6}
          className="input w-full resize-y text-sm font-normal"
          placeholder="Add internal notes about this society…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
        />
        <div className="flex items-center gap-3 mt-3">
          <button
            type="button"
            onClick={saveNotes}
            disabled={saveMeta.isPending}
            className="btn-primary text-sm disabled:opacity-40"
          >
            {saveMeta.isPending ? 'Saving…' : 'Save Notes'}
          </button>
          {notesSaved && <span className="text-xs text-emerald-500 font-semibold">Saved ✓</span>}
        </div>
      </div>

      {/* Tags */}
      <div className="bg-white rounded-2xl p-5 shadow-card">
        <h2 className="text-sm font-bold text-on-surface mb-1 flex items-center gap-2">
          <Tag className="w-4 h-4 text-slate-400" /> Tags
        </h2>
        <p className="text-xs text-slate-500 mb-4">Label this society for internal filtering.</p>

        {/* Current tags */}
        <div className="flex flex-wrap gap-2 mb-4">
          {tags.length === 0 && <p className="text-xs text-slate-400 italic">No tags yet.</p>}
          {tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 badge bg-slate-100 text-slate-600 text-xs"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="text-slate-400 hover:text-red-500 ml-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>

        {/* Suggested tags */}
        <div className="flex flex-wrap gap-2 mb-4">
          {SUGGESTED_TAGS.filter((t) => !tags.includes(t)).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => addTag(t)}
              className="badge bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100 text-xs cursor-pointer"
            >
              + {t}
            </button>
          ))}
        </div>

        {/* Custom tag input */}
        <div className="flex gap-2">
          <input
            type="text"
            className="input flex-1 text-sm"
            placeholder="Add custom tag…"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTag(tagInput);
              }
            }}
          />
          <button
            type="button"
            disabled={!tagInput.trim()}
            onClick={() => addTag(tagInput)}
            className="btn-primary text-sm disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Audit Log Tab ──────────────────────────────────────────────

function AuditLogTab({ societyId }: { societyId: string }) {
  const { data: logs = [], isLoading } = useQuery<AuditLog[]>({
    queryKey: ['crm-audit', societyId],
    queryFn: async () => (await api.get(`/admin/crm/societies/${societyId}/audit`)).data,
    enabled: !!societyId,
  });

  if (isLoading) return <PageLoader />;

  return (
    <div className="bg-white rounded-2xl p-5 shadow-card">
      <h2 className="text-sm font-bold text-on-surface mb-4 flex items-center gap-2">
        <Clock className="w-4 h-4 text-slate-400" /> Audit Log
        <span className="text-xs text-slate-400 font-normal">({logs.length} entries)</span>
      </h2>

      {logs.length === 0 ? (
        <p className="text-sm text-slate-400 italic text-center py-8">No audit entries yet.</p>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => (
            <div key={log.id} className="flex gap-3 py-2 border-b border-slate-50 last:border-0">
              <div className="w-2 h-2 rounded-full bg-slate-300 mt-1.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-0.5">
                  <span className="badge bg-slate-100 text-slate-600 text-[10px] font-mono font-semibold">
                    {log.action}
                  </span>
                  <span className="text-xs text-slate-400 whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString('en-IN')}
                  </span>
                </div>
                {log.description && (
                  <p className="text-xs text-slate-600">{log.description}</p>
                )}
                <p className="text-[11px] text-slate-400 mt-0.5">
                  By {log.performedBy.name} ({log.performedBy.email})
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
