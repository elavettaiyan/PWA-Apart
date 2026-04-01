import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Package, Search, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { PageLoader } from '../../components/ui/Loader';
import { cn, formatDateTime, getStatusColor } from '../../lib/utils';
import type { Delivery, DeliveryType, FlatOption, Visitor } from '../../types';

type EntryMode = 'VISITOR' | 'DELIVERY';

const DELIVERY_TYPES: DeliveryType[] = ['COURIER', 'FOOD', 'GROCERY', 'MEDICINE', 'PARCEL', 'OTHER'];
const VISITOR_PURPOSES = ['Guest', 'Family Visit', 'Friend Visit', 'Maintenance', 'Official', 'Other'] as const;

type VisitorPurpose = (typeof VISITOR_PURPOSES)[number];
type VisitorForm = {
  flatId: string;
  visitorName: string;
  mobile: string;
  vehicleNumber: string;
  purpose: VisitorPurpose;
};

type DeliveryForm = {
  flatId: string;
  deliveryType: DeliveryType;
  deliveryPersonName: string;
  mobile: string;
  vehicleNumber: string;
};

const emptyVisitorForm: VisitorForm = {
  flatId: '',
  visitorName: '',
  mobile: '',
  vehicleNumber: '',
  purpose: VISITOR_PURPOSES[0],
};

const emptyDeliveryForm: DeliveryForm = {
  flatId: '',
  deliveryType: 'COURIER' as DeliveryType,
  deliveryPersonName: '',
  mobile: '',
  vehicleNumber: '',
};

