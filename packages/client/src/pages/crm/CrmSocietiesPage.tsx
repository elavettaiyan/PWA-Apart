import { useState, useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  Search,
  Download,
  ChevronRight,
  Phone,
  Mail,
  Send,
  Eye,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import Modal from '../../components/ui/Modal';
import { PageLoader } from '../../components/ui/Loader';
import { isValidEmailAddress } from '../../lib/utils';

// ── Types ──────────────────────────────────────────────────────

type CrmSociety = {
  id: string;
  name: string;
  city: string;
  state: string;
  isActive: boolean;
  isPremium: boolean;
  premiumOverrideUntil: string | null;
  premiumOverrideActive: boolean;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  crmTags: string[];
  createdAt: string;
  trial: {
    isOnTrial: boolean;
    isExpired: boolean;
    daysRemaining: number;
  };
  primaryContact: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    role: string;
  } | null;
  latestSubscription: {
    id: string;
    status: string;
    lockedFlatCount: number;
    amountPaise: number;
    currentPeriodEnd: string | null;
  } | null;
};

type CampaignMailResponse = {
  intendedRecipientCount: number;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  failedRecipients: string[];
  skippedCount: number;
  targetMode: 'all' | 'specific';
};

type CampaignHistoryEntry = {
  id: string;
  targetMode: 'all' | 'specific';
  subject: string;
  intendedRecipientCount: number;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  skippedReason: string | null;
  failedRecipients: string[];
  createdAt: string;
  performedBy: {
    id: string;
    name: string;
    email: string;
  };
};

type CampaignTargetMode = 'all' | 'specific';

// ── Sub-components ─────────────────────────────────────────────

function PremiumBadge({ society }: { society: CrmSociety }) {
  if (society.isPremium) {
    return (
      <span className="badge bg-violet-100 text-violet-700 font-semibold text-[11px]">
        Premium
      </span>
    );
  }
  if (society.premiumOverrideActive) {
    return (
      <span className="badge bg-indigo-100 text-indigo-700 font-semibold text-[11px]">
        Override
      </span>
    );
  }
  if (society.trial.isOnTrial) {
    return (
      <span className="badge bg-amber-100 text-amber-700 font-semibold text-[11px]">
        Trial · {society.trial.daysRemaining}d
      </span>
    );
  }
  return (
    <span className="badge bg-slate-100 text-slate-500 font-semibold text-[11px]">
      Free
    </span>
  );
}

// ── Main Page ──────────────────────────────────────────────────

