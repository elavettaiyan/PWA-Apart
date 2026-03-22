import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, User, Phone, Mail, Home, Calendar, UserPlus, Pencil, Trash2, Loader2, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { formatCurrency, formatDate, getMonthName, getStatusColor, cn } from '../../lib/utils';
import { PageLoader } from '../../components/ui/Loader';
import { useAuthStore } from '../../store/authStore';
import type { MaintenanceBill, PaymentMethod } from '../../types';

export default function MyFlatPage() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const { user } = useAuthStore();
  const isOwner = user?.role === 'OWNER';

  const { data: flat, isLoading, error } = useQuery<any>({
    queryKey: ['my-flat', selectedYear],
    queryFn: async () => (await api.get(`/flats/my-flat?year=${selectedYear}`)).data,
  });

  const yearOptions = useMemo(
    () => Array.from({ length: 6 }, (_, index) => currentYear - index),
    [currentYear],
  );

  if (isLoading) return <PageLoader />;

  if (error || !flat) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-500">
        <Building2 className="w-12 h-12 mb-4 text-gray-300" />
        <h2 className="text-lg font-semibold text-gray-700">No Flat Found</h2>
        <p className="text-sm mt-1">Your account is not linked to any flat. Contact your admin.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Flat</h1>
          <p className="text-sm text-gray-500 mt-1">
            {flat.block?.name} - {flat.flatNumber}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Flat Details */}
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Home className="w-5 h-5 text-primary-500" /> Flat Details
          </h2>
          <div className="space-y-3 text-sm">
            <Row label="Flat Number" value={flat.flatNumber} />
            <Row label="Block" value={flat.block?.name} />
            <Row label="Society" value={flat.block?.society?.name} />
            <Row label="Floor" value={flat.floor} />
            <Row label="BHK Type" value={flat.bhkType?.replace('_', ' ')} />
            <Row label="Area" value={`${flat.area} sq.ft.`} />
            <Row label="Status" value={flat.occupancyStatus} />
          </div>
        </div>

        {/* Owner / Tenant Info */}
        <div className="space-y-6">
          {flat.owner && (
            <div className="card p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <User className="w-5 h-5 text-blue-500" /> Owner
              </h2>
              <div className="space-y-3 text-sm">
                <Row label="Name" value={flat.owner.name} />
                <Row label="Phone" value={flat.owner.phone} icon={<Phone className="w-3.5 h-3.5" />} />
                <Row label="Email" value={flat.owner.email} icon={<Mail className="w-3.5 h-3.5" />} />
              </div>
            </div>
          )}

          {flat.tenant && flat.tenant.isActive !== false ? (
            <TenantCard tenant={flat.tenant} isOwner={isOwner} />
          ) : isOwner ? (
            <AddTenantCard />
          ) : null}
        </div>
      </div>

      {/* Bill Summary */}
      {flat.bills && flat.bills.length > 0 && (
        <div className="mt-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-gray-900">Bill Summary</h2>
            <select className="select w-32" value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}>
              {yearOptions.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Due Date</th>
                  <th>Amount</th>
                  <th>Paid</th>
                  <th>Balance</th>
                  <th>Payment Date</th>
                  <th>Payment Mode</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {flat.bills.map((bill: MaintenanceBill) => {
                  const latestPayment = bill.payments?.[0];

                  return (
                  <tr key={bill.id}>
                    <td className="font-medium">{getMonthName(bill.month)} {bill.year}</td>
                    <td>{formatDate(bill.dueDate)}</td>
                    <td>{formatCurrency(bill.totalAmount)}</td>
                    <td className="text-emerald-600">{formatCurrency(bill.paidAmount)}</td>
                    <td className="text-red-600">{formatCurrency(bill.totalAmount - bill.paidAmount)}</td>
                    <td>{latestPayment?.paidAt ? formatDate(latestPayment.paidAt) : '—'}</td>
                    <td>{latestPayment ? getPaymentMethodLabel(latestPayment.method) : '—'}</td>
                    <td>
                      <span className={cn('badge', getStatusColor(bill.status))}>
                        {bill.status}
                      </span>
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {flat.bills && flat.bills.length === 0 && (
        <div className="mt-6 card p-6 text-sm text-gray-500">
          No bill transactions found for {selectedYear}.
        </div>
      )}
    </div>
  );
}

function getPaymentMethodLabel(method: PaymentMethod) {
  const labels: Record<PaymentMethod, string> = {
    PHONEPE: 'PhonePe',
    CASH: 'Cash',
    CHEQUE: 'Cheque',
    BANK_TRANSFER: 'Bank Transfer',
    UPI_OTHER: 'UPI',
  };

  return labels[method] || method;
}

function Row({ label, value, icon }: { label: string; value: string | number | null | undefined; icon?: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900 flex items-center gap-1.5">
        {icon} {value || '—'}
      </span>
    </div>
  );
}

// ── TENANT FORM (shared by Add & Edit) ──────────────────
interface TenantFormData {
  name: string;
  phone: string;
  email: string;
  leaseStart: string;
  leaseEnd: string;
  rentAmount: string;
  deposit: string;
}

const emptyForm: TenantFormData = { name: '', phone: '', email: '', leaseStart: '', leaseEnd: '', rentAmount: '', deposit: '' };

function TenantForm({ initial, onSubmit, onCancel, isPending, submitLabel }: {
  initial: TenantFormData;
  onSubmit: (data: TenantFormData) => void;
  onCancel: () => void;
  isPending: boolean;
  submitLabel: string;
}) {
  const [form, setForm] = useState<TenantFormData>(initial);
  const set = (field: keyof TenantFormData, value: string) => setForm((f) => ({ ...f, [field]: value }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Name *</label>
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Tenant name" />
        </div>
        <div>
          <label className="label">Phone *</label>
          <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="10-digit mobile" />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="tenant@email.com" />
        </div>
        <div>
          <label className="label">Lease Start</label>
          <input className="input" type="date" value={form.leaseStart} onChange={(e) => set('leaseStart', e.target.value)} />
        </div>
        <div>
          <label className="label">Lease End</label>
          <input className="input" type="date" value={form.leaseEnd} onChange={(e) => set('leaseEnd', e.target.value)} />
        </div>
        <div>
          <label className="label">Rent Amount</label>
          <input className="input" type="number" value={form.rentAmount} onChange={(e) => set('rentAmount', e.target.value)} placeholder="Monthly rent" />
        </div>
        <div>
          <label className="label">Deposit</label>
          <input className="input" type="number" value={form.deposit} onChange={(e) => set('deposit', e.target.value)} placeholder="Security deposit" />
        </div>
      </div>

      {form.email && form.phone && (
        <div className="flex items-start gap-2 bg-blue-50 text-blue-700 text-xs rounded-lg p-3">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>A login account will be created for the tenant. Default password is the phone number.</span>
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button
          className="btn-primary"
          disabled={isPending || !form.name.trim() || !form.phone.trim()}
          onClick={() => onSubmit(form)}
        >
          {isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : submitLabel}
        </button>
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ── ADD TENANT CARD (Owner only, no active tenant) ──────
function AddTenantCard() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const addMutation = useMutation({
    mutationFn: (data: TenantFormData) =>
      api.post('/flats/my-flat/tenant', {
        name: data.name,
        phone: data.phone,
        email: data.email || undefined,
        leaseStart: data.leaseStart || undefined,
        leaseEnd: data.leaseEnd || undefined,
        rentAmount: data.rentAmount || undefined,
        deposit: data.deposit || undefined,
      }),
    onSuccess: (res) => {
      const msg = res.data.userCreated
        ? 'Tenant added! They can log in with their email & phone number as password.'
        : 'Tenant added successfully.';
      toast.success(msg, { duration: 5000 });
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ['my-flat'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to add tenant'),
  });

  if (!showForm) {
    return (
      <div className="card p-6">
        <div className="text-center py-4">
          <User className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500 mb-4">No tenant in this flat</p>
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            <UserPlus className="w-4 h-4" /> Add Tenant
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <UserPlus className="w-5 h-5 text-teal-500" /> Add Tenant
      </h2>
      <TenantForm
        initial={emptyForm}
        onSubmit={(data) => addMutation.mutate(data)}
        onCancel={() => setShowForm(false)}
        isPending={addMutation.isPending}
        submitLabel="Add Tenant"
      />
    </div>
  );
}

// ── TENANT CARD (displays tenant info, with edit/remove for owner) ──
function TenantCard({ tenant, isOwner }: { tenant: any; isOwner: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);

  const updateMutation = useMutation({
    mutationFn: (data: TenantFormData) =>
      api.put('/flats/my-flat/tenant', {
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
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ['my-flat'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to update tenant'),
  });

  const removeMutation = useMutation({
    mutationFn: () => api.delete('/flats/my-flat/tenant'),
    onSuccess: () => {
      toast.success('Tenant removed');
      setShowRemoveConfirm(false);
      queryClient.invalidateQueries({ queryKey: ['my-flat'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to remove tenant'),
  });

  const toDateStr = (d: string | null | undefined) => (d ? new Date(d).toISOString().split('T')[0] : '');

  if (editing) {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Pencil className="w-5 h-5 text-teal-500" /> Edit Tenant
        </h2>
        <TenantForm
          initial={{
            name: tenant.name || '',
            phone: tenant.phone || '',
            email: tenant.email || '',
            leaseStart: toDateStr(tenant.leaseStart || tenant.leaseStartDate),
            leaseEnd: toDateStr(tenant.leaseEnd || tenant.leaseEndDate),
            rentAmount: tenant.rentAmount?.toString() || '',
            deposit: tenant.deposit?.toString() || '',
          }}
          onSubmit={(data) => updateMutation.mutate(data)}
          onCancel={() => setEditing(false)}
          isPending={updateMutation.isPending}
          submitLabel="Save Changes"
        />
      </div>
    );
  }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <User className="w-5 h-5 text-teal-500" /> Tenant
        </h2>
        {isOwner && (
          <div className="flex items-center gap-2">
            <button className="text-xs text-primary-600 hover:text-primary-800 font-medium flex items-center gap-1" onClick={() => setEditing(true)}>
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
            <button className="text-xs text-red-600 hover:text-red-800 font-medium flex items-center gap-1" onClick={() => setShowRemoveConfirm(true)}>
              <Trash2 className="w-3.5 h-3.5" /> Remove
            </button>
          </div>
        )}
      </div>
      <div className="space-y-3 text-sm">
        <Row label="Name" value={tenant.name} />
        <Row label="Phone" value={tenant.phone} icon={<Phone className="w-3.5 h-3.5" />} />
        <Row label="Email" value={tenant.email} icon={<Mail className="w-3.5 h-3.5" />} />
        <Row label="Lease Start" value={formatDate(tenant.leaseStart || tenant.leaseStartDate)} icon={<Calendar className="w-3.5 h-3.5" />} />
        {(tenant.leaseEnd || tenant.leaseEndDate) && (
          <Row label="Lease End" value={formatDate(tenant.leaseEnd || tenant.leaseEndDate)} icon={<Calendar className="w-3.5 h-3.5" />} />
        )}
        {tenant.rentAmount && <Row label="Rent" value={formatCurrency(tenant.rentAmount)} />}
        {tenant.deposit && <Row label="Deposit" value={formatCurrency(tenant.deposit)} />}
      </div>

      {/* Remove confirmation */}
      {showRemoveConfirm && (
        <div className="mt-4 p-3 bg-red-50 rounded-lg border border-red-200">
          <p className="text-sm text-red-700 mb-3">Are you sure you want to remove this tenant?</p>
          <div className="flex items-center gap-2">
            <button
              className="btn-sm bg-red-600 text-white hover:bg-red-700 rounded-lg px-3 py-1.5 text-xs font-medium"
              disabled={removeMutation.isPending}
              onClick={() => removeMutation.mutate()}
            >
              {removeMutation.isPending ? 'Removing...' : 'Yes, Remove'}
            </button>
            <button className="btn-sm btn-secondary text-xs" onClick={() => setShowRemoveConfirm(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
