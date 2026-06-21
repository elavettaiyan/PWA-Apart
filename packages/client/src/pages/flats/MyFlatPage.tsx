import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Building2,
  Camera,
  Calendar,
  CarFront,
  CirclePlus,
  ExternalLink,
  FileText,
  Home,
  Info,
  Loader2,
  Mail,
  PawPrint,
  Pencil,
  Phone,
  Trash2,
  User,
  UserRound,
  Users,
  BriefcaseBusiness,
  Bike,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { getApiBaseUrl } from '../../lib/platform';
import {
  cn,
  formatCurrency,
  formatDate,
  getMonthName,
  getStatusColor,
  isValidEmailAddress,
  isValidIndianMobileNumber,
  normalizeEmail,
  normalizeIndianMobileNumber,
} from '../../lib/utils';
import { PageLoader } from '../../components/ui/Loader';
import { useAuthStore } from '../../store/authStore';
import { isOwnerViewActive } from '../../lib/ownerView';
import type {
  Flat,
  MaintenanceBill,
  Owner,
  PaymentMethod,
  ResidentVehicle,
  SocietySettings,
  Tenant,
  VehicleType,
} from '../../types';

const SHELL_CARD_CLASS = 'rounded-[22px] border border-slate-200/80 bg-white shadow-[0_4px_12px_rgba(15,23,42,0.04)]';
const FIELD_LABEL_CLASS = 'text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400';
const FIELD_VALUE_CLASS = 'text-[15px] font-semibold text-slate-900';

type VehicleDraft = {
  id: string;
  type: VehicleType;
  registrationNumber: string;
};

type ResidentProfileFormState = {
  phone: string;
  occupation: string;
  householdAdults: string;
  householdKids: string;
  householdSeniors: string;
  pets: string;
};

type ResidentLike = {
  name: string;
  phone?: string;
  email?: string | null;
  occupation?: string | null;
  householdAdults?: number | null;
  householdKids?: number | null;
  householdSeniors?: number | null;
  pets?: string | null;
  carNumber?: string | null;
  twoWheelerNumber?: string | null;
  vehicles?: ResidentVehicle[];
};

type TenantCardResident = Tenant & {
  leaseStartDate?: string;
  leaseEndDate?: string;
};

const VEHICLE_TYPE_OPTIONS: Array<{ value: VehicleType; label: string }> = [
  { value: 'FOUR_WHEELER', label: 'Car' },
  { value: 'TWO_WHEELER', label: 'Two Wheeler' },
  { value: 'THREE_WHEELER', label: 'Three Wheeler' },
];

export default function MyFlatPage() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const { user, viewMode, setUser } = useAuthStore();
  const isOwner = user?.role === 'OWNER' || isOwnerViewActive(user, viewMode);
  const residentRelation = !isOwner && user?.flatRelation === 'TENANT' ? 'TENANT' : 'OWNER';
  const activeSocietyId = user?.activeSocietyId || user?.societyId || '';

  const { data: flat, isLoading, error } = useQuery<Flat>({
    queryKey: ['my-flat', activeSocietyId || 'no-society', selectedYear],
    queryFn: async () => {
      const searchParams = new URLSearchParams({ year: String(selectedYear) });
      if (activeSocietyId) {
        searchParams.set('societyId', activeSocietyId);
      }
      return (await api.get(`/flats/my-flat?${searchParams.toString()}`)).data;
    },
    enabled: !!user,
  });

  const { data: societySettings } = useQuery<SocietySettings>({
    queryKey: ['society-settings', activeSocietyId || 'no-society'],
    queryFn: async () => (await api.get('/settings/society-settings')).data,
    enabled: !!activeSocietyId,
  });

  const yearOptions = useMemo(() => Array.from({ length: 6 }, (_, index) => currentYear - index), [currentYear]);
  const activeOwner = flat?.owner?.isActive === false ? null : flat?.owner || null;
  const supportsPets = societySettings?.supportsPets === true;
  const canEditOwnerProfile = residentRelation === 'OWNER';
  const canEditTenantProfile = residentRelation === 'TENANT';
  const isAdminWithoutFlat = user?.role === 'ADMIN';

  if (isLoading) return <PageLoader />;

  if (error || !flat) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-on-surface-variant">
        <Building2 className="mb-4 h-12 w-12 text-outline/40" />
        <h2 className="text-lg font-semibold text-on-surface-variant">No Flat Found</h2>
        <p className="mt-1 text-sm">
          {isAdminWithoutFlat
            ? 'Your admin account is not linked to any flat yet. Configure it from Flats & Residents.'
            : 'Your account is not linked to any flat. Contact your admin.'}
        </p>
        {isAdminWithoutFlat ? (
          <Link
            to="/flats"
            className={cn(
              'mt-4 inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-slate-900 transition hover:-translate-y-0.5 hover:border-primary/25 hover:text-primary hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)]',
              SHELL_CARD_CLASS,
            )}
          >
            Open Flats & Residents
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-6 md:space-y-7">
      <div>
        <h1 className="page-title">My Flat</h1>
        <p className="mt-1 text-sm text-on-surface-variant">View your unit details, resident records, and yearly billing summary.</p>
      </div>

      <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
        <FlatDetailsCard flat={flat} />
        {activeOwner ? (
          <OwnerDetailsCard
            owner={activeOwner}
            supportsPets={supportsPets}
            canSelfEdit={canEditOwnerProfile}
            onPhoneUpdated={(phone) => {
              if (user) {
                setUser({ ...user, phone });
              }
            }}
          />
        ) : null}
      </div>

      {flat.tenant && flat.tenant.isActive !== false ? (
        <TenantDetailsCard
          tenant={flat.tenant as TenantCardResident}
          isOwner={isOwner}
          allowSelfProfileEdit={canEditTenantProfile}
          supportsPets={supportsPets}
        />
      ) : isOwner ? (
        <AddTenantCard />
      ) : null}

      <BillSummarySection flat={flat} selectedYear={selectedYear} setSelectedYear={setSelectedYear} yearOptions={yearOptions} />
    </div>
  );
}