export default function CrmSocietiesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [premiumFilter, setPremiumFilter] = useState<'all' | 'true' | 'false' | 'trial' | 'override'>('all');
  const [exportLoading, setExportLoading] = useState(false);
  const [showCampaignModal, setShowCampaignModal] = useState(false);

  const { data: societies = [], isLoading } = useQuery<CrmSociety[]>({
    queryKey: ['crm-societies'],
    queryFn: async () => (await api.get('/admin/crm/societies')).data,
  });

  const { data: campaignHistory = [] } = useQuery<CampaignHistoryEntry[]>({
    queryKey: ['crm-campaign-history'],
    queryFn: async () => (await api.get('/admin/crm/campaign-mails/history')).data,
  });

  const filtered = useMemo(() => {
    return societies.filter((s) => {
      if (search) {
        const q = search.toLowerCase();
        const match =
          s.name.toLowerCase().includes(q) ||
          s.city.toLowerCase().includes(q) ||
          s.state.toLowerCase().includes(q) ||
          (s.primaryContact?.name?.toLowerCase().includes(q) ?? false) ||
          (s.primaryContact?.email?.toLowerCase().includes(q) ?? false);
        if (!match) return false;
      }
      if (statusFilter === 'active' && !s.isActive) return false;
      if (statusFilter === 'inactive' && s.isActive) return false;
      if (premiumFilter === 'true' && !s.isPremium) return false;
      if (premiumFilter === 'false' && (s.isPremium || s.premiumOverrideActive)) return false;
      if (premiumFilter === 'trial' && !s.trial.isOnTrial) return false;
      if (premiumFilter === 'override' && !s.premiumOverrideActive) return false;
      return true;
    });
  }, [societies, search, statusFilter, premiumFilter]);

  async function handleExport() {
    setExportLoading(true);
    try {
      const response = await api.get('/admin/crm/export', { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([response.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `societies-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // silent — user can retry
    } finally {
      setExportLoading(false);
    }
  }

  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
            Platform Controls
          </p>
          <h1 className="page-title flex items-center gap-2">
            <Building2 className="w-6 h-6 text-violet-500" />
            CRM — Society Management
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {filtered.length} of {societies.length} societies
          </p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exportLoading}
          className="btn-outline flex items-center gap-2 text-sm self-start sm:self-auto"
        >
          <Download className="w-4 h-4" />
          {exportLoading ? 'Exporting...' : 'Export CSV'}
        </button>
        <button
          type="button"
          onClick={() => setShowCampaignModal(true)}
          className="btn-primary flex items-center gap-2 text-sm self-start sm:self-auto"
        >
          <Send className="w-4 h-4" />
          Publish Mail
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl p-4 shadow-card flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name, city, admin…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-9 w-full"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="input w-full sm:w-40"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <select
          value={premiumFilter}
          onChange={(e) => setPremiumFilter(e.target.value as typeof premiumFilter)}
          className="input w-full sm:w-44"
        >
          <option value="all">All tiers</option>
          <option value="true">Premium</option>
          <option value="trial">On Trial</option>
          <option value="override">Override Active</option>
          <option value="false">Free</option>
        </select>
      </div>

      {/* Society Cards */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 shadow-card text-center">
          <Building2 className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-sm text-slate-400">No societies match your filters.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((society) => (
            <button
              key={society.id}
              type="button"
              onClick={() => navigate(`/crm/${society.id}`)}
              className="w-full bg-white rounded-2xl p-4 shadow-card hover:shadow-card-hover transition-shadow text-left"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {/* Top row: name + badges */}
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <p className="text-sm font-semibold text-on-surface truncate">{society.name}</p>
                    <span
                      className={`badge text-[10px] font-semibold ${
                        society.isActive
                          ? 'badge-success'
                          : 'bg-red-100 text-red-600'
                      }`}
                    >
                      {society.isActive ? 'Active' : 'Inactive'}
                    </span>
                    <PremiumBadge society={society} />
                    {society.crmTags.map((tag) => (
                      <span key={tag} className="badge bg-slate-100 text-slate-500 text-[10px]">
                        {tag}
                      </span>
                    ))}
                  </div>

                  {/* Location */}
                  <p className="text-xs text-slate-500 mb-2">
                    {society.city}, {society.state}
                  </p>

                  {/* Contact */}
                  {society.primaryContact ? (
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      <span className="font-medium text-on-surface">
                        {society.primaryContact.name}
                        <span className="text-slate-400 font-normal ml-1">
                          ({society.primaryContact.role.replace('_', ' ')})
                        </span>
                      </span>
                      <span className="flex items-center gap-1">
                        <Mail className="w-3 h-3" />
                        {society.primaryContact.email}
                      </span>
                      {society.primaryContact.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="w-3 h-3" />
                          {society.primaryContact.phone}
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 italic">No admin contact found</p>
                  )}
                </div>

                {/* Subscription / date info + chevron */}
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <ChevronRight className="w-4 h-4 text-slate-300" />
                  {society.latestSubscription && (
                    <span
                      className={`badge text-[10px] ${
                        society.latestSubscription.status === 'ACTIVE'
                          ? 'badge-success'
                          : society.latestSubscription.status === 'HALTED'
                            ? 'bg-red-100 text-red-600'
                            : 'badge-neutral'
                      }`}
                    >
                      {society.latestSubscription.status}
                    </span>
                  )}
                  <p className="text-[11px] text-slate-400">
                    {new Date(society.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="bg-white rounded-2xl p-5 shadow-card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-800">Campaign history</p>
            <p className="mt-1 text-xs text-slate-500">Recent publish mail runs including skipped recipients from unsubscribe preferences.</p>
          </div>
        </div>

        {campaignHistory.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-400">
            No publish mail history yet.
          </div>
        ) : (
          <div className="space-y-3">
            {campaignHistory.map((entry) => (
              <div key={entry.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{entry.subject}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {new Date(entry.createdAt).toLocaleString()} · {entry.performedBy.name} · {entry.targetMode === 'all' ? 'All users' : 'Specific emails'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    <span className="badge bg-slate-100 text-slate-600">Intended {entry.intendedRecipientCount}</span>
                    <span className="badge bg-emerald-100 text-emerald-700">Sent {entry.sentCount}</span>
                    <span className="badge bg-amber-100 text-amber-700">Skipped {entry.skippedCount}</span>
                    <span className="badge bg-red-100 text-red-600">Failed {entry.failedCount}</span>
                  </div>
                </div>
                {entry.skippedCount > 0 ? (
                  <p className="mt-3 text-xs text-slate-500">
                    {entry.skippedCount} recipient{entry.skippedCount === 1 ? '' : 's'} skipped due to unsubscribe preference.
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <CampaignMailModal isOpen={showCampaignModal} onClose={() => setShowCampaignModal(false)} />
    </div>
  );
}

function parseRecipientEmails(value: string) {
  return [...new Set(
    value
      .split(/[\n,;]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  )];
}

function CampaignMailModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [targetMode, setTargetMode] = useState<CampaignTargetMode>('all');
  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState('');
  const [recipientInput, setRecipientInput] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  const recipientEmails = useMemo(() => parseRecipientEmails(recipientInput), [recipientInput]);
  const invalidRecipientEmails = useMemo(
    () => recipientEmails.filter((email) => !isValidEmailAddress(email)),
    [recipientEmails],
  );

  const sendMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        targetMode,
        subject: subject.trim(),
        html,
        recipientEmails: targetMode === 'specific' ? recipientEmails : undefined,
      };

      const { data } = await api.post<CampaignMailResponse>('/admin/crm/campaign-mails/send', payload);
      return data;
    },
    onSuccess: (data) => {
      const resultText = data.failedCount > 0 || data.skippedCount > 0
        ? `Sent ${data.sentCount} of ${data.intendedRecipientCount} emails. ${data.skippedCount} skipped, ${data.failedCount} failed.`
        : `Sent ${data.sentCount} emails successfully.`;
      toast.success(resultText);
      setSubject('');
      setHtml('');
      setRecipientInput('');
      setTargetMode('all');
      setShowPreview(false);
      onClose();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to send campaign mail');
    },
  });

  function handleClose() {
    if (sendMutation.isPending) return;
    onClose();
  }

  function handleSend() {
    if (!subject.trim()) {
      toast.error('Subject is required.');
      return;
    }

    if (!html.trim()) {
      toast.error('HTML message is required.');
      return;
    }

    if (targetMode === 'specific') {
      if (recipientEmails.length === 0) {
        toast.error('Add at least one recipient email.');
        return;
      }

      if (invalidRecipientEmails.length > 0) {
        toast.error('Fix invalid recipient email addresses before sending.');
        return;
      }
    }

    sendMutation.mutate();
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Publish Mail" size="xl">
      <div className="space-y-5">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">Campaign delivery</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Each recipient receives a separate email. HTML is sent as entered, and every publish mail includes an unsubscribe link automatically. Unsubscribed recipients are skipped only for publish mails, not for app emails.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <div>
              <label className="label">Audience</label>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setTargetMode('all')}
                  className={targetMode === 'all' ? 'btn-primary text-sm' : 'btn-outline text-sm'}
                >
                  All active users
                </button>
                <button
                  type="button"
                  onClick={() => setTargetMode('specific')}
                  className={targetMode === 'specific' ? 'btn-primary text-sm' : 'btn-outline text-sm'}
                >
                  Specific emails
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {targetMode === 'all'
                  ? 'Sends to all active non-super-admin users across the platform, except recipients who unsubscribed from publish mails.'
                  : 'Paste one or more email addresses separated by commas or new lines. Unsubscribed recipients are skipped automatically.'}
              </p>
            </div>

            {targetMode === 'specific' ? (
              <div>
                <label className="label">Recipient Emails</label>
                <textarea
                  className="input min-h-[120px]"
                  value={recipientInput}
                  onChange={(event) => setRecipientInput(event.target.value)}
                  placeholder={'person1@example.com\nperson2@example.com'}
                />
                <p className="mt-2 text-xs text-slate-500">Unique recipients detected: {recipientEmails.length}</p>
                {invalidRecipientEmails.length > 0 ? (
                  <p className="mt-1 text-xs text-red-500">Invalid emails: {invalidRecipientEmails.join(', ')}</p>
                ) : null}
              </div>
            ) : null}

            <div>
              <label className="label">Subject</label>
              <input
                type="text"
                className="input"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="June release notes"
              />
            </div>

            <div>
              <label className="label">HTML Message</label>
              <textarea
                className="input min-h-[280px] font-mono text-[13px]"
                value={html}
                onChange={(event) => setHtml(event.target.value)}
                placeholder={'<h1>What\'s new</h1><p>Share release notes, onboarding updates, or marketing announcements.</p>'}
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
              <div>
                <p className="text-sm font-semibold text-slate-800">Preview</p>
                <p className="mt-1 text-xs text-slate-500">Render the HTML exactly before sending.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowPreview((current) => !current)}
                className="btn-outline flex items-center gap-2 text-sm"
              >
                <Eye className="w-4 h-4" />
                {showPreview ? 'Hide Preview' : 'Show Preview'}
              </button>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="border-b border-slate-100 pb-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Subject</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">{subject.trim() || 'Email subject preview'}</p>
              </div>

              {showPreview ? (
                <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                  <iframe
                    title="Campaign mail preview"
                    sandbox=""
                    srcDoc={html || '<div style="padding:24px;font-family:Arial,sans-serif;color:#64748b;">Your HTML preview will render here.</div>'}
                    className="h-[420px] w-full bg-white"
                  />
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-400">
                  Enable preview to inspect the rendered HTML before sending.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            {targetMode === 'all'
              ? 'Eligible active users will receive separate emails with a default unsubscribe link.'
              : `${recipientEmails.length} unique recipient${recipientEmails.length === 1 ? '' : 's'} selected before unsubscribe filtering.`}
          </p>
          <div className="flex items-center gap-2 self-end">
            <button type="button" onClick={handleClose} className="btn-outline text-sm" disabled={sendMutation.isPending}>
              Cancel
            </button>
            <button type="button" onClick={handleSend} className="btn-primary flex items-center gap-2 text-sm" disabled={sendMutation.isPending}>
              <Send className="w-4 h-4" />
              {sendMutation.isPending ? 'Sending...' : 'Send Mail'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
