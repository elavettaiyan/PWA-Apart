import { useQuery } from '@tanstack/react-query';
import { Building2, ChevronDown, ChevronsUpDown, Info, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { useCreateFlatMutation, useUpdateFlatMutation } from '@/hooks/flatsHooks';
import { useAuthStore } from '@/store/authStore';
import type { Block, Flat, FlatType } from '@/types';

interface AddFlatFormProps {
  blocks: Block[];
  flat?: Flat | null;
  initialBlockId?: string;
  onSuccess: () => void;
  onLimitReached: () => void;
  onDeleteRequest?: () => void;
}

const FLAT_TYPE_OPTIONS: Array<{ value: FlatType; label: string }> = [
  { value: 'ONE_BHK', label: '1 BHK' },
  { value: 'TWO_BHK', label: '2 BHK' },
  { value: 'THREE_BHK', label: '3 BHK' },
  { value: 'FOUR_BHK', label: '4 BHK' },
  { value: 'STUDIO', label: 'Studio' },
  { value: 'PENTHOUSE', label: 'Penthouse' },
  { value: 'SHOP', label: 'Shop' },
  { value: 'OTHER', label: 'Other' },
];

export function AddFlatForm({ blocks, flat, initialBlockId, onSuccess, onLimitReached, onDeleteRequest }: AddFlatFormProps) {
  const user = useAuthStore((state) => state.user);
  const flatNumberInputRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState({
    flatNumber: '',
    floor: '1',
    type: 'TWO_BHK' as FlatType,
    areaSqFt: '',
    keyFeatures: [] as Array<'BALCONY' | 'CENTRAL_AC'>,
    parkingType: 'NONE' as 'NONE' | 'OPEN' | 'COVERED',
    parkingSlotNumber: '',
    blockId: initialBlockId || blocks[0]?.id || '',
  });

  const createMutation = useCreateFlatMutation();
  const updateMutation = useUpdateFlatMutation(flat?.id || '');
  const mutation = flat ? updateMutation : createMutation;
  const isEditing = Boolean(flat);

  const { data: societySettings } = useQuery<{ configuredFlatTypes?: FlatType[] }>({
    queryKey: ['society-settings', user?.activeSocietyId || user?.societyId || 'no-society'],
    queryFn: async () => (await api.get('/settings/society-settings')).data,
    enabled: Boolean(user?.societyId),
    staleTime: 5 * 60 * 1000,
  });

  const availableFlatTypes = useMemo(() => {
    const configuredTypes = societySettings?.configuredFlatTypes?.filter(Boolean) ?? [];
    const configuredTypeSet = new Set(configuredTypes);

    if (flat?.type) {
      configuredTypeSet.add(flat.type);
    }

    if (configuredTypeSet.size === 0) {
      return FLAT_TYPE_OPTIONS;
    }

    return FLAT_TYPE_OPTIONS.filter((option) => configuredTypeSet.has(option.value));
  }, [flat?.type, societySettings?.configuredFlatTypes]);

  useEffect(() => {
    setForm({
      flatNumber: flat?.flatNumber || '',
      floor: String(flat?.floor ?? 1),
      type: flat?.type || 'TWO_BHK',
      areaSqFt: flat?.areaSqFt ? String(flat.areaSqFt) : '',
      keyFeatures: flat?.keyFeatures || [],
      parkingType: flat?.parkingType || 'NONE',
      parkingSlotNumber: flat?.parkingSlotNumber || '',
      blockId: flat?.blockId || initialBlockId || blocks[0]?.id || '',
    });
  }, [flat, blocks, initialBlockId]);

  useEffect(() => {
    // Blocks are loaded asynchronously; ensure blockId is set once data arrives.
    if (!form.blockId && blocks.length > 0) {
      setForm((prev) => ({ ...prev, blockId: initialBlockId || blocks[0].id }));
    }
  }, [blocks, form.blockId, initialBlockId]);

  useEffect(() => {
    if (availableFlatTypes.length === 0) {
      return;
    }

    if (!availableFlatTypes.some((option) => option.value === form.type)) {
      setForm((prev) => ({ ...prev, type: availableFlatTypes[0].value }));
    }
  }, [availableFlatTypes, form.type]);

  useEffect(() => {
    if (isEditing) {
      return;
    }

    flatNumberInputRef.current?.focus();
  }, [isEditing]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.blockId) {
      toast.error('Please create/select a block before adding a flat.');
      return;
    }
    mutation.mutate(
      {
        ...form,
        floor: Number(form.floor),
        areaSqFt: form.areaSqFt ? Number(form.areaSqFt) : undefined,
        keyFeatures: form.keyFeatures,
        parkingSlotNumber: form.parkingType === 'NONE' ? undefined : form.parkingSlotNumber.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success(isEditing ? 'Flat updated!' : 'Flat added!');
          onSuccess();
        },
        onError: (e: any) => {
          toast.error(e.response?.data?.error || 'Failed');
        },
      }
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <section className="space-y-5">
        {isEditing ? (
          <div className="flex items-center gap-4 rounded-[24px] border border-outline-variant/80 bg-surface-container-lowest p-5 shadow-sm">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary-fixed text-primary">
              <Building2 className="h-9 w-9" />
            </div>
            <div>
              <h3 className="font-headline text-2xl font-semibold text-on-surface">Flat {flat?.flatNumber}</h3>
              <p className="mt-1 text-lg text-on-surface-variant">{flat?.block?.name} • Floor {flat?.floor}</p>
            </div>
          </div>
        ) : null}

        <div className="rounded-[28px] border border-outline-variant/80 bg-surface-container-lowest p-5 shadow-sm sm:p-6">
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <SelectField label={isEditing ? 'Block' : 'Block Selection'} icon={<ChevronDown className="h-5 w-5" />}>
                <select
                  className="select !h-14 !rounded-2xl !border-outline-variant/80 !bg-surface-container-low px-5 pr-12 text-base"
                  value={form.blockId}
                  onChange={(e) => setForm({ ...form, blockId: e.target.value })}
                  required
                  disabled={blocks.length === 0}
                >
                  {!isEditing && <option value="" disabled>Select a block</option>}
                  {blocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </SelectField>

              <div>
                <label className="label !mb-2 !normal-case !tracking-normal">Flat Number</label>
                <input
                  ref={flatNumberInputRef}
                  className="input !h-14 !rounded-2xl !border-outline-variant/80 !bg-surface-container-low text-base"
                  value={form.flatNumber}
                  onChange={(e) => setForm({ ...form, flatNumber: e.target.value })}
                  required
                  placeholder="e.g. A-101"
                />
              </div>
            </div>

            <div>
              <label className="label !mb-3 !normal-case !tracking-normal">Flat Type{isEditing ? '' : ' (BHK)'}</label>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {availableFlatTypes.map((option) => {
                  const active = form.type === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setForm({ ...form, type: option.value })}
                      className={cn(
                        'rounded-2xl border px-4 py-3 text-base font-semibold transition-colors',
                        active
                          ? 'border-2 border-primary bg-primary-fixed text-primary'
                          : 'border-outline-variant/80 bg-white text-on-surface hover:bg-surface-container-low'
                      )}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              {societySettings?.configuredFlatTypes?.length ? (
                <p className="mt-3 text-xs text-slate-500">Showing only flat types configured for this apartment.</p>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label !mb-2 !normal-case !tracking-normal">Area (sq.ft)</label>
                <input
                  type="number"
                  className="input !h-14 !rounded-2xl !border-outline-variant/80 !bg-surface-container-low text-base"
                  value={form.areaSqFt}
                  onChange={(e) => setForm({ ...form, areaSqFt: e.target.value })}
                  placeholder="1200"
                />
              </div>
              <SelectField label="Floor" icon={<ChevronsUpDown className="h-5 w-5" />}>
                <input
                  type="number"
                  className="input !h-14 !rounded-2xl !border-outline-variant/80 !bg-surface-container-low px-5 text-base"
                  value={form.floor}
                  onChange={(e) => setForm({ ...form, floor: e.target.value })}
                  min={0}
                  required
                  placeholder="1"
                />
              </SelectField>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label !mb-2 !normal-case !tracking-normal">Parking Type</label>
                <select
                  className="select !h-14 !rounded-2xl !border-outline-variant/80 !bg-surface-container-low px-5 text-base"
                  value={form.parkingType}
                  onChange={(e) => {
                    const parkingType = e.target.value as 'NONE' | 'OPEN' | 'COVERED';
                    setForm({
                      ...form,
                      parkingType,
                      parkingSlotNumber: parkingType === 'NONE' ? '' : form.parkingSlotNumber,
                    });
                  }}
                >
                  <option value="NONE">No Parking</option>
                  <option value="OPEN">Open</option>
                  <option value="COVERED">Covered</option>
                </select>
              </div>
              <div>
                <label className="label !mb-2 !normal-case !tracking-normal">Parking Slot</label>
                <input
                  className="input !h-14 !rounded-2xl !border-outline-variant/80 !bg-surface-container-low text-base"
                  value={form.parkingSlotNumber}
                  onChange={(e) => setForm({ ...form, parkingSlotNumber: e.target.value })}
                  placeholder="Optional"
                  disabled={form.parkingType === 'NONE'}
                />
              </div>
            </div>
          </div>
        </div>

        {!isEditing ? (
          <div className="flex items-start gap-3 rounded-[24px] bg-primary-fixed p-5 text-on-primary-fixed-variant">
            <Info className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-lg leading-8">Adding a flat will automatically create a vacancy entry in the dashboard for Block selection.</p>
          </div>
        ) : null}
      </section>

      <div className="sticky bottom-0 -mx-5 border-t border-outline-variant/70 bg-surface px-5 pb-[calc(1rem+var(--sab,0px))] pt-4 sm:-mx-6 sm:px-6">
        <div className="space-y-3">
          <button type="submit" className="btn-primary h-14 w-full justify-center rounded-[22px] text-lg font-semibold" disabled={mutation.isPending || blocks.length === 0}>
            <Save className="h-5 w-5" />
            {mutation.isPending ? (isEditing ? 'Updating...' : 'Adding...') : (isEditing ? 'Update Flat' : 'Add Flat')}
          </button>
          {isEditing && onDeleteRequest ? (
            <button type="button" className="flex h-12 w-full items-center justify-center gap-2 rounded-[22px] text-lg font-semibold text-error transition-colors hover:bg-error-container/20" onClick={onDeleteRequest}>
              <Trash2 className="h-5 w-5" />
              Delete Flat Record
            </button>
          ) : null}
        </div>
      </div>
    </form>
  );
}

function SelectField({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="label !mb-2 !normal-case !tracking-normal">{label}</label>
      <div className="relative">
        {children}
        <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-outline">{icon}</div>
      </div>
    </div>
  );
}
