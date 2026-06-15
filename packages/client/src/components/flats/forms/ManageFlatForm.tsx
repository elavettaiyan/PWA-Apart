import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Mail, Pencil, Phone, Plus, Save, Trash2, User, UserRound, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  cn,
  getFlatTypeLabel,
  isValidEmailAddress,
  isValidIndianMobileNumber,
  normalizeEmail,
  normalizeIndianMobileNumber,
} from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import {
  useCreateOwnerMutation,
  useUpdateOwnerMutation,
  useCreateTenantMutation,
  useUpdateTenantMutation,
  useRemoveTenantMutation,
} from '@/hooks/flatsHooks';
import api from '@/lib/api';
import type { Flat, ResidentVehicle, VehicleType } from '@/types';

interface ManageFlatFormProps {
  flat: Flat;
  onSaved: () => void;
}

type VehicleDraft = {
  id: string;
  type: VehicleType;
  registrationNumber: string;
};

const VEHICLE_TYPE_OPTIONS: Array<{ value: VehicleType; label: string }> = [
  { value: 'TWO_WHEELER', label: 'Two Wheeler' },
  { value: 'THREE_WHEELER', label: 'Three Wheeler' },
  { value: 'FOUR_WHEELER', label: 'Four Wheeler' },
];

function createVehicleDraft(vehicle?: ResidentVehicle): VehicleDraft {
  return {
    id: vehicle?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: vehicle?.type || 'TWO_WHEELER',
    registrationNumber: vehicle?.registrationNumber || '',
  };
}

function getVehicleDrafts(existingVehicles?: ResidentVehicle[], fallback?: { carNumber?: string; twoWheelerNumber?: string }) {
  if (existingVehicles?.length) {
    return existingVehicles.map((vehicle) => createVehicleDraft(vehicle));
  }

  const drafts: VehicleDraft[] = [];
  if (fallback?.carNumber) {
    drafts.push(createVehicleDraft({ id: `legacy-car-${fallback.carNumber}`, type: 'FOUR_WHEELER', registrationNumber: fallback.carNumber }));
  }
  if (fallback?.twoWheelerNumber) {
    drafts.push(createVehicleDraft({ id: `legacy-two-${fallback.twoWheelerNumber}`, type: 'TWO_WHEELER', registrationNumber: fallback.twoWheelerNumber }));
  }
  return drafts;
}

