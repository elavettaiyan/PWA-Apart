import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { usePremiumStatus } from '@/hooks/flatsHooks';

interface UpgradePromptProps {
  onClose: () => void;
  onSubscribeRequest: (flatCount: number) => void;
  isSubscribePending: boolean;
  isVerifyPending: boolean;
}

export function UpgradePrompt({
  onClose,
  onSubscribeRequest,
  isSubscribePending,
  isVerifyPending,
}: UpgradePromptProps) {
  const queryClient = useQueryClient();
  const [requestedFlatCount, setRequestedFlatCount] = useState('6');
  const [isUpgradePending, setIsUpgradePending] = useState(false);

  const { data: premiumStatus, isLoading } = usePremiumStatus();

  useEffect(() => {
    if (premiumStatus) {
      setRequestedFlatCount(String(premiumStatus.limit.minimumRequiredFlatCount));
    }
  }, [premiumStatus]);

  const handleUpgrade = async (flatCount: number) => {
    setIsUpgradePending(true);
    try {
      await api.post('/premium/upgrade', { requestedFlatCount: flatCount });
      toast.success('Flat capacity updated. The new monthly amount will apply from the next renewal.');
      queryClient.invalidateQueries({ queryKey: ['premium-status'] });
      queryClient.invalidateQueries({ queryKey: ['flats'] });
      queryClient.invalidateQueries({ queryKey: ['blocks'] });
      onClose();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to update Premium flat capacity');
    } finally {
      setIsUpgradePending(false);
    }
  };

  if (isLoading || !premiumStatus) {
    return <div className="py-8 text-sm text-on-surface-variant">Loading Premium plan details...</div>;
  }

  const activeSubscription = premiumStatus.activeSubscription;
  const minimumRequiredFlatCount = premiumStatus.limit.minimumRequiredFlatCount;
  const parsedRequestedFlatCount = parseInt(requestedFlatCount, 10);
  const effectiveRequestedFlatCount = Math.max(
    Number.isFinite(parsedRequestedFlatCount) ? parsedRequestedFlatCount : minimumRequiredFlatCount,
    minimumRequiredFlatCount,
  );
  const previewAmount = effectiveRequestedFlatCount * premiumStatus.pricing.amountPerFlat;
  const isCapacityUpgrade = premiumStatus.isPremium;
  const isLimitReached = premiumStatus.limit.reached;
  const nextRenewalAmount = premiumStatus.scheduledAmountPaise
    ? premiumStatus.scheduledAmountPaise / 100
    : previewAmount;

  return (
    <div className="space-y-4 pb-2 sm:pb-4">
      {/* ── 1. Flat count input – top ── */}
      <div className="rounded-2xl border border-primary/15 bg-primary/[0.04] px-4 py-4">
        <label className="text-xs font-bold uppercase tracking-widest text-primary">
          {isCapacityUpgrade ? 'Increase flat capacity to' : 'Subscribe for flat capacity'}
        </label>
        <input
          type="number"
          min={minimumRequiredFlatCount}
          className="input mt-2"
          value={requestedFlatCount}
          onChange={(event) => setRequestedFlatCount(event.target.value)}
        />
        <p className="mt-2 text-xs text-on-surface-variant">
          Minimum: {minimumRequiredFlatCount} flats
          {' · '}
          {isCapacityUpgrade
            ? `Current cycle billed at ${activeSubscription?.lockedFlatCount || premiumStatus.includedFlatCount} flats — renewal moves to ₹${nextRenewalAmount}/month.`
            : 'This becomes your starting Premium capacity and monthly billing amount.'}
        </p>
      </div>

      {/* ── 2. Status / context message ── */}
      <div className={`rounded-xl border px-4 py-3 text-sm ${
        premiumStatus.isPremium
          ? 'border-violet-100 bg-violet-50 text-violet-800'
          : premiumStatus.trial?.isOnTrial
            ? 'border-amber-100 bg-amber-50 text-amber-800'
            : 'border-warning/20 bg-warning-container text-on-warning-container'
      }`}>
        <p className="font-semibold">
          {premiumStatus.isPremium
            ? isLimitReached
              ? 'Purchased Premium capacity reached'
              : 'Premium is active'
            : premiumStatus.trial?.isOnTrial
              ? isLimitReached
                ? 'Trial flat limit reached'
                : 'Upgrade before your trial ends'
              : 'Free trial has ended'}
        </p>
        <p className="mt-1">
          {premiumStatus.isPremium
            ? isLimitReached
              ? 'Your society has used all purchased flat capacity. Increase the count now — new flats unlock immediately and the higher amount kicks in at the next renewal.'
              : 'You can increase your purchased flat count any time before hitting the current capacity.'
            : premiumStatus.trial?.isOnTrial
              ? isLimitReached
                ? 'Your 1-month free trial has a flat limit. Subscribe to Premium to go beyond it and keep full access once the trial ends.'
                : 'Your free trial ends soon. Subscribe to Premium now to continue without any interruption when the trial period is over.'
              : 'Your free trial has ended. Subscribe to Premium to continue adding flats.'}
        </p>
      </div>

      {/* ── 3. Key numbers ── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-surface-container-low p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Rate</p>
          <p className="mt-1 text-lg font-bold text-on-surface">₹{premiumStatus.pricing.amountPerFlat}<span className="text-xs font-normal">/flat/month</span></p>
        </div>
        <div className="rounded-xl bg-surface-container-low p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Flat capacity</p>
          <p className="mt-1 text-lg font-bold text-on-surface">{effectiveRequestedFlatCount}<span className="text-xs font-normal"> flats</span></p>
        </div>
        <div className="rounded-xl bg-surface-container-low p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Monthly total</p>
          <p className="mt-1 text-lg font-bold text-on-surface">₹{previewAmount}</p>
        </div>
      </div>

      {/* ── 5. What you unlock ── */}
      {!isCapacityUpgrade && (
        <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">What you unlock</p>
          <ul className="mt-2 space-y-1 text-sm text-on-surface-variant list-disc list-inside">
            <li>Flat creation up to the capacity you choose</li>
            <li>Bulk imports for large societies</li>
            <li>All billing, complaints, reports, and resident tools — uninterrupted</li>
          </ul>
        </div>
      )}

      {/* ── 6. Actions ── */}
      <div className="flex flex-col-reverse gap-3 pt-1 pb-1 sm:flex-row sm:justify-end">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary text-center"
          onClick={() => {
            if (isCapacityUpgrade) {
              handleUpgrade(effectiveRequestedFlatCount);
              return;
            }
            onSubscribeRequest(effectiveRequestedFlatCount);
          }}
          disabled={
            isSubscribePending ||
            isUpgradePending ||
            isVerifyPending ||
            effectiveRequestedFlatCount < minimumRequiredFlatCount
          }
        >
          {isVerifyPending
            ? 'Verifying...'
            : isUpgradePending
              ? 'Scheduling renewal update...'
            : isSubscribePending
              ? 'Starting checkout...'
              : isCapacityUpgrade
                ? 'Increase flat capacity'
                : 'Subscribe — Pay with Razorpay'}
        </button>
      </div>
    </div>
  );
}
