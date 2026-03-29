import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Building2, User, Phone, Layers, Trash2, Upload, Download, FileSpreadsheet } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { openRazorpaySubscriptionCheckout } from '../../lib/razorpay';
import { useAuthStore } from '../../store/authStore';
import { getFlatTypeLabel, cn, isValidEmailAddress, isValidIndianMobileNumber, normalizeEmail, normalizeIndianMobileNumber } from '../../lib/utils';
import { PageLoader, EmptyState } from '../../components/ui/Loader';
import Modal from '../../components/ui/Modal';
import type { Flat, Block, PremiumStatusResponse } from '../../types';

export default function FlatsPage() {
  const [showAddFlat, setShowAddFlat] = useState(false);
  const [showAddBlock, setShowAddBlock] = useState(false);
  const [showAddOwner, setShowAddOwner] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [activeFlat, setActiveFlat] = useState<Flat | null>(null);
  const [selectedFlatId, setSelectedFlatId] = useState<string | null>(null);
  const [showDeleteFlat, setShowDeleteFlat] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'SUPER_ADMIN' || (['ADMIN', 'SECRETARY', 'JOINT_SECRETARY'] as string[]).includes(user?.role || '');

  const { data: flats = [], isLoading } = useQuery<Flat[]>({
    queryKey: ['flats'],
    queryFn: async () => (await api.get('/flats/flats')).data,
  });

  const { data: blocks = [] } = useQuery<Block[]>({
    queryKey: ['blocks'],
    queryFn: async () => (await api.get('/flats/blocks')).data,
  });

  const selectedFlat = useMemo(
    () => flats.find((flat) => flat.id === selectedFlatId) ?? null,
    [flats, selectedFlatId],
  );

  useEffect(() => {
    if (!activeFlat) return;

    const refreshedActiveFlat = flats.find((flat) => flat.id === activeFlat.id) ?? null;
    if (!refreshedActiveFlat) {
      setActiveFlat(null);
      setShowAddOwner(false);
      return;
    }

    if (refreshedActiveFlat !== activeFlat) {
      setActiveFlat(refreshedActiveFlat);
    }
  }, [activeFlat, flats]);

  const deleteMutation = useMutation({
    mutationFn: ({ id, confirmation }: { id: string; confirmation: string }) =>
      api.delete(`/flats/flats/${id}`, { data: { confirmation } }),
    onSuccess: () => {
      toast.success('Flat deleted');
      setShowDeleteFlat(false);
      setSelectedFlatId(null);
      queryClient.invalidateQueries({ queryKey: ['flats'] });
      queryClient.invalidateQueries({ queryKey: ['blocks'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to delete flat');
    },
  });

  const filtered = flats.filter(
    (f) =>
      f.flatNumber.toLowerCase().includes(search.toLowerCase()) ||
      f.owner?.name?.toLowerCase().includes(search.toLowerCase()) ||
      f.tenant?.name?.toLowerCase().includes(search.toLowerCase()),
  );

  if (isLoading) return <PageLoader />;

  return (
    <div>
      <div className="page-header">
        <div>
          <p className="section-label mb-2">Residents</p>
          <h1 className="page-title">Flats & Residents</h1>
          <p className="text-sm text-on-surface-variant mt-1">Manage all flats, owners, and tenants</p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => setShowDeleteFlat(true)}
              disabled={!selectedFlat}
            >
              <Trash2 className="w-4 h-4" /> Delete Selected
            </button>
            <button className="btn-secondary text-xs sm:text-sm" onClick={() => setShowBulkUpload(true)}>
              <Upload className="w-4 h-4" /> Bulk Upload
            </button>
            <button className="btn-secondary text-xs sm:text-sm" onClick={() => setShowAddBlock(true)}>
              <Layers className="w-4 h-4" /> Add Block
            </button>
            <button className="btn-primary text-xs sm:text-sm" onClick={() => setShowAddFlat(true)}>
              <Plus className="w-4 h-4" /> Add Flat
            </button>
          </div>
        )}
      </div>

      {/* Blocks Summary */}
      {blocks.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 mb-6">
          {blocks.map((block) => (
            <div key={block.id} className="card p-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
                <Layers className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-on-surface truncate">{block.name}</p>
                <p className="text-xs text-on-surface-variant">{block.floors} floors · {block._count?.flats ?? 0} flats</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-outline" />
        <input
          type="text"
          className="input pl-10"
          placeholder="Search by flat number, owner, or tenant..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="mb-6 rounded-2xl border border-warning/20 bg-warning-container px-4 py-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-on-warning-container">Admin delete control</p>
            <p className="text-xs text-on-warning-container mt-1">
              Select one apartment, then confirm its flat number to delete it. Deletion is blocked if the flat still has an owner, tenant, bills, or complaints.
            </p>
          </div>
          <div className="rounded-xl bg-white/80 px-3 py-2 text-sm text-on-surface-variant border border-warning/10 min-w-[220px]">
            {selectedFlat ? (
              <>
                <p className="font-semibold text-on-surface">{selectedFlat.flatNumber}</p>
                <p className="text-xs text-on-surface-variant">{selectedFlat.block?.name} · Floor {selectedFlat.floor}</p>
              </>
            ) : (
              <p className="text-xs text-on-surface-variant">No apartment selected</p>
            )}
          </div>
        </div>
      </div>

      {/* Flat Cards Grid */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No flats found"
          description="Add your first flat to get started"
          action={<button className="btn-primary" onClick={() => setShowAddFlat(true)}>Add Flat</button>}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((flat) => (
            <div
              key={flat.id}
              className={cn(
                'card p-4 hover:shadow-md transition-shadow cursor-pointer border-2',
                selectedFlatId === flat.id ? 'border-primary ring-2 ring-primary/10' : 'border-transparent',
              )}
              onClick={() => setSelectedFlatId(flat.id)}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {/* <div className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold',
                    flat.isOccupied ? 'bg-emerald-50 text-emerald-900' : 'bg-slate-100 text-slate-500',
                  )}>
                    {flat.flatNumber}
                  </div> */}
                  <div>
                    <p className="text-sm font-semibold text-on-surface">{flat.flatNumber}</p>
                    <p className="text-xs text-on-surface-variant">{flat.block?.name} · Floor {flat.floor}</p>
                  </div>
                </div>
                <span className={cn('badge', flat.isOccupied ? 'badge-success' : 'badge-neutral')}>
                  {flat.isOccupied ? 'Occupied' : 'Vacant'}
                </span>
              </div>

              <div className="space-y-2 text-xs text-on-surface-variant">
                <div className="flex justify-between">
                  <span>Type</span>
                  <span className="font-medium text-on-surface-variant">{getFlatTypeLabel(flat.type)}</span>
                </div>
                {flat.areaSqFt && (
                  <div className="flex justify-between">
                    <span>Area</span>
                    <span className="font-medium text-on-surface-variant">{flat.areaSqFt} sq.ft</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Status</span>
                  <span className="font-medium text-on-surface-variant">{flat.isOccupied ? 'Occupied' : 'Vacant'}</span>
                </div>
              </div>

              {flat.owner && (
                <div className="mt-3 pt-3 border-t border-outline-variant/10">
                  <div className="flex items-center gap-2">
                    <User className="w-3.5 h-3.5 text-outline" />
                    <span className="text-xs font-medium text-on-surface-variant">{flat.owner.name}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Phone className="w-3 h-3 text-outline" />
                    <span className="text-xs text-on-surface-variant">{flat.owner.phone}</span>
                  </div>
                </div>
              )}

              {flat.tenant && flat.tenant.isActive && (
                <div className="mt-2 pt-2 border-t border-dashed border-outline-variant/10">
                  <p className="text-[10px] text-outline uppercase tracking-wider mb-1">Tenant</p>
                  <div className="flex items-center gap-2">
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-xs font-medium text-slate-700">{flat.tenant.name}</span>
                  </div>
                </div>
              )}

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  className="btn-secondary flex-1"
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedFlatId(flat.id);
                  }}
                >
                  {selectedFlatId === flat.id ? 'Selected' : 'Select'}
                </button>
                <button
                  type="button"
                  className="btn-primary flex-1"
                  onClick={(event) => {
                    event.stopPropagation();
                    setActiveFlat(flat);
                    setShowAddOwner(true);
                  }}
                >
                  Manage
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Block Modal */}
      <Modal isOpen={showAddBlock} onClose={() => setShowAddBlock(false)} title="Add New Block / Wing" size="md">
        <AddBlockForm onSuccess={() => { setShowAddBlock(false); queryClient.invalidateQueries({ queryKey: ['blocks'] }); }} />
      </Modal>

      {/* Add Flat Modal */}
      <Modal isOpen={showAddFlat} onClose={() => setShowAddFlat(false)} title="Add New Flat" size="md">
        <AddFlatForm 
          blocks={blocks} 
          onSuccess={() => { setShowAddFlat(false); queryClient.invalidateQueries({ queryKey: ['flats'] }); }} 
          onLimitReached={() => { setShowAddFlat(false); setShowUpgradeModal(true); }}
        />
      </Modal>

      {/* Add Owner Modal */}
      <Modal isOpen={showAddOwner} onClose={() => setShowAddOwner(false)} title={`Manage Flat - ${activeFlat?.flatNumber}`} size="lg">
        {activeFlat && (
          <ManageFlatForm
            flat={activeFlat}
            onSaved={() => {
              queryClient.invalidateQueries({ queryKey: ['flats'] });
            }}
          />
        )}
      </Modal>

      {/* Delete Flat Modal */}
      <Modal isOpen={showDeleteFlat} onClose={() => setShowDeleteFlat(false)} title="Delete Apartment" size="md">
        {selectedFlat ? (
          <DeleteFlatForm
            flat={selectedFlat}
            isPending={deleteMutation.isPending}
            onConfirm={(confirmation) => deleteMutation.mutate({ id: selectedFlat.id, confirmation })}
          />
        ) : (
          <div className="py-4">
            <p className="text-sm text-on-surface-variant">Select an apartment first.</p>
          </div>
        )}
      </Modal>

      {/* Bulk Upload Modal */}
      <Modal isOpen={showBulkUpload} onClose={() => setShowBulkUpload(false)} title="Bulk Upload Flats from Excel" size="lg">
        <BulkUploadForm
          onSuccess={() => { setShowBulkUpload(false); queryClient.invalidateQueries({ queryKey: ['flats'] }); queryClient.invalidateQueries({ queryKey: ['blocks'] }); }}
          onLimitReached={() => { setShowBulkUpload(false); setShowUpgradeModal(true); }}
        />
      </Modal>

      {/* Upgrade Modal */}
      <Modal isOpen={showUpgradeModal} onClose={() => setShowUpgradeModal(false)} title="Upgrade to Premium" size="lg">
        <UpgradePrompt onClose={() => setShowUpgradeModal(false)} />
      </Modal>
    </div>
  );
}

function UpgradePrompt({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [requestedFlatCount, setRequestedFlatCount] = useState('6');

  const { data: premiumStatus, isLoading } = useQuery<PremiumStatusResponse>({
    queryKey: ['premium-status'],
    queryFn: async () => (await api.get('/premium/status')).data,
  });

  useEffect(() => {
    if (premiumStatus) {
      setRequestedFlatCount(String(premiumStatus.limit.minimumRequiredFlatCount));
    }
  }, [premiumStatus]);

  const verifyMutation = useMutation({
    mutationFn: (payload: { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }) =>
      api.post('/premium/verify', payload),
    onSuccess: () => {
      toast.success('Premium activated successfully');
      queryClient.invalidateQueries({ queryKey: ['premium-status'] });
      queryClient.invalidateQueries({ queryKey: ['flats'] });
      queryClient.invalidateQueries({ queryKey: ['blocks'] });
      onClose();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to verify Premium activation');
    },
  });

  const subscribeMutation = useMutation({
    mutationFn: async (flatCount: number) => (await api.post('/premium/subscribe', { requestedFlatCount: flatCount })).data,
    onSuccess: async (payload) => {
      try {
        await openRazorpaySubscriptionCheckout({
          key: payload.keyId,
          subscriptionId: payload.subscriptionId,
          name: 'Dwell Hub Premium',
          description: `Premium plan locked at ${payload.lockedFlatCount} flats`,
          prefill: {
            name: user?.name,
            email: user?.email,
            contact: user?.phone,
          },
          notes: {
            lockedFlatCount: String(payload.lockedFlatCount),
          },
          onSuccess: (response) => verifyMutation.mutate(response),
          onDismiss: () => {
            toast('Premium checkout was closed before completion.');
          },
        });
      } catch (error: any) {
        toast.error(error.message || 'Failed to open Razorpay checkout');
      }
    },
    onError: (error: any) => {
      if (error.response?.data?.code === 'PREMIUM_ALREADY_ACTIVE') {
        queryClient.invalidateQueries({ queryKey: ['premium-status'] });
        toast.success('Premium is already active for this society');
        onClose();
        return;
      }

      toast.error(error.response?.data?.error || 'Failed to start Premium checkout');
    },
  });

  const upgradeMutation = useMutation({
    mutationFn: async (flatCount: number) => (await api.post('/premium/upgrade', { requestedFlatCount: flatCount })).data,
    onSuccess: () => {
      toast.success('Flat capacity updated. The new monthly amount will apply from the next renewal.');
      queryClient.invalidateQueries({ queryKey: ['premium-status'] });
      queryClient.invalidateQueries({ queryKey: ['flats'] });
      queryClient.invalidateQueries({ queryKey: ['blocks'] });
      onClose();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to update Premium flat capacity');
    },
  });

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
    <div className="space-y-5 pb-2 sm:pb-4">
      <div className="rounded-2xl bg-primary/[0.04] border border-primary/10 p-4">
        <p className="text-sm font-semibold text-primary">
          {premiumStatus.isPremium
            ? isLimitReached
              ? 'Purchased Premium capacity reached'
              : 'Premium is active'
            : 'Free tier limit reached'}
        </p>
        <p className="mt-1 text-sm text-on-surface-variant">
          {premiumStatus.isPremium
            ? isLimitReached
              ? 'Your society has used all currently purchased flat capacity. Increase the flat count now to unlock more flats immediately and move the higher recurring amount to the next renewal.'
              : 'Your society already has Premium access. You can increase the purchased flat count any time before you hit the current capacity.'
            : 'Your society can use up to 5 flats for free. Choose how many flats you want to cover before starting Premium.'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-surface-container-low p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Current flats</p>
          <p className="mt-1 text-sm font-semibold text-on-surface">{premiumStatus.currentFlatCount}</p>
        </div>
        <div className="rounded-xl bg-surface-container-low p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Included now</p>
          <p className="mt-1 text-sm font-semibold text-on-surface">{premiumStatus.includedFlatCount} flats</p>
        </div>
        <div className="rounded-xl bg-surface-container-low p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Pricing</p>
          <p className="mt-1 text-sm font-semibold text-on-surface">₹20 per flat / month</p>
        </div>
      </div>

      <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-on-surface-variant">Billing preview</p>
            <p className="mt-1 text-base font-semibold text-on-surface">
              {effectiveRequestedFlatCount} flats x ₹{premiumStatus.pricing.amountPerFlat} = ₹{previewAmount}/month
            </p>
          </div>
          {activeSubscription?.currentPeriodEnd && (
            <div className="text-right text-xs text-on-surface-variant">
              <p>Current cycle ends</p>
              <p className="font-medium text-on-surface">{new Date(activeSubscription.currentPeriodEnd).toLocaleDateString()}</p>
            </div>
          )}
        </div>
        <p className="mt-3 text-sm text-on-surface-variant">{premiumStatus.preview.message}</p>
        {premiumStatus.scheduledFlatCount && premiumStatus.scheduledChangeAt && (
          <p className="mt-2 text-xs text-primary">
            Next renewal is already scheduled for {premiumStatus.scheduledFlatCount} flats on {new Date(premiumStatus.scheduledChangeAt).toLocaleDateString()}.
          </p>
        )}
      </div>

      <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low px-4 py-3">
        <label className="label">Required flat count</label>
        <input
          type="number"
          min={minimumRequiredFlatCount}
          className="input mt-1"
          value={requestedFlatCount}
          onChange={(event) => setRequestedFlatCount(event.target.value)}
        />
        <p className="mt-2 text-xs text-on-surface-variant">
          Minimum required now: {minimumRequiredFlatCount} flats.
          {isCapacityUpgrade
            ? ` Your current cycle stays billed at ${activeSubscription?.lockedFlatCount || premiumStatus.includedFlatCount} flats, and the renewal will move to ₹${nextRenewalAmount}/month.`
            : ' This becomes your starting Premium capacity and monthly subscription amount.'}
        </p>
      </div>

      <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low px-4 py-3">
        <p className="text-xs uppercase tracking-widest text-on-surface-variant">What you unlock</p>
        <ul className="mt-2 space-y-1 text-sm text-on-surface-variant">
          <li>Flat creation up to the purchased capacity you choose</li>
          <li>Bulk imports for large societies</li>
          <li>All existing billing, complaints, reports, and resident tools</li>
        </ul>
      </div>

      <div className="flex flex-col-reverse gap-3 pt-2 pb-1 sm:flex-row sm:justify-end">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Close
        </button>
        <button
          type="button"
          className="btn-primary text-center"
          onClick={() => {
            if (isCapacityUpgrade) {
              upgradeMutation.mutate(effectiveRequestedFlatCount);
              return;
            }
            subscribeMutation.mutate(effectiveRequestedFlatCount);
          }}
          disabled={
            subscribeMutation.isPending ||
            upgradeMutation.isPending ||
            verifyMutation.isPending ||
            effectiveRequestedFlatCount < minimumRequiredFlatCount
          }
        >
          {verifyMutation.isPending
            ? 'Verifying...'
            : upgradeMutation.isPending
              ? 'Scheduling renewal update...'
            : subscribeMutation.isPending
              ? 'Starting checkout...'
              : isCapacityUpgrade
                ? 'Increase flat capacity'
                : 'Pay with Razorpay'}
        </button>
      </div>
    </div>
  );
}

function DeleteFlatForm({
  flat,
  isPending,
  onConfirm,
}: {
  flat: Flat;
  isPending: boolean;
  onConfirm: (confirmation: string) => void;
}) {
  const [confirmation, setConfirmation] = useState('');

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onConfirm(confirmation.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-xl border border-error/10 bg-error-container px-4 py-3">
        <p className="text-sm font-semibold text-on-error-container">Delete {flat.flatNumber}</p>
        <p className="mt-1 text-xs text-error">
          This action is restricted to vacant flats with no linked owner, tenant, billing, or complaint history.
        </p>
      </div>

      <div className="rounded-xl bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">
        <p className="font-medium text-on-surface">{flat.block?.name} · Floor {flat.floor}</p>
        <p className="mt-1">Type the flat number exactly to confirm deletion.</p>
      </div>

      <div>
        <label className="label">Confirmation</label>
        <input
          className="input"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder={`Type ${flat.flatNumber}`}
          autoFocus
        />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="submit"
          className="btn-primary bg-error hover:bg-error/90 focus:ring-error disabled:opacity-50"
          disabled={isPending || confirmation.trim() !== flat.flatNumber}
        >
          {isPending ? 'Deleting...' : 'Delete Apartment'}
        </button>
      </div>
    </form>
  );
}

// ── Add Block Form ──────────────────────────────────────
function AddBlockForm({ onSuccess }: { onSuccess: () => void }) {
  const user = useAuthStore((s) => s.user);
  const [form, setForm] = useState({ name: '', floors: '1' });

  const { data: societies = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['societies'],
    queryFn: async () => (await api.get('/flats/societies')).data,
  });

  const [societyId, setSocietyId] = useState('');

  // Set default societyId from user or first society
  useState(() => {
    if (user?.societyId) setSocietyId(user.societyId);
  });

  const effectiveSocietyId = societyId || user?.societyId || societies[0]?.id || '';

  const mutation = useMutation({
    mutationFn: (data: any) => api.post('/flats/blocks', data),
    onSuccess: () => { toast.success('Block created successfully!'); onSuccess(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to create block'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveSocietyId) {
      toast.error('No society found. Please contact admin.');
      return;
    }
    mutation.mutate({ ...form, floors: Number(form.floors), societyId: effectiveSocietyId });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {user?.role === 'SUPER_ADMIN' && societies.length > 1 && (
        <div>
          <label className="label">Society</label>
          <select className="select" value={effectiveSocietyId} onChange={(e) => setSocietyId(e.target.value)} required>
            {societies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Block / Wing Name *</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            placeholder="e.g. A Wing, Tower 1, Block C"
          />
        </div>
        <div>
          <label className="label">Number of Floors *</label>
          <input
            type="number"
            className="input"
            value={form.floors}
            onChange={(e) => setForm({ ...form, floors: e.target.value })}
            min={1}
            required
          />
        </div>
      </div>
      <div className="flex justify-end gap-3 pt-4">
        <button type="submit" className="btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Creating...' : 'Create Block'}
        </button>
      </div>
    </form>
  );
}

// ── Add Flat Form ───────────────────────────────────────
function AddFlatForm({ blocks, onSuccess, onLimitReached }: { blocks: Block[]; onSuccess: () => void; onLimitReached: () => void }) {
  const [form, setForm] = useState({ flatNumber: '', floor: '1', type: 'TWO_BHK', areaSqFt: '', blockId: blocks[0]?.id || '' });

  useEffect(() => {
    // Blocks are loaded asynchronously; ensure blockId is set once data arrives.
    if (!form.blockId && blocks.length > 0) {
      setForm((prev) => ({ ...prev, blockId: blocks[0].id }));
    }
  }, [blocks, form.blockId]);

  const mutation = useMutation({
    mutationFn: (data: any) => api.post('/flats/flats', data),
    onSuccess: () => { toast.success('Flat added!'); onSuccess(); },
    onError: (e: any) => {
      if (e.response?.data?.code === 'FREE_TIER_LIMIT_REACHED' || e.response?.data?.code === 'PREMIUM_FLAT_CAPACITY_REACHED') {
        onLimitReached();
      } else {
        toast.error(e.response?.data?.error || 'Failed');
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.blockId) {
      toast.error('Please create/select a block before adding a flat.');
      return;
    }
    mutation.mutate({ ...form, floor: Number(form.floor), areaSqFt: form.areaSqFt ? Number(form.areaSqFt) : undefined });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Block/Wing</label>
          <select className="select" value={form.blockId} onChange={(e) => setForm({ ...form, blockId: e.target.value })} required disabled={blocks.length === 0}>
            {blocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          {blocks.length === 0 && <p className="text-xs text-error mt-1">No blocks found. Add a block first.</p>}
        </div>
        <div>
          <label className="label">Flat Number</label>
          <input className="input" value={form.flatNumber} onChange={(e) => setForm({ ...form, flatNumber: e.target.value })} required placeholder="e.g. A-101" />
        </div>
        <div>
          <label className="label">Floor</label>
          <input type="number" className="input" value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} min={0} required />
        </div>
        <div>
          <label className="label">Type</label>
          <select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="ONE_BHK">1 BHK</option>
            <option value="TWO_BHK">2 BHK</option>
            <option value="THREE_BHK">3 BHK</option>
            <option value="FOUR_BHK">4 BHK</option>
            <option value="STUDIO">Studio</option>
            <option value="PENTHOUSE">Penthouse</option>
            <option value="SHOP">Shop</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
        <div>
          <label className="label">Area (sq.ft)</label>
          <input type="number" className="input" value={form.areaSqFt} onChange={(e) => setForm({ ...form, areaSqFt: e.target.value })} placeholder="Optional" />
        </div>
      </div>
      <div className="flex justify-end gap-3 pt-4">
        <button type="submit" className="btn-primary" disabled={mutation.isPending || blocks.length === 0}>
          {mutation.isPending ? 'Adding...' : 'Add Flat'}
        </button>
      </div>
    </form>
  );
}

function validateResidentContactDetails({ phone, email }: { phone: string; email?: string }) {
  const trimmedPhone = normalizeIndianMobileNumber(phone);
  const trimmedEmail = email?.trim() || '';

  if (!isValidIndianMobileNumber(trimmedPhone)) {
    toast.error('Phone number must be a valid 10-digit Indian mobile number.');
    return null;
  }

  if (trimmedEmail && !isValidEmailAddress(trimmedEmail)) {
    toast.error('Enter a valid email address.');
    return null;
  }

  return {
    phone: trimmedPhone,
    email: trimmedEmail ? normalizeEmail(trimmedEmail) : '',
  };
}

function getApiErrorMessage(error: any, fallback: string): string {
  return error?.response?.data?.error || error?.response?.data?.errors?.[0]?.msg || fallback;
}

// ── Manage Flat Form ────────────────────────────────────
function ManageFlatForm({ flat, onSaved }: { flat: Flat; onSaved: () => void }) {
  const user = useAuthStore((state) => state.user);
  const isAdminManager = user?.role === 'SUPER_ADMIN' || (['ADMIN', 'SECRETARY', 'JOINT_SECRETARY'] as string[]).includes(user?.role || '');
  const activeTenant = flat.tenant?.isActive ? flat.tenant : null;
  const [form, setForm] = useState({
    name: flat.owner?.name || '',
    phone: flat.owner?.phone || '',
    email: flat.owner?.email || '',
    aadharNo: flat.owner?.aadharNo || '',
    panNo: flat.owner?.panNo || '',
  });
  const [tenantForm, setTenantForm] = useState({
    name: activeTenant?.name || '',
    phone: activeTenant?.phone || '',
    email: activeTenant?.email || '',
    leaseStart: activeTenant?.leaseStart ? new Date(activeTenant.leaseStart).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    leaseEnd: activeTenant?.leaseEnd ? new Date(activeTenant.leaseEnd).toISOString().split('T')[0] : '',
    rentAmount: activeTenant?.rentAmount?.toString() || '',
    deposit: activeTenant?.deposit?.toString() || '',
  });
  const [showTenantRemoveConfirm, setShowTenantRemoveConfirm] = useState(false);
  const [tenantRemovalReason, setTenantRemovalReason] = useState('');

  useEffect(() => {
    setForm({
      name: flat.owner?.name || '',
      phone: flat.owner?.phone || '',
      email: flat.owner?.email || '',
      aadharNo: flat.owner?.aadharNo || '',
      panNo: flat.owner?.panNo || '',
    });
  }, [flat.owner]);

  useEffect(() => {
    setTenantForm({
      name: activeTenant?.name || '',
      phone: activeTenant?.phone || '',
      email: activeTenant?.email || '',
      leaseStart: activeTenant?.leaseStart ? new Date(activeTenant.leaseStart).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      leaseEnd: activeTenant?.leaseEnd ? new Date(activeTenant.leaseEnd).toISOString().split('T')[0] : '',
      rentAmount: activeTenant?.rentAmount?.toString() || '',
      deposit: activeTenant?.deposit?.toString() || '',
    });
    setShowTenantRemoveConfirm(false);
    setTenantRemovalReason('');
  }, [activeTenant, flat.id]);

  const ownerMutation = useMutation({
    mutationFn: (data: any) => {
      if (flat.owner?.id) {
        return api.put(`/flats/owners/${flat.owner.id}`, data);
      }
      return api.post('/flats/owners', { ...data, flatId: flat.id });
    },
    onSuccess: () => { toast.success('Owner details saved!'); onSaved(); },
    onError: (e: any) => toast.error(getApiErrorMessage(e, 'Failed to save owner details')),
  });

  const tenantMutation = useMutation({
    mutationFn: (data: any) => {
      if (activeTenant?.id) {
        return api.put(`/flats/tenants/${activeTenant.id}`, data);
      }
      return api.post('/flats/tenants', { ...data, flatId: flat.id });
    },
    onSuccess: () => { toast.success(activeTenant?.id ? 'Tenant details saved!' : 'Tenant added successfully!'); onSaved(); },
    onError: (e: any) => toast.error(getApiErrorMessage(e, 'Failed to save tenant details')),
  });

  const removeTenantMutation = useMutation({
    mutationFn: (reason: string) => api.delete(`/flats/tenants/${flat.tenant?.id}`, { data: { reason } }),
    onSuccess: () => {
      toast.success('Tenant removed');
      setShowTenantRemoveConfirm(false);
      setTenantRemovalReason('');
      onSaved();
    },
    onError: (e: any) => toast.error(getApiErrorMessage(e, 'Failed to remove tenant')),
  });

  const handleOwnerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Owner name is required.');
      return;
    }

    const contact = validateResidentContactDetails({ phone: form.phone, email: form.email });
    if (!contact) return;

    ownerMutation.mutate({
      ...form,
      name: form.name.trim(),
      phone: contact.phone,
      email: contact.email || undefined,
      aadharNo: form.aadharNo.trim() || undefined,
      panNo: form.panNo.trim() || undefined,
    });
  };

  const handleTenantSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantForm.name.trim()) {
      toast.error('Tenant name is required.');
      return;
    }
    if (!tenantForm.leaseStart) {
      toast.error('Lease start date is required.');
      return;
    }
    if (tenantForm.leaseEnd && tenantForm.leaseEnd < tenantForm.leaseStart) {
      toast.error('Lease end date cannot be before lease start date.');
      return;
    }

    const contact = validateResidentContactDetails({ phone: tenantForm.phone, email: tenantForm.email });
    if (!contact) return;

    tenantMutation.mutate({
      name: tenantForm.name.trim(),
      phone: contact.phone,
      email: contact.email || undefined,
      leaseStart: tenantForm.leaseStart,
      leaseEnd: tenantForm.leaseEnd || undefined,
      rentAmount: tenantForm.rentAmount || undefined,
      deposit: tenantForm.deposit || undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div className="mb-4 p-3 bg-surface-container-low rounded-lg">
        <p className="text-sm text-on-surface-variant">
          <strong>Flat:</strong> {flat.flatNumber} · {flat.block?.name} · Floor {flat.floor} · {getFlatTypeLabel(flat.type)}
        </p>
      </div>

      <section className="rounded-2xl border border-outline-variant/15 p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-on-surface">Owner Details</h3>
            <p className="text-xs text-on-surface-variant mt-1">Phone must be a 10-digit Indian mobile number. Email is optional.</p>
          </div>
          <span className={cn('badge', flat.owner ? 'badge-success' : 'badge-neutral')}>
            {flat.owner ? 'Owner linked' : 'No owner'}
          </span>
        </div>

        {!flat.owner && (
          <div className="mb-4 p-3 bg-slate-100 border border-slate-200 rounded-lg">
            <p className="text-xs text-slate-700">
              <strong>Auto Login Creation:</strong> When you provide both email and phone number,
              a login account will be automatically created. The default password will be the phone number.
            </p>
          </div>
        )}

        <form onSubmit={handleOwnerSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Name *</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="label">Phone *</label>
              <input
                className="input"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                inputMode="numeric"
                maxLength={10}
                placeholder="9876543210"
                required
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                className="input"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="owner@email.com"
              />
            </div>
            <div>
              <label className="label">Aadhar No</label>
              <input className="input" value={form.aadharNo} onChange={(e) => setForm({ ...form, aadharNo: e.target.value })} />
            </div>
            <div>
              <label className="label">PAN No</label>
              <input className="input" value={form.panNo} onChange={(e) => setForm({ ...form, panNo: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="submit" className="btn-primary" disabled={ownerMutation.isPending}>
              {ownerMutation.isPending ? 'Saving...' : flat.owner ? 'Update Owner' : 'Add Owner'}
            </button>
          </div>
        </form>

        {flat.owner?.email && (
          <div className="mt-4 p-3 bg-slate-100 border border-slate-200 rounded-lg">
            <p className="text-xs text-slate-700">
              <strong>Login Account:</strong> A login account {flat.owner.userId ? 'is linked' : 'will be created when email and phone are provided'} for this owner.
              Default password is the owner's phone number.
            </p>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-outline-variant/15 p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-on-surface">Tenant Details</h3>
            <p className="text-xs text-on-surface-variant mt-1">Manage the active resident for this flat from the same panel.</p>
          </div>
          <span className={cn('badge', flat.tenant?.isActive ? 'badge-info' : 'badge-neutral')}>
            {flat.tenant?.isActive ? 'Tenant active' : flat.tenant ? 'Tenant inactive' : 'No tenant'}
          </span>
        </div>

        {!flat.tenant?.isActive && (
          <div className="mb-4 p-3 bg-slate-100 border border-slate-200 rounded-lg">
            <p className="text-xs text-slate-700">
              <strong>Auto Login Creation:</strong> When you provide both email and phone number,
              a login account will be automatically created for the tenant with phone number as the default password.
            </p>
          </div>
        )}

        <form onSubmit={handleTenantSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Name *</label>
              <input className="input" value={tenantForm.name} onChange={(e) => setTenantForm({ ...tenantForm, name: e.target.value })} required />
            </div>
            <div>
              <label className="label">Phone *</label>
              <input
                className="input"
                value={tenantForm.phone}
                onChange={(e) => setTenantForm({ ...tenantForm, phone: e.target.value })}
                inputMode="numeric"
                maxLength={10}
                placeholder="9876543210"
                required
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                className="input"
                value={tenantForm.email}
                onChange={(e) => setTenantForm({ ...tenantForm, email: e.target.value })}
                placeholder="tenant@email.com"
              />
            </div>
            <div>
              <label className="label">Lease Start *</label>
              <input className="input" type="date" value={tenantForm.leaseStart} onChange={(e) => setTenantForm({ ...tenantForm, leaseStart: e.target.value })} required />
            </div>
            <div>
              <label className="label">Lease End</label>
              <input className="input" type="date" value={tenantForm.leaseEnd} onChange={(e) => setTenantForm({ ...tenantForm, leaseEnd: e.target.value })} min={tenantForm.leaseStart || undefined} />
            </div>
            <div>
              <label className="label">Rent Amount</label>
              <input className="input" type="number" min="0" value={tenantForm.rentAmount} onChange={(e) => setTenantForm({ ...tenantForm, rentAmount: e.target.value })} />
            </div>
            <div>
              <label className="label">Deposit</label>
              <input className="input" type="number" min="0" value={tenantForm.deposit} onChange={(e) => setTenantForm({ ...tenantForm, deposit: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            {isAdminManager && flat.tenant?.id && flat.tenant?.isActive && (
              <button
                type="button"
                className="btn-secondary text-error border-error/25 hover:bg-error-container/50"
                onClick={() => setShowTenantRemoveConfirm((value) => !value)}
              >
                Remove Tenant
              </button>
            )}
            <button type="submit" className="btn-primary" disabled={tenantMutation.isPending}>
              {tenantMutation.isPending ? 'Saving...' : activeTenant?.id ? 'Update Tenant' : 'Add Tenant'}
            </button>
          </div>
        </form>

        {isAdminManager && flat.tenant?.id && flat.tenant?.isActive && showTenantRemoveConfirm && (
          <div className="mt-4 rounded-xl border border-error/15 bg-error-container/40 p-4 space-y-3">
            <p className="text-sm font-semibold text-on-surface">Remove active tenant</p>
            <p className="text-xs text-on-surface-variant">This will remove tenant access for the current society and send an email to the removed tenant.</p>
            <div>
              <label className="label">Reason *</label>
              <textarea
                className="input min-h-[100px]"
                value={tenantRemovalReason}
                onChange={(event) => setTenantRemovalReason(event.target.value)}
                placeholder="Explain why this tenant is being removed."
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setShowTenantRemoveConfirm(false);
                  setTenantRemovalReason('');
                }}
                disabled={removeTenantMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary bg-error text-white hover:bg-error/90"
                disabled={removeTenantMutation.isPending || !tenantRemovalReason.trim()}
                onClick={() => removeTenantMutation.mutate(tenantRemovalReason.trim())}
              >
                {removeTenantMutation.isPending ? 'Removing...' : 'Confirm Remove'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ── Bulk Upload Form ────────────────────────────────────
function BulkUploadForm({ onSuccess, onLimitReached }: { onSuccess: () => void; onLimitReached: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<{
    message: string;
    total: number;
    created: number;
    errors: number;
    results: { row: number; flatNumber: string; status: string; error?: string }[];
  } | null>(null);

  const handleDownloadTemplate = async () => {
    try {
      const response = await api.get('/flats/bulk-upload/template', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'flat_upload_template.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success('Template downloaded!');
    } catch (error: any) {
      toast.error('Failed to download template');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      if (!selected.name.endsWith('.xlsx') && !selected.name.endsWith('.xls')) {
        toast.error('Please upload an Excel file (.xlsx or .xls)');
        return;
      }
      setFile(selected);
      setResults(null);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      toast.error('Please select a file first');
      return;
    }

    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const response = await api.post('/flats/bulk-upload', buffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      });
      setResults(response.data);
      if (response.data.results?.some((r: any) => /limit|capacity/i.test(r.error || ''))) {
        onLimitReached();
      }
      if (response.data.created > 0) {
        toast.success(`${response.data.created} flats created successfully!`);
      }
      if (response.data.errors > 0) {
        toast.error(`${response.data.errors} rows had errors. Check details below.`);
      }
      if (response.data.created > 0) {
        setTimeout(onSuccess, 2000);
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Step 1: Download Template */}
      <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
        <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4" />
          Step 1: Download Template
        </h3>
        <p className="text-xs text-slate-700 mb-3">
          Download the Excel template, fill in your flat details, and upload it back.
          Owner accounts will be auto-created with phone number as default password.
        </p>
        <button onClick={handleDownloadTemplate} className="btn-secondary text-sm">
          <Download className="w-4 h-4" /> Download Template
        </button>
      </div>

      {/* Step 2: Upload File */}
      <div className="p-4 bg-surface-container-low border border-outline-variant/15 rounded-xl">
        <h3 className="text-sm font-semibold text-on-surface mb-2 flex items-center gap-2">
          <Upload className="w-4 h-4" />
          Step 2: Upload Filled Excel
        </h3>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileSelect}
          className="hidden"
        />

        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-outline-variant rounded-lg p-6 text-center cursor-pointer hover:border-primary hover:bg-primary-container/50 transition"
        >
          {file ? (
            <div>
              <FileSpreadsheet className="w-8 h-8 text-primary mx-auto mb-2" />
              <p className="text-sm font-medium text-on-surface">{file.name}</p>
              <p className="text-xs text-on-surface-variant mt-1">{(file.size / 1024).toFixed(1)} KB</p>
              <p className="text-xs text-primary mt-2">Click to change file</p>
            </div>
          ) : (
            <div>
              <Upload className="w-8 h-8 text-outline mx-auto mb-2" />
              <p className="text-sm text-on-surface-variant">Click to select Excel file</p>
              <p className="text-xs text-outline mt-1">Supports .xlsx and .xls files</p>
            </div>
          )}
        </div>

        {file && (
          <div className="mt-3 flex justify-end">
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="btn-primary"
            >
              {uploading ? 'Processing...' : 'Upload & Create Flats'}
            </button>
          </div>
        )}
      </div>

      {/* Step 3: Results */}
      {results && (
        <div className="p-4 bg-white border border-outline-variant/15 rounded-xl">
          <h3 className="text-sm font-semibold text-on-surface mb-3">Upload Results</h3>

          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="p-3 bg-surface-container-low rounded-lg text-center">
              <p className="text-lg font-bold text-on-surface">{results.total}</p>
              <p className="text-xs text-on-surface-variant">Total Rows</p>
            </div>
            <div className="p-3 bg-emerald-50 rounded-lg text-center">
              <p className="text-lg font-bold text-emerald-900">{results.created}</p>
              <p className="text-xs text-emerald-700">Created</p>
            </div>
            <div className="p-3 bg-rose-50 rounded-lg text-center">
              <p className="text-lg font-bold text-rose-900">{results.errors}</p>
              <p className="text-xs text-rose-700">Errors</p>
            </div>
          </div>

          {/* Detailed results */}
          <div className="max-h-48 overflow-y-auto space-y-1">
            {results.results.map((r, i) => (
              <div
                key={i}
                className={cn(
                  'flex items-center justify-between text-xs px-3 py-2 rounded',
                  r.status === 'success' ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-rose-900',
                )}
              >
                <span>Row {r.row}: {r.flatNumber}</span>
                <span className="text-right max-w-[60%] truncate">
                  {r.status === 'success' ? '✓ Created' : r.error}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