function normalizeVehicleDrafts(vehicles: VehicleDraft[]) {
  const seen = new Set<string>();
  const normalized: Array<{ type: VehicleType; registrationNumber: string }> = [];

  for (const vehicle of vehicles) {
    const registrationNumber = vehicle.registrationNumber.trim().toUpperCase();
    if (!registrationNumber) {
      continue;
    }

    const dedupeKey = `${vehicle.type}:${registrationNumber}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    normalized.push({ type: vehicle.type, registrationNumber });
  }

  return normalized;
}

function buildOwnerFormState(owner?: Flat['owner'] | null) {
  return {
    name: owner?.name || '',
    phone: owner?.phone || '',
    email: owner?.email || '',
    aadharNo: owner?.aadharNo || '',
    panNo: owner?.panNo || '',
  };
}

function buildTenantFormState(tenant?: Flat['tenant'] | null) {
  return {
    name: tenant?.name || '',
    phone: tenant?.phone || '',
    email: tenant?.email || '',
    leaseStart: tenant?.leaseStart ? new Date(tenant.leaseStart).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    leaseEnd: tenant?.leaseEnd ? new Date(tenant.leaseEnd).toISOString().split('T')[0] : '',
    rentAmount: tenant?.rentAmount?.toString() || '',
    deposit: tenant?.deposit?.toString() || '',
  };
}

export function ManageFlatForm({ flat, onSaved }: ManageFlatFormProps) {
  const user = useAuthStore((state) => state.user);
  const isAdminManager = user?.role === 'SUPER_ADMIN' || (['ADMIN', 'SECRETARY', 'JOINT_SECRETARY'] as string[]).includes(user?.role || '');
  const activeTenant = flat.tenant?.isActive ? flat.tenant : null;
  const canSelectTenant = Boolean(flat.owner || activeTenant);
  const [residentMode, setResidentMode] = useState<'OWNER' | 'TENANT'>(activeTenant ? 'TENANT' : 'OWNER');

  const [form, setForm] = useState(() => buildOwnerFormState(flat.owner));
  const [ownerVehicles, setOwnerVehicles] = useState<VehicleDraft[]>(() => getVehicleDrafts(flat.owner?.vehicles, flat.owner));

  const [tenantForm, setTenantForm] = useState(() => buildTenantFormState(activeTenant));
  const [tenantVehicles, setTenantVehicles] = useState<VehicleDraft[]>(() => getVehicleDrafts(activeTenant?.vehicles, activeTenant || undefined));

  const [showTenantRemoveConfirm, setShowTenantRemoveConfirm] = useState(false);
  const [tenantRemovalReason, setTenantRemovalReason] = useState('');

  const ownerMutation = flat.owner?.id ? useUpdateOwnerMutation(flat.owner.id) : useCreateOwnerMutation();
  const tenantMutation = activeTenant?.id ? useUpdateTenantMutation(activeTenant.id) : useCreateTenantMutation();
  const removeTenantMutation = useRemoveTenantMutation();
  const resetOwnerLoginMutation = useMutation({
    mutationFn: () => api.post(`/flats/owners/${flat.owner!.id}/reset-login`),
    onSuccess: () => toast.success('Login reset. Owner can log in with their phone number as password.'),
    onError: (error: any) => toast.error(error.response?.data?.error || 'Failed to reset owner login'),
  });

  const resetTenantForm = () => {
    setTenantForm(buildTenantFormState(activeTenant));
    setTenantVehicles(getVehicleDrafts(activeTenant?.vehicles, activeTenant || undefined));
    setShowTenantRemoveConfirm(false);
    setTenantRemovalReason('');
  };

  useEffect(() => {
    setForm(buildOwnerFormState(flat.owner));
    setOwnerVehicles(getVehicleDrafts(flat.owner?.vehicles, flat.owner));
  }, [flat.owner]);

  useEffect(() => {
    resetTenantForm();
  }, [activeTenant, flat.id]);

  useEffect(() => {
    setResidentMode(activeTenant ? 'TENANT' : 'OWNER');
  }, [activeTenant, flat.id]);

  useEffect(() => {
    if (!canSelectTenant && residentMode === 'TENANT') {
      setResidentMode('OWNER');
    }
  }, [canSelectTenant, residentMode]);

  const activeResident = residentMode === 'OWNER' ? flat.owner : activeTenant;
  const residentIdLabel = useMemo(() => {
    const rawId = activeResident?.id || flat.id;
    return `#RH-${rawId.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
  }, [activeResident?.id, flat.id]);
  const residentInitial = (activeResident?.name || flat.owner?.name || activeTenant?.name || 'R').trim().charAt(0).toUpperCase();
  const assignedFlatLabel = `${flat.flatNumber}${flat.block?.name ? ` • ${flat.block.name}` : ''}`;
  const residentAccessNote = useMemo(() => {
    if (residentMode === 'OWNER') {
      if (!flat.owner) {
        return 'When you provide both email and phone number, a login account will be automatically created. The default password will be the phone number.';
      }

      if (flat.owner?.email) {
        return flat.owner.userId
          ? 'A login account is already linked for this owner. They should continue with their existing password, or use Reset Login to issue a new default password.'
          : 'A login account will be created for this owner when both email and phone number are provided. The default password will be the phone number.';
      }

      return null;
    }

    if (!flat.tenant?.isActive) {
      return 'When you provide both email and phone number, a login account will be automatically created for the tenant with phone number as the default password.';
    }

    return null;
  }, [flat.owner, flat.tenant?.isActive, residentMode]);

  const handleOwnerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Owner name is required.');
      return;
    }

    const trimmedPhone = normalizeIndianMobileNumber(form.phone);
    const trimmedEmail = form.email?.trim() || '';

    if (!isValidIndianMobileNumber(trimmedPhone)) {
      toast.error('Phone number must be a valid 10-digit Indian mobile number.');
      return;
    }

    if (trimmedEmail && !isValidEmailAddress(trimmedEmail)) {
      toast.error('Enter a valid email address.');
      return;
    }

    const payload = {
      ...form,
      name: form.name.trim(),
      phone: trimmedPhone,
      email: trimmedEmail ? normalizeEmail(trimmedEmail) : undefined,
      vehicles: normalizeVehicleDrafts(ownerVehicles),
      aadharNo: form.aadharNo.trim() || undefined,
      panNo: form.panNo.trim() || undefined,
      ...(flat.owner?.id ? {} : { flatId: flat.id }),
    };

    ownerMutation.mutate(payload, {
      onSuccess: () => {
        toast.success('Owner details saved!');
        onSaved();
      },
      onError: (e: any) => {
        toast.error(e.response?.data?.error || 'Failed to save owner details');
      },
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

    const trimmedPhone = normalizeIndianMobileNumber(tenantForm.phone);
    const trimmedEmail = tenantForm.email?.trim() || '';

    if (!isValidIndianMobileNumber(trimmedPhone)) {
      toast.error('Phone number must be a valid 10-digit Indian mobile number.');
      return;
    }

    if (trimmedEmail && !isValidEmailAddress(trimmedEmail)) {
      toast.error('Enter a valid email address.');
      return;
    }

    const payload = {
      name: tenantForm.name.trim(),
      phone: trimmedPhone,
      email: trimmedEmail ? normalizeEmail(trimmedEmail) : undefined,
      vehicles: normalizeVehicleDrafts(tenantVehicles),
      leaseStart: tenantForm.leaseStart,
      leaseEnd: tenantForm.leaseEnd || undefined,
      rentAmount: tenantForm.rentAmount || undefined,
      deposit: tenantForm.deposit || undefined,
      ...(activeTenant?.id ? {} : { flatId: flat.id }),
    };

    tenantMutation.mutate(payload, {
      onSuccess: () => {
        toast.success(activeTenant?.id ? 'Tenant details saved!' : 'Tenant added successfully!');
        onSaved();
      },
      onError: (e: any) => {
        toast.error(e.response?.data?.error || 'Failed to save tenant details');
      },
    });
  };

  return (
    <div className="max-h-[75vh] overflow-y-auto pr-1 lg:max-h-[78vh]">
      <div className="space-y-6 lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-6 lg:space-y-0">
      <section className="border-b border-outline-variant/60 pb-6 text-center lg:sticky lg:top-0 lg:self-start lg:rounded-[28px] lg:border lg:bg-surface-container-lowest lg:px-5 lg:py-6 lg:shadow-sm">
        <div className="relative mx-auto flex h-28 w-28 items-center justify-center rounded-full bg-surface-container-low shadow-sm">
          <span className="text-4xl font-semibold text-on-surface">{residentInitial}</span>
          <span className="absolute bottom-0 right-0 flex h-11 w-11 items-center justify-center rounded-full border-4 border-white bg-primary text-white shadow-md">
            <Pencil className="h-5 w-5" />
          </span>
        </div>
        <h3 className="mt-5 font-headline text-3xl font-semibold text-on-surface">
          {activeResident?.name || (residentMode === 'OWNER' ? 'Add Owner' : 'Add Tenant')}
        </h3>
        <p className="text-lg text-on-surface-variant">Resident ID: {residentIdLabel}</p>
        <div className="mt-6 rounded-[24px] border border-outline-variant/70 bg-white p-4 text-left">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-on-surface-variant">Assigned Flat</p>
          <p className="mt-2 text-lg font-semibold text-on-surface">{assignedFlatLabel}</p>
          <p className="mt-1 text-sm text-on-surface-variant">{getFlatTypeLabel(flat.type)} • Floor {flat.floor}</p>
        </div>
        {residentAccessNote ? (
          <div className="mt-4 rounded-[24px] border border-blue-100 bg-blue-50/70 p-4 text-left">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-blue-700">Login Access</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">{residentAccessNote}</p>
          </div>
        ) : null}
      </section>

      <section className="rounded-[28px] border border-outline-variant/70 bg-surface-container-lowest p-5 shadow-sm sm:p-6">
        <p className="mb-6 text-sm font-bold uppercase tracking-[0.12em] text-on-surface-variant">Personal Details</p>

        <div className="mb-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setResidentMode('OWNER')}
            className={cn(
              'flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-base font-semibold transition-colors',
              residentMode === 'OWNER'
                ? 'border-2 border-primary bg-primary-fixed text-primary'
                : 'border-outline-variant/80 bg-white text-on-surface-variant'
            )}
          >
            {residentMode === 'OWNER' ? <CheckCircle2 className="h-5 w-5" /> : <UserRound className="h-5 w-5" />}
            Owner
          </button>
          <button
            type="button"
            onClick={() => {
              if (canSelectTenant) {
                setResidentMode('TENANT');
              }
            }}
            disabled={!canSelectTenant}
            className={cn(
              'flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-base font-semibold transition-colors',
              residentMode === 'TENANT'
                ? 'border-2 border-primary bg-primary-fixed text-primary'
                : 'border-outline-variant/80 bg-white text-on-surface-variant',
              !canSelectTenant && 'cursor-not-allowed border-outline-variant/60 bg-surface-container text-on-surface-variant/60'
            )}
          >
            {residentMode === 'TENANT' ? <CheckCircle2 className="h-5 w-5" /> : <User className="h-5 w-5" />}
            Tenant
          </button>
        </div>

        {!canSelectTenant ? (
          <p className="mb-5 text-sm text-on-surface-variant">Add the owner details first to enable tenant assignment for this flat.</p>
        ) : null}

        {residentMode === 'OWNER' ? (
          <form onSubmit={handleOwnerSubmit} className="space-y-5">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ResidentInput label="Full Name" icon={<User className="h-5 w-5" />}>
                <input className="input !h-14 !rounded-2xl !border-outline-variant/80 !bg-surface-container-low pl-12 text-base" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </ResidentInput>
              <ResidentInput label="Phone Number" icon={<Phone className="h-5 w-5" />}>
                <input className="input !h-14 !rounded-2xl !border-outline-variant/80 !bg-surface-container-low pl-12 text-base" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="numeric" maxLength={10} placeholder="95236 55556" required />
              </ResidentInput>
            </div>
            <ResidentInput label="Email Address" icon={<Mail className="h-5 w-5" />}>
              <input type="email" className="input !h-14 !rounded-2xl !border-outline-variant/80 !bg-surface-container-low pl-12 text-base" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" />
            </ResidentInput>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label !mb-2 !normal-case !tracking-normal">Aadhar No</label>
                <input className="input !h-14 !rounded-2xl !border-outline-variant/80 !bg-surface-container-low text-base" value={form.aadharNo} onChange={(e) => setForm({ ...form, aadharNo: e.target.value })} />
              </div>
              <div>
                <label className="label !mb-2 !normal-case !tracking-normal">PAN No</label>
                <input className="input !h-14 !rounded-2xl !border-outline-variant/80 !bg-surface-container-low text-base" value={form.panNo} onChange={(e) => setForm({ ...form, panNo: e.target.value })} />
              </div>
            </div>

            <VehicleDetailsSection vehicles={ownerVehicles} onChange={setOwnerVehicles} />

            <div className="flex flex-col gap-3 border-t border-outline-variant/60 pt-5 sm:flex-row sm:justify-end">
              {flat.owner?.id && flat.owner?.email && flat.owner?.phone && (
                <button type="button" className="btn-outline h-12 rounded-[22px]" disabled={resetOwnerLoginMutation.isPending} onClick={() => resetOwnerLoginMutation.mutate()}>
                  {resetOwnerLoginMutation.isPending ? 'Resetting...' : 'Reset Login'}
                </button>
              )}
              <button type="submit" className="btn-primary h-12 rounded-[22px]" disabled={ownerMutation.isPending}>
                <Save className="h-4 w-4" />
                {ownerMutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleTenantSubmit} className="space-y-5">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ResidentInput label="Full Name" icon={<User className="h-5 w-5" />}>
                <input className="input !h-14 !rounded-2xl !border-outline-variant/80 !bg-surface-container-low pl-12 text-base" value={tenantForm.name} onChange={(e) => setTenantForm({ ...tenantForm, name: e.target.value })} required />
              </ResidentInput>
              <ResidentInput label="Phone Number" icon={<Phone className="h-5 w-5" />}>
                <input className="input !h-14 !rounded-2xl !border-outline-variant/80 !bg-surface-container-low pl-12 text-base" value={tenantForm.phone} onChange={(e) => setTenantForm({ ...tenantForm, phone: e.target.value })} inputMode="numeric" maxLength={10} placeholder="95236 55556" required />
              </ResidentInput>
            </div>
            <ResidentInput label="Email Address" icon={<Mail className="h-5 w-5" />}>
              <input type="email" className="input !h-14 !rounded-2xl !border-outline-variant/80 !bg-surface-container-low pl-12 text-base" value={tenantForm.email} onChange={(e) => setTenantForm({ ...tenantForm, email: e.target.value })} placeholder="name@example.com" />
            </ResidentInput>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label !mb-2 !normal-case !tracking-normal">Lease Start</label>
                <input className="input !h-14 !rounded-2xl !border-outline-variant/80 !bg-surface-container-low text-base" type="date" value={tenantForm.leaseStart} onChange={(e) => setTenantForm({ ...tenantForm, leaseStart: e.target.value })} required />
              </div>
              <div>
                <label className="label !mb-2 !normal-case !tracking-normal">Lease End</label>
                <input className="input !h-14 !rounded-2xl !border-outline-variant/80 !bg-surface-container-low text-base" type="date" value={tenantForm.leaseEnd} onChange={(e) => setTenantForm({ ...tenantForm, leaseEnd: e.target.value })} min={tenantForm.leaseStart || undefined} />
              </div>
              <div>
                <label className="label !mb-2 !normal-case !tracking-normal">Rent Amount</label>
                <input className="input !h-14 !rounded-2xl !border-outline-variant/80 !bg-surface-container-low text-base" type="number" min="0" value={tenantForm.rentAmount} onChange={(e) => setTenantForm({ ...tenantForm, rentAmount: e.target.value })} />
              </div>
              <div>
                <label className="label !mb-2 !normal-case !tracking-normal">Deposit</label>
                <input className="input !h-14 !rounded-2xl !border-outline-variant/80 !bg-surface-container-low text-base" type="number" min="0" value={tenantForm.deposit} onChange={(e) => setTenantForm({ ...tenantForm, deposit: e.target.value })} />
              </div>
            </div>

            <VehicleDetailsSection vehicles={tenantVehicles} onChange={setTenantVehicles} />

            {isAdminManager && flat.tenant?.id && flat.tenant?.isActive ? (
              <button type="button" className="flex items-center gap-2 px-1 text-base font-semibold text-error" onClick={() => setShowTenantRemoveConfirm((value) => !value)}>
                <TrashGlyph />
                Remove Resident from Hub
              </button>
            ) : null}

            {isAdminManager && flat.tenant?.id && flat.tenant?.isActive && showTenantRemoveConfirm && (
              <div className="rounded-[24px] border border-error/20 bg-error-container/40 p-4 space-y-3">
                <p className="text-sm font-semibold text-on-surface">Remove active tenant</p>
                <p className="text-xs text-on-surface-variant">This will remove tenant access for the current society and send an email to the removed tenant.</p>
                <textarea className="input min-h-[100px] !rounded-2xl" value={tenantRemovalReason} onChange={(event) => setTenantRemovalReason(event.target.value)} placeholder="Explain why this tenant is being removed." />
                <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                  <button type="button" className="btn-outline h-12 rounded-[22px]" onClick={() => { setShowTenantRemoveConfirm(false); setTenantRemovalReason(''); }} disabled={removeTenantMutation.isPending}>
                    <X className="h-4 w-4" />
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-danger h-12 rounded-[22px]"
                    disabled={removeTenantMutation.isPending || !tenantRemovalReason.trim()}
                    onClick={() => removeTenantMutation.mutate({ tenantId: flat.tenant!.id, reason: tenantRemovalReason.trim() }, {
                      onSuccess: () => {
                        toast.success('Tenant removed');
                        setShowTenantRemoveConfirm(false);
                        setTenantRemovalReason('');
                        onSaved();
                      },
                      onError: (e: any) => {
                        toast.error(e.response?.data?.error || 'Failed to remove tenant');
                      }
                    })}
                  >
                    {removeTenantMutation.isPending ? 'Removing...' : 'Confirm Remove'}
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-3 border-t border-outline-variant/60 pt-5 sm:flex-row sm:justify-end">
              <button type="button" className="btn-outline h-12 rounded-[22px]" onClick={resetTenantForm}>
                Cancel
              </button>
              <button type="submit" className="btn-primary h-12 rounded-[22px]" disabled={tenantMutation.isPending}>
                <Save className="h-4 w-4" />
                {tenantMutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        )}
      </section>
      </div>
    </div>
  );
}

function ResidentInput({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="label !mb-2 !normal-case !tracking-normal">{label}</label>
      <div className="relative">
        <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-outline">{icon}</div>
        {children}
      </div>
    </div>
  );
}

function VehicleDetailsSection({
  vehicles,
  onChange,
}: {
  vehicles: VehicleDraft[];
  onChange: (vehicles: VehicleDraft[]) => void;
}) {
  const updateVehicle = (vehicleId: string, key: 'type' | 'registrationNumber', value: string) => {
    onChange(
      vehicles.map((vehicle) => (
        vehicle.id === vehicleId
          ? {
              ...vehicle,
              [key]: value,
            }
          : vehicle
      )) as VehicleDraft[],
    );
  };

  const addVehicle = () => {
    onChange([...vehicles, createVehicleDraft()]);
  };

  const removeVehicle = (vehicleId: string) => {
    onChange(vehicles.filter((vehicle) => vehicle.id !== vehicleId));
  };

  return (
    <section className="space-y-3 rounded-[24px] border border-outline-variant/70 bg-white p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.12em] text-on-surface-variant">Vehicle Details</p>
          <p className="mt-1 text-sm text-on-surface-variant">Add any number of registered vehicles for this resident.</p>
        </div>
        <button type="button" className="btn-outline h-11 rounded-[20px] px-4" onClick={addVehicle}>
          <Plus className="h-4 w-4" />
          Add Vehicle
        </button>
      </div>

      {vehicles.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-outline-variant/80 bg-surface-container-low px-4 py-6 text-sm text-on-surface-variant">
          No vehicles added yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-[20px] border border-outline-variant/70">
          <div className="hidden grid-cols-[180px_minmax(0,1fr)_56px] gap-3 bg-surface-container-low px-4 py-3 text-xs font-bold uppercase tracking-[0.12em] text-on-surface-variant sm:grid">
            <span>Vehicle Type</span>
            <span>Registration Number</span>
            <span className="text-center">Remove</span>
          </div>
          <div className="divide-y divide-outline-variant/60 bg-surface-container-lowest">
            {vehicles.map((vehicle) => (
              <div key={vehicle.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[180px_minmax(0,1fr)_56px] sm:items-center">
                <div>
                  <label className="label !mb-2 !normal-case !tracking-normal sm:hidden">Vehicle Type</label>
                  <div className="relative">
                    <select
                      className="input appearance-none !h-14 !rounded-2xl !border-outline-variant/80 !bg-surface-container-low pr-10 text-base"
                      value={vehicle.type}
                      onChange={(event) => updateVehicle(vehicle.id, 'type', event.target.value)}
                    >
                      {VEHICLE_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <UserRound className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-outline opacity-0" />
                  </div>
                </div>
                <div>
                  <label className="label !mb-2 !normal-case !tracking-normal sm:hidden">Registration Number</label>
                  <input
                    className="input !h-14 !rounded-2xl !border-outline-variant/80 !bg-surface-container-low text-base uppercase"
                    value={vehicle.registrationNumber}
                    onChange={(event) => updateVehicle(vehicle.id, 'registrationNumber', event.target.value.toUpperCase())}
                    placeholder="TN 01 AB 1234"
                  />
                </div>
                <div className="flex items-center justify-end sm:justify-center">
                  <button
                    type="button"
                    className="flex h-11 w-11 items-center justify-center rounded-2xl border border-outline-variant/80 bg-white text-on-surface-variant transition-colors hover:border-error/30 hover:text-error"
                    onClick={() => removeVehicle(vehicle.id)}
                    aria-label="Remove vehicle"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function TrashGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}