function FlatDetailsCard({ flat }: { flat: Flat }) {
  return (
    <section className={cn(SHELL_CARD_CLASS, 'p-6 md:p-7')}>
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
          <Home className="h-5 w-5" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Flat Details</h2>
      </div>

      <div className="space-y-0">
        <FlatRow label="Flat Number" value={flat.flatNumber} />
        <FlatRow label="Block" value={flat.block?.name || '—'} />
        <FlatRow label="Society" value={flat.block?.society?.name || '—'} />
        <FlatRow label="Floor" value={String(flat.floor)} />
        <FlatRow label="BHK Type" value={flat.type.replace(/_/g, ' ')} />
        <FlatRow label="Area" value={flat.areaSqFt ? `${flat.areaSqFt} sq.ft.` : '—'} />
        <FlatRow label="Parking" value={getParkingLabel(flat.parkingType, flat.parkingSlotNumber)} />
        <FlatRow label="Status" value={<OccupiedBadge occupied={flat.isOccupied} />} last />
      </div>
    </section>
  );
}

function FlatRow({ label, value, last = false }: { label: string; value: React.ReactNode; last?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <span className="text-[15px] text-slate-500">{label}</span>
      <div className="text-right text-[15px] font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function OccupiedBadge({ occupied }: { occupied: boolean }) {
  return occupied ? (
    <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-700">
      <span className="h-2 w-2 rounded-full bg-emerald-600" />
      Occupied
    </span>
  ) : (
    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">
      <span className="h-2 w-2 rounded-full bg-slate-500" />
      Vacant
    </span>
  );
}

function OwnerDetailsCard({
  owner,
  supportsPets,
  canSelfEdit,
  onPhoneUpdated,
}: {
  owner: Owner;
  supportsPets: boolean;
  canSelfEdit: boolean;
  onPhoneUpdated: (phone: string) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => createResidentProfileForm(owner));
  const [vehicles, setVehicles] = useState<VehicleDraft[]>(() => getVehicleDrafts(owner.vehicles, owner));
  const [activeEditor, setActiveEditor] = useState<null | 'occupation' | 'phone' | 'household' | 'vehicles' | 'pets'>(null);
  
  const photoMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('photo', file);
      formData.append('relation', 'OWNER');
      return (await api.patch('/flats/my-flat/resident/photo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })).data;
    },
    onSuccess: () => {
      toast.success('Profile photo updated');
      queryClient.invalidateQueries({ queryKey: ['my-flat'] });
    },
    onError: (error: any) => toast.error(getApiErrorMessage(error, 'Failed to update profile photo')),
  });
  useEffect(() => {
    setForm(createResidentProfileForm(owner));
    setVehicles(getVehicleDrafts(owner.vehicles, owner));
    setActiveEditor(null);
  }, [owner]);

  const mutation = useMutation({
    mutationFn: async () => {
      const normalizedPhone = normalizeIndianMobileNumber(form.phone);
      if (!isValidIndianMobileNumber(normalizedPhone)) {
        throw new Error('Phone number must be a valid 10-digit Indian mobile number.');
      }

      return (await api.put('/flats/my-flat/resident', {
        relation: 'OWNER',
        phone: normalizedPhone,
        occupation: form.occupation.trim() || null,
        householdAdults: parseOptionalCount(form.householdAdults),
        householdKids: parseOptionalCount(form.householdKids),
        householdSeniors: parseOptionalCount(form.householdSeniors),
        pets: supportsPets ? form.pets.trim() || null : null,
        vehicles: normalizeVehicleDrafts(vehicles),
      })).data;
    },
    onSuccess: () => {
      onPhoneUpdated(normalizeIndianMobileNumber(form.phone));
      toast.success('Owner details updated');
      setActiveEditor(null);
      queryClient.invalidateQueries({ queryKey: ['my-flat'] });
    },
    onError: (error: any) => {
      const message = error instanceof Error ? error.message : getApiErrorMessage(error, 'Failed to update resident details');
      toast.error(message);
    },
  });

  return (
    <section className={cn(SHELL_CARD_CLASS, 'p-6 md:p-7')}>
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
          <User className="h-5 w-5" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Owner</h2>
      </div>

      <div className="mb-6 flex flex-col items-center gap-4 md:mb-7">
        <ResidentPhotoField
          name={owner.name}
          photoUrl={owner.photoUrl}
          canEdit={canSelfEdit}
          isUploading={photoMutation.isPending}
          onSelectFile={(file) => photoMutation.mutate(file)}
        />
      </div>

      <div className="space-y-5">
        <StaticField label="Name" value={owner.name} />

        <EditableTextField
          label="Occupation"
          icon={<BriefcaseBusiness className="h-4 w-4" />}
          value={form.occupation}
          displayValue={owner.occupation || '—'}
          canEdit={canSelfEdit}
          isEditing={activeEditor === 'occupation'}
          onStartEdit={() => setActiveEditor('occupation')}
          onCancelEdit={() => {
            setForm((current) => ({ ...current, occupation: owner.occupation || '' }));
            setActiveEditor(null);
          }}
          onSave={() => mutation.mutate()}
          isSaving={mutation.isPending}
          onChange={(value) => setForm((current) => ({ ...current, occupation: value }))}
        />

        <EditableTextField
          label="Phone"
          icon={<Phone className="h-4 w-4" />}
          value={form.phone}
          displayValue={owner.phone || '—'}
          canEdit={canSelfEdit}
          isEditing={activeEditor === 'phone'}
          onStartEdit={() => setActiveEditor('phone')}
          onCancelEdit={() => {
            setForm((current) => ({ ...current, phone: owner.phone || '' }));
            setActiveEditor(null);
          }}
          onSave={() => mutation.mutate()}
          isSaving={mutation.isPending}
          inputMode="numeric"
          maxLength={10}
          onChange={(value) => setForm((current) => ({ ...current, phone: value }))}
        />

        <StaticField label="Email" value={owner.email || '—'} icon={<Mail className="h-4 w-4" />} />

        <FamilyMembersField
          adults={form.householdAdults}
          kids={form.householdKids}
          seniors={form.householdSeniors}
          canEdit={canSelfEdit}
          isEditing={activeEditor === 'household'}
          onStartEdit={() => setActiveEditor('household')}
          onCancelEdit={() => {
            setForm((current) => ({
              ...current,
              householdAdults: owner.householdAdults != null ? String(owner.householdAdults) : '',
              householdKids: owner.householdKids != null ? String(owner.householdKids) : '',
              householdSeniors: owner.householdSeniors != null ? String(owner.householdSeniors) : '',
            }));
            setActiveEditor(null);
          }}
          onSave={() => mutation.mutate()}
          isSaving={mutation.isPending}
          onAdultsChange={(value) => setForm((current) => ({ ...current, householdAdults: value }))}
          onKidsChange={(value) => setForm((current) => ({ ...current, householdKids: value }))}
          onSeniorsChange={(value) => setForm((current) => ({ ...current, householdSeniors: value }))}
        />

        <VehicleDetailsField
          vehicles={vehicles}
          canEdit={canSelfEdit}
          isEditing={activeEditor === 'vehicles'}
          onStartEdit={() => setActiveEditor('vehicles')}
          onCancelEdit={() => {
            setVehicles(getVehicleDrafts(owner.vehicles, owner));
            setActiveEditor(null);
          }}
          onSave={() => mutation.mutate()}
          isSaving={mutation.isPending}
          onChange={setVehicles}
        />

        {supportsPets ? (
          <EditableTextField
            label="Pets"
            icon={<PawPrint className="h-4 w-4" />}
            value={form.pets}
            displayValue={owner.pets || '—'}
            canEdit={canSelfEdit}
            isEditing={activeEditor === 'pets'}
            onStartEdit={() => setActiveEditor('pets')}
            onCancelEdit={() => {
              setForm((current) => ({ ...current, pets: owner.pets || '' }));
              setActiveEditor(null);
            }}
            onSave={() => mutation.mutate()}
            isSaving={mutation.isPending}
            onChange={(value) => setForm((current) => ({ ...current, pets: value }))}
          />
        ) : null}
      </div>
    </section>
  );
}