export default function GateManagementPage() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<EntryMode>('VISITOR');
  const [visitorForm, setVisitorForm] = useState(emptyVisitorForm);
  const [deliveryForm, setDeliveryForm] = useState(emptyDeliveryForm);
  const [visitorPhoto, setVisitorPhoto] = useState<File | null>(null);
  const [deliveryPhoto, setDeliveryPhoto] = useState<File | null>(null);

  const { data: flats = [], isLoading: flatsLoading } = useQuery<FlatOption[]>({
    queryKey: ['flat-options'],
    queryFn: async () => (await api.get('/flats/options')).data,
  });

  const { data: visitors = [], isLoading: visitorsLoading } = useQuery<Visitor[]>({
    queryKey: ['visitors', 'gate'],
    queryFn: async () => (await api.get('/visitors?limit=20')).data,
  });

  const { data: deliveries = [], isLoading: deliveriesLoading } = useQuery<Delivery[]>({
    queryKey: ['deliveries', 'gate'],
    queryFn: async () => (await api.get('/deliveries?limit=20')).data,
  });

  const createVisitor = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append('flatId', visitorForm.flatId);
      formData.append('visitorName', visitorForm.visitorName);
      formData.append('mobile', visitorForm.mobile);
      formData.append('vehicleNumber', visitorForm.vehicleNumber);
      formData.append('purpose', visitorForm.purpose);
      if (visitorPhoto) {
        formData.append('photo', visitorPhoto);
      }
      return (await api.post('/visitors', formData, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
    },
    onSuccess: () => {
      toast.success('Visitor recorded');
      setVisitorForm(emptyVisitorForm);
      setVisitorPhoto(null);
      queryClient.invalidateQueries({ queryKey: ['visitors'] });
      queryClient.invalidateQueries({ queryKey: ['my-flat'] });
    },
    onError: (error: any) => toast.error(error?.response?.data?.error || error?.message || 'Failed to record visitor'),
  });

  const createDelivery = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append('flatId', deliveryForm.flatId);
      formData.append('deliveryType', deliveryForm.deliveryType);
      formData.append('deliveryPersonName', deliveryForm.deliveryPersonName);
      formData.append('mobile', deliveryForm.mobile);
      formData.append('vehicleNumber', deliveryForm.vehicleNumber);
      if (deliveryPhoto) {
        formData.append('photo', deliveryPhoto);
      }

      return (await api.post('/deliveries', formData, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
    },
    onSuccess: () => {
      toast.success('Delivery recorded');
      setDeliveryForm(emptyDeliveryForm);
      setDeliveryPhoto(null);
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      queryClient.invalidateQueries({ queryKey: ['my-flat'] });
    },
    onError: (error: any) => toast.error(error?.response?.data?.error || 'Failed to record delivery'),
  });

  const checkoutVisitor = useMutation({
    mutationFn: async (visitorId: string) => (await api.patch(`/visitors/${visitorId}/checkout`)).data,
    onSuccess: () => {
      toast.success('Visitor marked as left');
      queryClient.invalidateQueries({ queryKey: ['visitors'] });
      queryClient.invalidateQueries({ queryKey: ['my-flat'] });
    },
    onError: (error: any) => toast.error(error?.response?.data?.error || 'Failed to update visitor'),
  });

  const activeVisitors = useMemo(
    () => visitors.filter((visitor) => visitor.status === 'ACTIVE'),
    [visitors],
  );

  const gateRecentVisitors = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return visitors.filter((visitor) => {
      if (visitor.status === 'ACTIVE') {
        return true;
      }

      const checkedInDate = new Date(visitor.checkedInAt);
      checkedInDate.setHours(0, 0, 0, 0);

      return checkedInDate.getTime() === today.getTime();
    });
  }, [visitors]);

  if (flatsLoading || visitorsLoading || deliveriesLoading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="section-label mb-2">Gate Desk</p>
          <h1 className="page-title">Gate Management</h1>
          <p className="text-sm text-on-surface-variant">Record visitors and deliveries from one workflow.</p>
        </div>
        <div className="inline-flex rounded-2xl bg-white p-1 w-full max-w-sm" style={{ boxShadow: '0 1px 8px -2px rgba(0,0,0,0.04)' }}>
          {(['VISITOR', 'DELIVERY'] as EntryMode[]).map((value) => (
            <button
              key={value}
              type="button"
              className={cn(
                'flex-1 rounded-xl px-4 py-2 text-sm font-semibold transition-colors',
                mode === value ? 'bg-primary text-white' : 'text-[#64748B]',
              )}
              onClick={() => setMode(value)}
            >
              {value === 'VISITOR' ? 'Visitor' : 'Delivery'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] gap-6">
        <div className="card-elevated p-6 space-y-5">
          {mode === 'VISITOR' ? (
            <>
              <div>
                <h2 className="text-lg font-semibold text-on-surface">Record Visitor</h2>
                <p className="text-sm text-on-surface-variant mt-1">Visitor photo is optional.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectFlat value={visitorForm.flatId} onChange={(value) => setVisitorForm((current) => ({ ...current, flatId: value }))} flats={flats} />
                <Field label="Visitor Name *">
                  <input className="input" value={visitorForm.visitorName} onChange={(event) => setVisitorForm((current) => ({ ...current, visitorName: event.target.value }))} placeholder="Full name" />
                </Field>
                <Field label="Mobile *">
                  <input className="input" value={visitorForm.mobile} onChange={(event) => setVisitorForm((current) => ({ ...current, mobile: event.target.value }))} placeholder="Phone number" />
                </Field>
                <Field label="Vehicle Number">
                  <input className="input" value={visitorForm.vehicleNumber} onChange={(event) => setVisitorForm((current) => ({ ...current, vehicleNumber: event.target.value }))} placeholder="Optional vehicle number" />
                </Field>
                <Field label="Photo">
                  <input className="input file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-semibold file:text-on-primary" type="file" accept="image/*" capture="environment" onChange={(event) => setVisitorPhoto(event.target.files?.[0] || null)} />
                  {visitorPhoto && <p className="mt-2 text-xs text-on-surface-variant">Selected: {visitorPhoto.name}</p>}
                </Field>
                <Field label="Purpose *" className="sm:col-span-2">
                  <select className="select" value={visitorForm.purpose} onChange={(event) => setVisitorForm((current) => ({ ...current, purpose: event.target.value as VisitorPurpose }))}>
                    {VISITOR_PURPOSES.map((purpose) => (
                      <option key={purpose} value={purpose}>{purpose}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="flex justify-end">
                <button
                  className="btn-primary"
                  disabled={createVisitor.isPending || !visitorForm.flatId || !visitorForm.visitorName.trim() || !visitorForm.mobile.trim() || !visitorForm.purpose.trim()}
                  onClick={() => createVisitor.mutate()}
                >
                  {createVisitor.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : 'Save Visitor'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div>
                <h2 className="text-lg font-semibold text-on-surface">Record Delivery</h2>
                <p className="text-sm text-on-surface-variant mt-1">Delivery photo is optional.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectFlat value={deliveryForm.flatId} onChange={(value) => setDeliveryForm((current) => ({ ...current, flatId: value }))} flats={flats} />
                <Field label="Delivery Type *">
                  <select className="select" value={deliveryForm.deliveryType} onChange={(event) => setDeliveryForm((current) => ({ ...current, deliveryType: event.target.value as DeliveryType }))}>
                    {DELIVERY_TYPES.map((type) => (
                      <option key={type} value={type}>{getDeliveryTypeLabel(type)}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Delivery Person *">
                  <input className="input" value={deliveryForm.deliveryPersonName} onChange={(event) => setDeliveryForm((current) => ({ ...current, deliveryPersonName: event.target.value }))} placeholder="Courier or rider name" />
                </Field>
                <Field label="Mobile *">
                  <input className="input" value={deliveryForm.mobile} onChange={(event) => setDeliveryForm((current) => ({ ...current, mobile: event.target.value }))} placeholder="Phone number" />
                </Field>
                <Field label="Vehicle Number">
                  <input className="input" value={deliveryForm.vehicleNumber} onChange={(event) => setDeliveryForm((current) => ({ ...current, vehicleNumber: event.target.value }))} placeholder="Optional vehicle number" />
                </Field>
                <Field label="Photo" className="sm:col-span-2">
                  <input className="input file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-semibold file:text-on-primary" type="file" accept="image/*" capture="environment" onChange={(event) => setDeliveryPhoto(event.target.files?.[0] || null)} />
                  {deliveryPhoto && <p className="mt-2 text-xs text-on-surface-variant">Selected: {deliveryPhoto.name}</p>}
                </Field>
              </div>
              <div className="flex justify-end">
                <button
                  className="btn-primary"
                  disabled={createDelivery.isPending || !deliveryForm.flatId || !deliveryForm.deliveryPersonName.trim() || !deliveryForm.mobile.trim()}
                  onClick={() => createDelivery.mutate()}
                >
                  {createDelivery.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : 'Save Delivery'}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="space-y-6">
          <div className="card-elevated p-6">
            <div className="flex items-center gap-2 mb-4">
              <ShieldCheck className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold text-on-surface">Active Visitors</h2>
            </div>
            {activeVisitors.length === 0 ? (
              <p className="text-sm text-on-surface-variant">No active visitors at the moment.</p>
            ) : (
              <div className="space-y-3">
                {activeVisitors.map((visitor) => (
                  <div key={visitor.id} className="rounded-2xl p-4 bg-white space-y-2" style={{ boxShadow: '0 1px 8px -2px rgba(0,0,0,0.04)' }}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-on-surface">{visitor.visitorName}</p>
                        <p className="text-sm text-on-surface-variant">{visitor.flat?.block?.name} - {visitor.flat?.flatNumber}</p>
                      </div>
                      <span className={cn('badge', getStatusColor(visitor.status))}>{visitor.status}</span>
                    </div>
                    <div className="text-sm text-on-surface-variant space-y-1">
                      <p>Purpose: {visitor.purpose}</p>
                      <p>Checked in: {formatDateTime(visitor.checkedInAt)}</p>
                      {visitor.flat?.residentName && <p>Resident: {visitor.flat.residentName}</p>}
                    </div>
                    <button className="btn-secondary w-full" disabled={checkoutVisitor.isPending} onClick={() => checkoutVisitor.mutate(visitor.id)}>
                      Mark as Left
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card-elevated p-6">
            <div className="flex items-center gap-2 mb-4">
              {mode === 'VISITOR' ? <ShieldCheck className="w-5 h-5 text-primary" /> : <Package className="w-5 h-5 text-primary" />}
              <h2 className="text-lg font-semibold text-on-surface">Recent {mode === 'VISITOR' ? 'Visitors' : 'Deliveries'}</h2>
            </div>
            {mode === 'VISITOR' ? (
              <RecentVisitorList visitors={gateRecentVisitors.slice(0, 10)} />
            ) : (
              <RecentDeliveryList deliveries={deliveries.slice(0, 10)} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SelectFlat({ flats, value, onChange }: { flats: FlatOption[]; value: string; onChange: (value: string) => void }) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const selectedFlat = useMemo(
    () => flats.find((flat) => flat.id === value) || null,
    [flats, value],
  );

  const filteredFlats = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return flats;
    }

    return flats.filter((flat) => {
      const searchableText = [flat.blockName, flat.flatNumber, flat.residentName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return searchableText.includes(normalizedQuery);
    });
  }, [flats, query]);

  useEffect(() => {
    if (selectedFlat) {
      setQuery(getFlatLabel(selectedFlat));
      return;
    }

    setQuery('');
  }, [selectedFlat]);

  return (
    <Field label="Flat *">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-outline pointer-events-none" />
        <input
          className="input pl-10"
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            if (value) {
              onChange('');
            }
            setIsOpen(true);
          }}
          placeholder="Search by block, flat number, or resident"
        />
        {isOpen && (
          <div className="absolute z-20 mt-2 max-h-64 w-full overflow-y-auto rounded-2xl border border-outline-variant/30 bg-surface shadow-lg">
            {filteredFlats.length === 0 ? (
              <div className="px-4 py-3 text-sm text-on-surface-variant">No flats found.</div>
            ) : (
              filteredFlats.map((flat) => (
                <button
                  key={flat.id}
                  type="button"
                  className="w-full px-4 py-3 text-left hover:bg-surface-container transition-colors"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onChange(flat.id);
                    setQuery(getFlatLabel(flat));
                    setIsOpen(false);
                  }}
                >
                  <div className="font-medium text-on-surface">{flat.blockName} - {flat.flatNumber}</div>
                  {flat.residentName && <div className="text-xs text-on-surface-variant mt-1">{flat.residentName}</div>}
                </button>
              ))
            )}
          </div>
        )}
      </div>
      {selectedFlat && <p className="mt-2 text-xs text-on-surface-variant">Selected: {getFlatLabel(selectedFlat)}</p>}
    </Field>
  );
}

function getFlatLabel(flat: FlatOption) {
  return `${flat.blockName} - ${flat.flatNumber}${flat.residentName ? ` · ${flat.residentName}` : ''}`;
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function RecentVisitorList({ visitors }: { visitors: Visitor[] }) {
  if (visitors.length === 0) {
    return <p className="text-sm text-on-surface-variant">No visitor records yet.</p>;
  }

  return (
    <div className="space-y-3">
      {visitors.map((visitor) => (
        <div key={visitor.id} className="rounded-2xl p-4 bg-white" style={{ boxShadow: '0 1px 8px -2px rgba(0,0,0,0.04)' }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-on-surface">{visitor.visitorName}</p>
              <p className="text-sm text-on-surface-variant">{visitor.flat?.block?.name} - {visitor.flat?.flatNumber}</p>
            </div>
            <span className={cn('badge', getStatusColor(visitor.status))}>{visitor.status}</span>
          </div>
          <div className="mt-3 text-sm text-on-surface-variant space-y-1">
            <p>{visitor.purpose}</p>
            <p>In: {formatDateTime(visitor.checkedInAt)}</p>
            {visitor.checkedOutAt && <p>Out: {formatDateTime(visitor.checkedOutAt)}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function RecentDeliveryList({ deliveries }: { deliveries: Delivery[] }) {
  if (deliveries.length === 0) {
    return <p className="text-sm text-on-surface-variant">No delivery records yet.</p>;
  }

  return (
    <div className="space-y-3">
      {deliveries.map((delivery) => (
        <div key={delivery.id} className="rounded-2xl p-4 bg-white" style={{ boxShadow: '0 1px 8px -2px rgba(0,0,0,0.04)' }}>
          <p className="font-semibold text-on-surface">{getDeliveryTypeLabel(delivery.deliveryType)}</p>
          <p className="text-sm text-on-surface-variant">{delivery.deliveryPersonName}</p>
          <div className="mt-3 text-sm text-on-surface-variant space-y-1">
            <p>{delivery.flat?.block?.name} - {delivery.flat?.flatNumber}</p>
            <p>At: {formatDateTime(delivery.deliveredAt)}</p>
            {delivery.companyName && <p>Company: {delivery.companyName}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function getDeliveryTypeLabel(type: DeliveryType) {
  return type.replace('_', ' ');
}