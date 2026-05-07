import { useState } from 'react';
import { ExternalLink, Globe } from 'lucide-react';
import type { RestrictionMessage } from '../../lib/appRestrictions';
import { openRestrictionWebUrl } from '../../lib/appRestrictions';
import Modal from '../ui/Modal';

function RestrictionBody({ restriction, onClose }: { restriction: RestrictionMessage; onClose?: () => void }) {
  const [isOpening, setIsOpening] = useState(false);

  const handleOpen = async () => {
    setIsOpening(true);
    try {
      await openRestrictionWebUrl(restriction.webUrl);
      onClose?.();
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-primary/10 bg-primary/[0.04] px-4 py-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Globe className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-on-surface">{restriction.title}</p>
            <p className="mt-1 text-sm text-on-surface-variant">{restriction.description}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">
        Continue setup in the web app, then return to the iOS app for day-to-day use.
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onClose ? (
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        ) : null}
        <button type="button" className="btn-primary" onClick={handleOpen} disabled={isOpening}>
          <ExternalLink className="h-4 w-4" />
          {isOpening ? 'Opening...' : restriction.actionLabel}
        </button>
      </div>
    </div>
  );
}

export function WebOnlyRestrictionDialog({
  restriction,
  isOpen,
  onClose,
}: {
  restriction: RestrictionMessage;
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={restriction.title} size="md">
      <RestrictionBody restriction={restriction} onClose={onClose} />
    </Modal>
  );
}

export function WebOnlyRestrictionPage({
  restriction,
  fullScreen = false,
}: {
  restriction: RestrictionMessage;
  fullScreen?: boolean;
}) {
  const containerClassName = fullScreen
    ? 'min-h-screen bg-white px-6 py-10 sm:px-8 flex items-center justify-center'
    : 'mx-auto max-w-2xl py-4';

  return (
    <div className={containerClassName}>
      <div className="w-full rounded-3xl border border-slate-200 bg-white p-6 shadow-card sm:p-8">
        <RestrictionBody restriction={restriction} />
      </div>
    </div>
  );
}