function StaticField({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className={FIELD_LABEL_CLASS}>{label}</p>
      <div className="flex items-center gap-2 text-slate-900">
        {icon ? <span className="text-slate-400">{icon}</span> : null}
        <p className={FIELD_VALUE_CLASS}>{value}</p>
      </div>
    </div>
  );
}

function EditableTextField({
  label,
  value,
  displayValue,
  canEdit,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSave,
  isSaving = false,
  onChange,
  icon,
  inputMode,
  maxLength,
}: {
  label: string;
  value: string;
  displayValue: string;
  canEdit: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave?: () => void;
  isSaving?: boolean;
  onChange: (value: string) => void;
  icon?: React.ReactNode;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  maxLength?: number;
}) {
  return (
    <div className="space-y-1.5">
      <p className={FIELD_LABEL_CLASS}>{label}</p>
      {canEdit && isEditing ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          <div className="flex items-center gap-3">
            {icon ? <span className="text-slate-400">{icon}</span> : null}
            <input
              className="w-full border-0 bg-transparent p-0 text-[15px] font-semibold text-slate-900 placeholder:text-slate-300 focus:ring-0"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              inputMode={inputMode}
              maxLength={maxLength}
              placeholder="Optional"
            />
          </div>
          {onSave ? (
            <div className="flex items-center justify-end gap-3">
              <button type="button" className="text-xs font-semibold text-slate-500" onClick={onCancelEdit}>Cancel</button>
              <button type="button" className="btn-primary px-4 py-2 text-sm" disabled={isSaving} onClick={onSave}>
                {isSaving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</> : 'Save'}
              </button>
            </div>
          ) : (
            <div className="flex justify-end">
              <button type="button" className="text-xs font-semibold text-slate-500" onClick={onCancelEdit}>Cancel</button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-slate-900">
            {icon ? <span className="text-slate-400">{icon}</span> : null}
            <p className={FIELD_VALUE_CLASS}>{displayValue}</p>
          </div>
          {canEdit ? (
            <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" onClick={onStartEdit}>
              <Pencil className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function FamilyMembersField({
  adults,
  kids,
  seniors,
  canEdit,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSave,
  isSaving = false,
  onAdultsChange,
  onKidsChange,
  onSeniorsChange,
}: {
  adults: string;
  kids: string;
  seniors: string;
  canEdit: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave?: () => void;
  isSaving?: boolean;
  onAdultsChange: (value: string) => void;
  onKidsChange: (value: string) => void;
  onSeniorsChange: (value: string) => void;
}) {
  const summary = [
    adults ? `${adults} Adults` : null,
    kids ? `${kids} Kid${kids === '1' ? '' : 's'}` : null,
    seniors ? `${seniors} Senior` : null,
  ].filter(Boolean).join('   ');

  return (
    <div className="space-y-1.5">
      <p className={FIELD_LABEL_CLASS}>Family Members</p>
      {canEdit && isEditing ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
          <div className="grid gap-3 sm:grid-cols-3">
            <CountInput label="Adults" value={adults} onChange={onAdultsChange} />
            <CountInput label="Kids" value={kids} onChange={onKidsChange} />
            <CountInput label="Senior" value={seniors} onChange={onSeniorsChange} />
          </div>
          <div className="flex items-center justify-end gap-3">
            <button type="button" className="text-xs font-semibold text-slate-500" onClick={onCancelEdit}>Cancel</button>
            {onSave ? (
              <button type="button" className="btn-primary px-4 py-2 text-sm" disabled={isSaving} onClick={onSave}>
                {isSaving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</> : 'Save'}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4 text-slate-900">
            <span className="inline-flex items-center gap-2"><Users className="h-4 w-4 text-slate-400" /> <span className={FIELD_VALUE_CLASS}>{summary || '—'}</span></span>
          </div>
          {canEdit ? (
            <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" onClick={onStartEdit}>
              <Pencil className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function CountInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</span>
      <input
        className="input !h-11 !rounded-xl"
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/[^0-9]/g, ''))}
        inputMode="numeric"
        placeholder="0"
      />
    </label>
  );
}

function VehicleDetailsField({
  vehicles,
  canEdit,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSave,
  isSaving = false,
  onChange,
}: {
  vehicles: VehicleDraft[];
  canEdit: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave?: () => void;
  isSaving?: boolean;
  onChange: (vehicles: VehicleDraft[]) => void;
}) {
  const groupedVehicles = getVehicleDisplayGroups(vehicles);

  const updateVehicle = (vehicleId: string, key: 'type' | 'registrationNumber', value: string) => {
    onChange(vehicles.map((vehicle) => (vehicle.id === vehicleId ? { ...vehicle, [key]: value } : vehicle)));
  };

  const addVehicle = (type?: VehicleType) => {
    onChange([
      ...vehicles,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: type || 'FOUR_WHEELER',
        registrationNumber: '',
      },
    ]);
  };

  const removeVehicle = (vehicleId: string) => {
    onChange(vehicles.filter((vehicle) => vehicle.id !== vehicleId));
  };

  return (
    <div className="space-y-1.5">
      <p className={FIELD_LABEL_CLASS}>Vehicle Details</p>
      {canEdit && isEditing ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
          {vehicles.length === 0 ? (
            <p className="text-sm text-slate-400">No vehicles registered yet.</p>
          ) : (
            vehicles.map((vehicle) => (
              <div key={vehicle.id} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[140px_minmax(0,1fr)_44px] sm:items-center">
                <select className="input !h-11 !rounded-xl" value={vehicle.type} onChange={(event) => updateVehicle(vehicle.id, 'type', event.target.value)}>
                  {VEHICLE_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <input
                  className="input !h-11 !rounded-xl uppercase"
                  value={vehicle.registrationNumber}
                  onChange={(event) => updateVehicle(vehicle.id, 'registrationNumber', event.target.value.toUpperCase())}
                  placeholder="TN 01 AB 1234"
                />
                <button type="button" className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:text-error" onClick={() => removeVehicle(vehicle.id)}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
          <div className="flex flex-wrap gap-3">
            <button type="button" className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700" onClick={() => addVehicle('FOUR_WHEELER')}>
              <CirclePlus className="h-4 w-4" /> Add Car
            </button>
            <button type="button" className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700" onClick={() => addVehicle('TWO_WHEELER')}>
              <CirclePlus className="h-4 w-4" /> Add Two Wheeler
            </button>
          </div>
          <div className="flex items-center justify-end gap-3">
            <button type="button" className="text-xs font-semibold text-slate-500" onClick={onCancelEdit}>Cancel</button>
            {onSave ? (
              <button type="button" className="btn-primary px-4 py-2 text-sm" disabled={isSaving} onClick={onSave}>
                {isSaving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</> : 'Save'}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <VehicleDisplayRow icon={<CarFront className="h-4 w-4" />} label={groupedVehicles.car || '—'} muted={!groupedVehicles.car} />
              <VehicleDisplayRow icon={<Bike className="h-4 w-4" />} label={groupedVehicles.twoWheeler || 'No two wheeler registered'} muted={!groupedVehicles.twoWheeler} />
            </div>
            {canEdit ? (
              <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" onClick={onStartEdit}>
                <Pencil className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function VehicleDisplayRow({ icon, label, muted = false }: { icon: React.ReactNode; label: string; muted?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2', muted ? 'text-slate-400 italic' : 'text-slate-900')}>
      <span className="text-slate-400">{icon}</span>
      <span className={cn(FIELD_VALUE_CLASS, muted && 'text-slate-400 italic font-medium')}>{label}</span>
    </div>
  );
}

function TenantDetailsCard({
  tenant,
  isOwner,
  allowSelfProfileEdit,
  supportsPets,
}: {
  tenant: TenantCardResident;
  isOwner: boolean;
  allowSelfProfileEdit: boolean;
  supportsPets: boolean;
}) {
  const queryClient = useQueryClient();
  const [editingTenant, setEditingTenant] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [profileForm, setProfileForm] = useState(() => createResidentProfileForm(tenant));
  const [vehicles, setVehicles] = useState<VehicleDraft[]>(() => getVehicleDrafts(tenant.vehicles, tenant));
  const [activeProfileEditor, setActiveProfileEditor] = useState<null | 'occupation' | 'household' | 'vehicles' | 'pets'>(null);
  
  const photoMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('photo', file);
      formData.append('relation', 'TENANT');
      return (await api.patch('/flats/my-flat/resident/photo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })).data;
    },
    onSuccess: () => {
      toast.success('Profile photo updated');
      queryClient.invalidateQueries({ queryKey: ['my-flat'] });
    },
    onError: (error: any) => toast.error(getApiErrorMessage(error, 'Failed to update profile photo')),
  });

  useEffect(() => {
    setProfileForm(createResidentProfileForm(tenant));
    setVehicles(getVehicleDrafts(tenant.vehicles, tenant));
    setActiveProfileEditor(null);
  }, [tenant]);

  const updateMutation = useMutation({
    mutationFn: (data: TenantFormData) =>
      data.agreementDocument
        ? api.put('/flats/my-flat/tenant', buildTenantDocumentFormData(data), {
            headers: { 'Content-Type': 'multipart/form-data' },
          })
        : api.put('/flats/my-flat/tenant', {
            name: data.name,
            phone: data.phone,
            email: data.email || undefined,
            leaseStart: data.leaseStart || undefined,
            leaseEnd: data.leaseEnd || undefined,
            rentAmount: data.rentAmount !== '' ? data.rentAmount : undefined,
            deposit: data.deposit !== '' ? data.deposit : undefined,
          }),
    onSuccess: () => {
      toast.success('Tenant updated');
      setEditingTenant(false);
      queryClient.invalidateQueries({ queryKey: ['my-flat'] });
    },
    onError: (e: any) => toast.error(getApiErrorMessage(e, 'Failed to update tenant')),
  });

  const removeMutation = useMutation({
    mutationFn: () => api.delete('/flats/my-flat/tenant'),
    onSuccess: () => {
      toast.success('Tenant removed');
      setShowRemoveConfirm(false);
      queryClient.invalidateQueries({ queryKey: ['my-flat'] });
    },
    onError: (e: any) => toast.error(getApiErrorMessage(e, 'Failed to remove tenant')),
  });

  const residentMutation = useMutation({
    mutationFn: async () => {
      const response = await api.put('/flats/my-flat/resident', {
        relation: 'TENANT',
        occupation: profileForm.occupation.trim() || null,
        householdAdults: parseOptionalCount(profileForm.householdAdults),
        householdKids: parseOptionalCount(profileForm.householdKids),
        householdSeniors: parseOptionalCount(profileForm.householdSeniors),
        pets: supportsPets ? profileForm.pets.trim() || null : null,
        vehicles: normalizeVehicleDrafts(vehicles),
      });

      return {
        status: response.status,
        data: response.data,
      };
    },
    onSuccess: (response) => {
      if (response.status === 202 || response.data?.status === 'PENDING') {
        toast.success(response.data?.message || 'Resident profile change submitted for approval');
        setActiveProfileEditor(null);
        queryClient.invalidateQueries({ queryKey: ['approvals'] });
        return;
      }

      toast.success('Resident details updated');
      setActiveProfileEditor(null);
      queryClient.invalidateQueries({ queryKey: ['my-flat'] });
    },
    onError: (error: any) => toast.error(getApiErrorMessage(error, 'Failed to update resident details')),
  });

  const toDateStr = (dateValue: string | null | undefined) => (dateValue ? new Date(dateValue).toISOString().split('T')[0] : '');

  if (editingTenant) {
    return (
      <section className={cn(SHELL_CARD_CLASS, 'p-6 md:p-7')}>
        <h2 className="mb-4 text-2xl font-bold tracking-tight text-slate-900">Edit Tenant</h2>
        <TenantForm
          initial={{
            name: tenant.name || '',
            phone: tenant.phone || '',
            email: tenant.email || '',
            leaseStart: toDateStr(tenant.leaseStart || tenant.leaseStartDate),
            leaseEnd: toDateStr(tenant.leaseEnd || tenant.leaseEndDate),
            rentAmount: tenant.rentAmount?.toString() || '',
            deposit: tenant.deposit?.toString() || '',
            agreementDocument: null,
          }}
          onSubmit={(data) => updateMutation.mutate(data)}
          onCancel={() => setEditingTenant(false)}
          isPending={updateMutation.isPending}
          submitLabel="Save Changes"
          existingAgreementDocumentUrl={tenant.agreementDocumentUrl}
        />
      </section>
    );
  }

  return (
    <section className={cn(SHELL_CARD_CLASS, 'p-6 md:p-7')}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Tenant</h2>
        {isOwner ? (
          <div className="flex items-center gap-2">
            <button type="button" className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700" onClick={() => setEditingTenant(true)}>
              Edit
            </button>
            <button type="button" className="rounded-xl border border-red-200 px-3 py-2 text-sm font-semibold text-red-600" onClick={() => setShowRemoveConfirm(true)}>
              Remove
            </button>
          </div>
        ) : null}
      </div>
      
      <div className="mb-6 flex flex-col items-center gap-4 md:mb-7">
        <ResidentPhotoField
          name={tenant.name}
          photoUrl={tenant.photoUrl}
          canEdit={allowSelfProfileEdit}
          isUploading={photoMutation.isPending}
          onSelectFile={(file) => photoMutation.mutate(file)}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <StaticField label="Name" value={tenant.name} icon={<User className="h-4 w-4" />} />
        <StaticField label="Email" value={tenant.email || '—'} icon={<Mail className="h-4 w-4" />} />
        <StaticField label="Phone" value={tenant.phone || '—'} icon={<Phone className="h-4 w-4" />} />
        <StaticField label="Lease Start" value={formatOptionalDate(tenant.leaseStart || tenant.leaseStartDate)} icon={<Calendar className="h-4 w-4" />} />
        <StaticField label="Lease End" value={formatOptionalDate(tenant.leaseEnd || tenant.leaseEndDate)} icon={<Calendar className="h-4 w-4" />} />
        <StaticField label="Rent" value={tenant.rentAmount ? formatCurrency(tenant.rentAmount) : '—'} />
      </div>
      {tenant.agreementDocumentUrl ? (
        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <a
            href={resolveUploadedFileUrl(tenant.agreementDocumentUrl) || undefined}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline"
          >
            <FileText className="h-4 w-4" />
            View agreement document
          </a>
        </div>
      ) : null}
      
      {supportsPets ? (
        <div className="mt-5 border-t border-slate-200 pt-5">
          <EditableTextField
            label="Pets"
            icon={<PawPrint className="h-4 w-4" />}
            value={profileForm.pets}
            displayValue={tenant.pets || '—'}
            canEdit={allowSelfProfileEdit}
            isEditing={activeProfileEditor === 'pets'}
            onStartEdit={() => setActiveProfileEditor('pets')}
            onCancelEdit={() => {
              setProfileForm((current) => ({ ...current, pets: tenant.pets || '' }));
              setActiveProfileEditor(null);
            }}
            onChange={(value) => setProfileForm((current) => ({ ...current, pets: value }))}
          />
        </div>
      ) : null}

      {allowSelfProfileEdit ? (
        <div className="mt-6 space-y-5 border-t border-slate-200 pt-5">
          <EditableTextField
            label="Occupation"
            icon={<BriefcaseBusiness className="h-4 w-4" />}
            value={profileForm.occupation}
            displayValue={tenant.occupation || '—'}
            canEdit
            isEditing={activeProfileEditor === 'occupation'}
            onStartEdit={() => setActiveProfileEditor('occupation')}
            onCancelEdit={() => {
              setProfileForm((current) => ({ ...current, occupation: tenant.occupation || '' }));
              setActiveProfileEditor(null);
            }}
            onChange={(value) => setProfileForm((current) => ({ ...current, occupation: value }))}
          />

          <FamilyMembersField
            adults={profileForm.householdAdults}
            kids={profileForm.householdKids}
            seniors={profileForm.householdSeniors}
            canEdit
            isEditing={activeProfileEditor === 'household'}
            onStartEdit={() => setActiveProfileEditor('household')}
            onCancelEdit={() => {
              setProfileForm((current) => ({
                ...current,
                householdAdults: tenant.householdAdults != null ? String(tenant.householdAdults) : '',
                householdKids: tenant.householdKids != null ? String(tenant.householdKids) : '',
                householdSeniors: tenant.householdSeniors != null ? String(tenant.householdSeniors) : '',
              }));
              setActiveProfileEditor(null);
            }}
            onAdultsChange={(value) => setProfileForm((current) => ({ ...current, householdAdults: value }))}
            onKidsChange={(value) => setProfileForm((current) => ({ ...current, householdKids: value }))}
            onSeniorsChange={(value) => setProfileForm((current) => ({ ...current, householdSeniors: value }))}
          />

          <VehicleDetailsField
            vehicles={vehicles}
            canEdit
            isEditing={activeProfileEditor === 'vehicles'}
            onStartEdit={() => setActiveProfileEditor('vehicles')}
            onCancelEdit={() => {
              setVehicles(getVehicleDrafts(tenant.vehicles, tenant));
              setActiveProfileEditor(null);
            }}
            onChange={setVehicles}
          />

          <button type="button" className="btn-primary w-full md:w-auto" disabled={residentMutation.isPending || !activeProfileEditor} onClick={() => residentMutation.mutate()}>
            {residentMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</> : 'Save Tenant Details'}
          </button>
        </div>
      ) : null}

      {showRemoveConfirm ? (
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="mb-3 text-sm font-medium text-red-700">Are you sure you want to remove this tenant?</p>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-danger btn-sm" disabled={removeMutation.isPending} onClick={() => removeMutation.mutate()}>
              {removeMutation.isPending ? 'Removing...' : 'Yes, Remove'}
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setShowRemoveConfirm(false)}>Cancel</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ResidentPhotoField({
  name,
  photoUrl,
  canEdit,
  isUploading,
  onSelectFile,
}: {
  name: string;
  photoUrl?: string | null;
  canEdit: boolean;
  isUploading: boolean;
  onSelectFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resolvedPhotoUrl = resolveUploadedFileUrl(photoUrl);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        {resolvedPhotoUrl ? (
          <img src={resolvedPhotoUrl} alt={name} className="h-24 w-24 rounded-full border-2 border-slate-200 object-cover" />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-slate-200 bg-slate-100 text-slate-500">
            <UserRound className="h-10 w-10" />
          </div>
        )}
        {canEdit ? (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                onSelectFile(file);
              }}
            />
            <button
              type="button"
              className="absolute bottom-0 right-0 flex h-10 w-10 items-center justify-center rounded-full bg-blue-700 text-white shadow-lg transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-blue-400"
              onClick={() => inputRef.current?.click()}
              disabled={isUploading}
            >
              {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            </button>
          </>
        ) : null}
      </div>
      {canEdit ? <p className="text-xs text-slate-500">Add from camera or photo library</p> : null}
    </div>
  );
}

interface TenantFormData {
  name: string;
  phone: string;
  email: string;
  leaseStart: string;
  leaseEnd: string;
  rentAmount: string;
  deposit: string;
  agreementDocument: File | null;
}

const emptyForm: TenantFormData = { name: '', phone: '', email: '', leaseStart: '', leaseEnd: '', rentAmount: '', deposit: '', agreementDocument: null };

function buildTenantDocumentFormData(data: TenantFormData) {
  const formData = new FormData();
  formData.append('name', data.name);
  formData.append('phone', data.phone);
  if (data.email) formData.append('email', data.email);
  if (data.leaseStart) formData.append('leaseStart', data.leaseStart);
  if (data.leaseEnd) formData.append('leaseEnd', data.leaseEnd);
  if (data.rentAmount !== '') formData.append('rentAmount', data.rentAmount);
  if (data.deposit !== '') formData.append('deposit', data.deposit);
  if (data.agreementDocument) formData.append('agreementDocument', data.agreementDocument);
  return formData;
}

function resolveUploadedFileUrl(value?: string | null) {
  if (!value) return null;
  return value.startsWith('data:') ? value : `${getApiBaseUrl().replace('/api', '')}${value}`;
}

function TenantForm({
  initial,
  onSubmit,
  onCancel,
  isPending,
  submitLabel,
  existingAgreementDocumentUrl,
  requireAgreementDocument = false,
  requireContactDetails = false,
}: {
  initial: TenantFormData;
  onSubmit: (data: TenantFormData) => void;
  onCancel: () => void;
  isPending: boolean;
  submitLabel: string;
  existingAgreementDocumentUrl?: string | null;
  requireAgreementDocument?: boolean;
  requireContactDetails?: boolean;
}) {
  const [form, setForm] = useState<TenantFormData>(initial);
  const set = (field: keyof TenantFormData, value: string) => setForm((current) => ({ ...current, [field]: value }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className={FIELD_LABEL_CLASS}>Name</span>
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Tenant name" />
        </label>
        <label className="space-y-1.5">
          <span className={FIELD_LABEL_CLASS}>Phone</span>
          <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="10-digit mobile" inputMode="numeric" maxLength={10} required={requireContactDetails} />
        </label>
        <label className="space-y-1.5">
          <span className={FIELD_LABEL_CLASS}>Email</span>
          <input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="tenant@email.com" required={requireContactDetails} />
        </label>
        <label className="space-y-1.5">
          <span className={FIELD_LABEL_CLASS}>Lease Start</span>
          <input className="input" type="date" value={form.leaseStart} onChange={(e) => set('leaseStart', e.target.value)} />
        </label>
        <label className="space-y-1.5">
          <span className={FIELD_LABEL_CLASS}>Lease End</span>
          <input className="input" type="date" value={form.leaseEnd} onChange={(e) => set('leaseEnd', e.target.value)} />
        </label>
        <label className="space-y-1.5">
          <span className={FIELD_LABEL_CLASS}>Rent Amount</span>
          <input className="input" type="number" value={form.rentAmount} onChange={(e) => set('rentAmount', e.target.value)} placeholder="Monthly rent" />
        </label>
        <label className="space-y-1.5">
          <span className={FIELD_LABEL_CLASS}>Deposit</span>
          <input className="input" type="number" value={form.deposit} onChange={(e) => set('deposit', e.target.value)} placeholder="Security deposit" />
        </label>
        <label className="space-y-1.5 sm:col-span-2">
          <span className={FIELD_LABEL_CLASS}>Agreement Document{requireAgreementDocument ? ' *' : ''}</span>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3 text-sm text-slate-600">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <div>
                  <p className="font-medium text-slate-900">{form.agreementDocument?.name || (existingAgreementDocumentUrl ? 'Current agreement document attached' : 'Upload tenant agreement document')}</p>
                  <p>{requireAgreementDocument ? 'Required for adding a tenant.' : 'Optional for tenant updates.'}</p>
                  <p className="mt-1">Accepted formats: PDF, JPG, PNG, WebP, HEIC, HEIF</p>
                </div>
              </div>
              <label className="btn-secondary cursor-pointer">
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
                  className="hidden"
                  onChange={(event) => setForm((current) => ({ ...current, agreementDocument: event.target.files?.[0] || null }))}
                />
                {form.agreementDocument || existingAgreementDocumentUrl ? 'Replace File' : 'Choose File'}
              </label>
            </div>
            {!form.agreementDocument && !existingAgreementDocumentUrl ? (
              <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-500">
                No agreement document selected yet.
              </div>
            ) : null}
            {existingAgreementDocumentUrl && !form.agreementDocument ? (
              <a
                href={resolveUploadedFileUrl(existingAgreementDocumentUrl) || undefined}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-blue-700 hover:underline"
              >
                <ExternalLink className="h-4 w-4" />
                View current agreement document
              </a>
            ) : null}
          </div>
        </label>
      </div>

      {form.email && form.phone ? (
        <div className="flex items-start gap-2 rounded-xl bg-slate-100 p-3 text-xs text-slate-700">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>A login account will be created for the tenant. Default password is the phone number.</span>
        </div>
      ) : null}

      <div className="flex items-center gap-3 pt-2">
        <button
          className="btn-primary"
          disabled={isPending || !form.name.trim() || !form.phone.trim() || (requireContactDetails && !form.email.trim())}
          onClick={() => {
            if (requireAgreementDocument && !form.agreementDocument && !existingAgreementDocumentUrl) {
              toast.error('Agreement document is required.');
              return;
            }

            const normalized = normalizeTenantForm(form, { requireContactDetails });
            if (!normalized) return;
            onSubmit(normalized);
          }}
        >
          {isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</> : submitLabel}
        </button>
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function AddTenantCard() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const addMutation = useMutation({
    mutationFn: (data: TenantFormData) =>
      api.post('/flats/my-flat/tenant', buildTenantDocumentFormData(data), {
        headers: { 'Content-Type': 'multipart/form-data' },
      }),
    onSuccess: (res) => {
      if (res.status === 202 || res.data?.status === 'PENDING') {
        toast.success(res.data?.message || 'Tenant registration submitted for approval.', { duration: 5000 });
        setShowForm(false);
        queryClient.invalidateQueries({ queryKey: ['approvals'] });
        return;
      }

      const msg = res.data.userCreated
        ? 'Tenant added! They can log in with their email & phone number as password.'
        : 'Tenant added successfully.';
      toast.success(msg, { duration: 5000 });
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ['my-flat'] });
    },
    onError: (e: any) => toast.error(getApiErrorMessage(e, 'Failed to add tenant')),
  });

  if (!showForm) {
    return (
      <section className={cn(SHELL_CARD_CLASS, 'p-6 md:p-7')}>
        <div className="text-center">
          <User className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <p className="mb-4 text-sm text-slate-500">No tenant is linked to this flat.</p>
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            Add Tenant
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={cn(SHELL_CARD_CLASS, 'p-6 md:p-7')}>
      <h2 className="mb-4 text-2xl font-bold tracking-tight text-slate-900">Add Tenant</h2>
      <TenantForm
        initial={emptyForm}
        onSubmit={(data) => addMutation.mutate(data)}
        onCancel={() => setShowForm(false)}
        isPending={addMutation.isPending}
        submitLabel="Add Tenant"
        requireAgreementDocument
        requireContactDetails
      />
    </section>
  );
}

function BillSummarySection({
  flat,
  selectedYear,
  setSelectedYear,
  yearOptions,
}: {
  flat: Flat;
  selectedYear: number;
  setSelectedYear: (value: number) => void;
  yearOptions: number[];
}) {
  const bills = flat.bills || [];

  return (
    <section className={cn(SHELL_CARD_CLASS, 'overflow-hidden')}>
      <div className="flex flex-col gap-4 border-b border-slate-200 px-6 py-5 md:flex-row md:items-center md:justify-between md:px-7">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Bill Summary</h2>
        <div className="relative w-[112px]">
          <select
            className="select !h-11 !rounded-xl !border-slate-200 !bg-slate-50 px-4 pr-9 font-semibold"
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
          >
            {yearOptions.map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </div>
      </div>

      {bills.length > 0 ? (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Month</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Due Date</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Amount</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Paid</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Balance</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Payment Date</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Payment Mode</th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {bills.map((bill) => {
                  const latestPayment = bill.payments?.[0];
                  return (
                    <tr key={bill.id} className="hover:bg-slate-50/80">
                      <td className="px-6 py-5 text-[15px] font-semibold text-slate-900">{bill.title || (bill.month && bill.year ? `${getMonthName(bill.month)} ${bill.year}` : 'Custom Billing')}</td>
                      <td className="px-6 py-5 text-[15px] text-slate-600">{formatDate(bill.dueDate)}</td>
                      <td className="px-6 py-5 text-[15px] font-semibold text-slate-900">{formatCurrency(bill.totalAmount)}</td>
                      <td className="px-6 py-5 text-[15px] text-slate-600">{formatCurrency(bill.paidAmount)}</td>
                      <td className="px-6 py-5 text-[15px] font-semibold text-slate-900">{formatCurrency(bill.totalAmount - bill.paidAmount)}</td>
                      <td className="px-6 py-5 text-[15px] text-slate-400">{latestPayment?.paidAt ? formatDate(latestPayment.paidAt) : '—'}</td>
                      <td className="px-6 py-5 text-[15px] text-slate-400">{latestPayment ? getPaymentMethodLabel(latestPayment.method) : '—'}</td>
                      <td className="px-6 py-5"><BillStatusBadge status={bill.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-slate-200 md:hidden">
            {bills.map((bill) => (
              <MobileBillCard key={bill.id} bill={bill} />
            ))}
            <button type="button" className="w-full px-6 py-5 text-center text-sm font-semibold text-blue-700">
              View All Billing History
            </button>
          </div>

          <div className="hidden items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4 md:flex">
            <p className="text-xs font-medium text-slate-500">Showing {bills.length} bills for the year {selectedYear}</p>
            <div className="flex items-center gap-2">
              <button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400" disabled>
                ‹
              </button>
              <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg bg-blue-700 px-2 text-sm font-semibold text-white">1</span>
              <button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400" disabled>
                ›
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="px-6 py-10 text-sm text-slate-500">No bill transactions found for {selectedYear}.</div>
      )}
    </section>
  );
}

function MobileBillCard({ bill }: { bill: MaintenanceBill }) {
  return (
    <div className="space-y-4 px-6 py-5">
      <MobileBillRow label="Month" value={bill.title || (bill.month && bill.year ? `${getMonthName(bill.month)} ${bill.year}` : 'Custom Billing')} emphasized />
      <MobileBillRow label="Due Date" value={formatDate(bill.dueDate)} />
      <MobileBillRow label="Amount" value={formatCurrency(bill.totalAmount)} emphasized />
      <MobileBillRow label="Status" value={<BillStatusBadge status={bill.status} />} />
    </div>
  );
}

function MobileBillRow({ label, value, emphasized = false }: { label: string; value: React.ReactNode; emphasized?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-[15px] text-slate-500">{label}</span>
      <div className={cn('text-right text-[16px] text-slate-900', emphasized && 'font-bold')}>{value}</div>
    </div>
  );
}

function BillStatusBadge({ status }: { status: MaintenanceBill['status'] }) {
  const classes = {
    PENDING: 'border-amber-200 bg-amber-50 text-amber-700',
    PARTIAL: 'border-blue-200 bg-blue-50 text-blue-700',
    PAID: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    OVERDUE: 'border-red-200 bg-red-600 text-white md:bg-red-50 md:text-red-700',
  } satisfies Record<MaintenanceBill['status'], string>;

  return (
    <span className={cn('inline-flex rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.08em]', classes[status])}>
      {status}
    </span>
  );
}

function createResidentProfileForm(resident: ResidentLike): ResidentProfileFormState {
  return {
    phone: resident.phone || '',
    occupation: resident.occupation || '',
    householdAdults: resident.householdAdults != null ? String(resident.householdAdults) : '',
    householdKids: resident.householdKids != null ? String(resident.householdKids) : '',
    householdSeniors: resident.householdSeniors != null ? String(resident.householdSeniors) : '',
    pets: resident.pets || '',
  };
}

function createVehicleDraft(vehicle?: ResidentVehicle): VehicleDraft {
  return {
    id: vehicle?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: vehicle?.type || 'FOUR_WHEELER',
    registrationNumber: vehicle?.registrationNumber || '',
  };
}

function getVehicleDrafts(existingVehicles?: ResidentVehicle[], fallback?: { carNumber?: string | null; twoWheelerNumber?: string | null }) {
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
    if (!registrationNumber) continue;
    const key = `${vehicle.type}:${registrationNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ type: vehicle.type, registrationNumber });
  }

  return normalized;
}

function getVehicleDisplayGroups(vehicles: VehicleDraft[]) {
  const carVehicles = vehicles.filter((vehicle) => vehicle.type === 'FOUR_WHEELER' && vehicle.registrationNumber.trim());
  const twoWheelers = vehicles.filter((vehicle) => vehicle.type === 'TWO_WHEELER' && vehicle.registrationNumber.trim());

  return {
    car: carVehicles.length ? carVehicles.map((vehicle) => vehicle.registrationNumber.trim()).join(', ') : '',
    twoWheeler: twoWheelers.length ? twoWheelers.map((vehicle) => vehicle.registrationNumber.trim()).join(', ') : '',
  };
}

function parseOptionalCount(value: string) {
  if (!value.trim()) return null;
  return Number(value);
}

function getApiErrorMessage(error: any, fallback: string): string {
  return error?.response?.data?.error || error?.response?.data?.errors?.[0]?.msg || fallback;
}

function normalizeTenantForm(form: TenantFormData, options?: { requireContactDetails?: boolean }): TenantFormData | null {
  const trimmedName = form.name.trim();
  const trimmedPhone = normalizeIndianMobileNumber(form.phone);
  const trimmedEmail = form.email.trim();

  if (!trimmedName) {
    toast.error('Tenant name is required.');
    return null;
  }

  if (!isValidIndianMobileNumber(trimmedPhone)) {
    toast.error('Phone number must be a valid 10-digit Indian mobile number.');
    return null;
  }

  if (options?.requireContactDetails && !trimmedEmail) {
    toast.error('Email address is required for a new tenant.');
    return null;
  }

  if (trimmedEmail && !isValidEmailAddress(trimmedEmail)) {
    toast.error('Enter a valid email address.');
    return null;
  }

  if (form.leaseStart && form.leaseEnd && form.leaseEnd < form.leaseStart) {
    toast.error('Lease end date cannot be before lease start date.');
    return null;
  }

  return {
    ...form,
    name: trimmedName,
    phone: trimmedPhone,
    email: trimmedEmail ? normalizeEmail(trimmedEmail) : '',
  };
}

function getPaymentMethodLabel(method: PaymentMethod) {
  const labels: Record<PaymentMethod, string> = {
    PHONEPE: 'PhonePe',
    CASH: 'Cash',
    CHEQUE: 'Cheque',
    BANK_TRANSFER: 'Bank Transfer',
    UPI_OTHER: 'UPI',
    ADVANCE: 'Advance',
  };

  return labels[method] || method;
}

function getParkingLabel(parkingType?: 'NONE' | 'OPEN' | 'COVERED', parkingSlotNumber?: string) {
  if (!parkingType || parkingType === 'NONE') {
    return 'None';
  }
  return `${parkingType}${parkingSlotNumber ? ` - Slot ${parkingSlotNumber}` : ''}`;
}

function formatOptionalDate(value: string | Date | null | undefined) {
  return value ? formatDate(value) : '—';
}