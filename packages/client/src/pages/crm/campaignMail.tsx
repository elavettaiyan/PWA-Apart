import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../../components/ui/Modal';
import api from '../../lib/api';
import { isValidEmailAddress } from '../../lib/utils';

export type CampaignTargetMode = 'all' | 'specific';

export type CampaignMailResponse = {
  id: string;
  intendedRecipientCount: number;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  failedRecipients: string[];
  skippedCount: number;
  targetMode: CampaignTargetMode;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED';
};

export type CampaignHistoryEntry = {
  id: string;
  targetMode: CampaignTargetMode;
  subject: string;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED';
  intendedRecipientCount: number;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  skippedReason: string | null;
  failedRecipients: string[];
  resolvedRecipients: string[];
  lastErrorMessage: string | null;
  processingStartedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  performedBy: {
    id: string;
    name: string;
    email: string;
  };
};

export function parseRecipientEmails(value: string) {
  return [...new Set(
    value
      .split(/[\n,;]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  )];
}

export function getCampaignStatusTone(status: CampaignHistoryEntry['status']) {
  switch (status) {
    case 'QUEUED':
      return 'bg-slate-100 text-slate-700';
    case 'PROCESSING':
      return 'bg-blue-100 text-blue-700';
    case 'COMPLETED':
      return 'bg-emerald-100 text-emerald-700';
    case 'COMPLETED_WITH_ERRORS':
      return 'bg-amber-100 text-amber-700';
    case 'FAILED':
      return 'bg-red-100 text-red-600';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

export function getCampaignStatusLabel(status: CampaignHistoryEntry['status']) {
  switch (status) {
    case 'QUEUED':
      return 'Queued';
    case 'PROCESSING':
      return 'Sending';
    case 'COMPLETED':
      return 'Completed';
    case 'COMPLETED_WITH_ERRORS':
      return 'Completed with errors';
    case 'FAILED':
      return 'Failed';
    default:
      return status;
  }
}

export function CampaignMailModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
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
      queryClient.invalidateQueries({ queryKey: ['crm-campaign-history'] });
      toast.success(`Campaign queued for ${data.recipientCount} eligible recipient${data.recipientCount === 1 ? '' : 's'}. Sending continues in the background.`);
      setSubject('');
      setHtml('');
      setRecipientInput('');
      setTargetMode('all');
      setShowPreview(false);
      onClose();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to queue campaign mail');
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
            Each recipient receives a separate email. Campaigns are queued and delivered in the background at a controlled rate, so this screen does not block while sending continues.
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
                  ? 'Queues all active non-super-admin users who have not unsubscribed from publish mails.'
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
                <p className="mt-1 text-xs text-slate-500">Render the HTML exactly before queueing.</p>
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
              ? 'Eligible active users will be queued and each will receive a separate email with a default unsubscribe link.'
              : `${recipientEmails.length} unique recipient${recipientEmails.length === 1 ? '' : 's'} selected before unsubscribe filtering.`}
          </p>
          <div className="flex items-center gap-2 self-end">
            <button type="button" onClick={handleClose} className="btn-outline text-sm" disabled={sendMutation.isPending}>
              Cancel
            </button>
            <button type="button" onClick={handleSend} className="btn-primary flex items-center gap-2 text-sm" disabled={sendMutation.isPending}>
              <Send className="w-4 h-4" />
              {sendMutation.isPending ? 'Queueing...' : 'Queue Mail'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
