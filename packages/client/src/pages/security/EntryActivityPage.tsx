import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Car, Clock, LogOut, Package, Phone, Search, ShieldCheck, UserRound } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { PageLoader } from '../../components/ui/Loader';
import { cn, formatDateTime } from '../../lib/utils';
import { useAuthStore } from '../../store/authStore';
import type { Delivery, FlatOption, Visitor } from '../../types';

function getInitials(name?: string): string {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

type ActivityMode = 'VISITOR' | 'DELIVERY';

const FULL_ACCESS_ROLES = ['SUPER_ADMIN', 'SERVICE_STAFF'];

export default function EntryActivityPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const showFlatFilter = FULL_ACCESS_ROLES.includes(user?.role || '') || ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER'].includes(user?.role || '');
  const canMarkOut = FULL_ACCESS_ROLES.includes(user?.role || '') || ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER'].includes(user?.role || '');
  const [mode, setMode] = useState<ActivityMode>('VISITOR');
  const [search, setSearch] = useState('');
  const [flatId, setFlatId] = useState('');

  const checkoutVisitor = useMutation({
    mutationFn: async (visitorId: string) => (await api.patch(`/visitors/${visitorId}/checkout`)).data,
    onSuccess: () => {
      toast.success('Visitor marked as left');
      queryClient.invalidateQueries({ queryKey: ['visitors'] });
    },
    onError: (error: any) => toast.error(error.response?.data?.error || 'Failed to mark visitor out'),
  });

  const { data: flats = [], isLoading: flatsLoading } = useQuery<FlatOption[]>({
    queryKey: ['flat-options', 'admin-activity'],
    queryFn: async () => (await api.get('/flats/options')).data,
    enabled: showFlatFilter,
  });

  const { data: visitors = [], isLoading: visitorsLoading } = useQuery<Visitor[]>({
    queryKey: ['visitors', 'activity'],
    queryFn: async () => (await api.get('/visitors?limit=100')).data,
  });

  const { data: deliveries = [], isLoading: deliveriesLoading } = useQuery<Delivery[]>({
    queryKey: ['deliveries', 'activity'],
    queryFn: async () => (await api.get('/deliveries?limit=100')).data,
  });

  const normalizedSearch = search.trim().toLowerCase();

  const filteredVisitors = useMemo(
    () => visitors.filter((visitor) => {
      if (flatId && visitor.flatId !== flatId) return false;
      if (!normalizedSearch) return true;

      return [
        visitor.visitorName,
        visitor.mobile,
        visitor.purpose,
        visitor.vehicleNumber,
        visitor.flat?.flatNumber,
        visitor.flat?.block?.name,
        visitor.flat?.residentName,
      ].some((value) => String(value || '').toLowerCase().includes(normalizedSearch));
    }),
    [flatId, normalizedSearch, visitors],
  );

  const filteredDeliveries = useMemo(
    () => deliveries.filter((delivery) => {
      if (flatId && delivery.flatId !== flatId) return false;
      if (!normalizedSearch) return true;

      return [
        delivery.deliveryPersonName,
        delivery.mobile,
        delivery.companyName,
        delivery.vehicleNumber,
        delivery.deliveryType,
        delivery.flat?.flatNumber,
        delivery.flat?.block?.name,
        delivery.flat?.residentName,
      ].some((value) => String(value || '').toLowerCase().includes(normalizedSearch));
    }),
    [deliveries, flatId, normalizedSearch],
  );

  if ((showFlatFilter && flatsLoading) || visitorsLoading || deliveriesLoading) return <PageLoader />;

  const isResident = user?.role === 'OWNER' || user?.role === 'TENANT';

  return (
    <div className="space-y-6">
      <div>
        <p className="section-label mb-1">{isResident ? 'My Visitors' : 'All Entries'}</p>
        <h1 className="page-title">Entry Activity</h1>
      </div>

      <div className="card-elevated p-4 flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="inline-flex rounded-2xl bg-surface-container p-1 w-full lg:w-auto">
          {(['VISITOR', 'DELIVERY'] as ActivityMode[]).map((value) => (
            <button
              key={value}
              type="button"
              className={cn(
                'flex-1 rounded-xl px-4 py-2 text-sm font-semibold transition-colors',
                mode === value ? 'bg-primary text-on-primary' : 'text-on-surface-variant',
              )}
              onClick={() => setMode(value)}
            >
              {value === 'VISITOR' ? 'Visitors' : 'Deliveries'}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
          <input className="input pl-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, mobile, flat, resident" />
        </div>
        {showFlatFilter && (
          <select className="select lg:w-72" value={flatId} onChange={(event) => setFlatId(event.target.value)}>
            <option value="">All flats</option>
            {flats.map((flat) => (
              <option key={flat.id} value={flat.id}>{flat.blockName} - {flat.flatNumber}</option>
            ))}
          </select>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(mode === 'VISITOR' ? filteredVisitors : filteredDeliveries).map((record) => (
          mode === 'VISITOR'
            ? (
              <VisitorActivityCard
                key={record.id}
                visitor={record as Visitor}
                canMarkOut={canMarkOut}
                onMarkOut={(id) => checkoutVisitor.mutate(id)}
                isMarkingOut={checkoutVisitor.isPending && checkoutVisitor.variables === record.id}
              />
            )
            : <DeliveryActivityCard key={record.id} delivery={record as Delivery} />
        ))}
      </div>

      {(mode === 'VISITOR' ? filteredVisitors.length === 0 : filteredDeliveries.length === 0) && (
        <div className="card p-6 text-center text-on-surface-variant">
          <ShieldCheck className="w-10 h-10 mx-auto mb-3 text-outline/40" />
          No matching {mode === 'VISITOR' ? 'visitor' : 'delivery'} records found.
        </div>
      )}
    </div>
  );
}

type VisitorActivityCardProps = {
  visitor: Visitor;
  canMarkOut: boolean;
  onMarkOut: (visitorId: string) => void;
  isMarkingOut: boolean;
};

function VisitorActivityCard({ visitor, canMarkOut, onMarkOut, isMarkingOut }: VisitorActivityCardProps) {
  const isActive = visitor.status === 'ACTIVE';

  return (
    <div
      className={cn(
        'card-elevated overflow-hidden transition-shadow hover:shadow-card-hover',
        isActive && 'ring-1 ring-secondary/40',
      )}
    >
      {/* Accent strip for active visitors */}
      {isActive && <div className="h-1 w-full bg-secondary" />}

      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-bold font-headline',
              isActive ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant',
            )}
          >
            {getInitials(visitor.visitorName)}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-on-surface">{visitor.visitorName}</h2>
            <p className="truncate text-xs text-on-surface-variant">
              {visitor.flat?.block?.name}-{visitor.flat?.flatNumber}
              {visitor.flat?.residentName ? ` · ${visitor.flat.residentName}` : ''}
            </p>
          </div>
        </div>
        <span
          className={cn(
            'inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
            isActive ? 'bg-secondary-container text-on-secondary-container' : 'bg-slate-100 text-slate-500',
          )}
        >
          {isActive ? 'Active' : 'Left'}
        </span>
      </div>

      <div className="px-4 pt-3 pb-4 space-y-2">
        {visitor.photoUrl && (
          <img
            src={visitor.photoUrl}
            alt={visitor.visitorName}
            className="w-full h-32 rounded-xl object-cover border border-outline-variant/20"
          />
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-on-surface-variant">
          {visitor.purpose && (
            <span className="inline-flex items-center gap-1.5">
              <UserRound className="w-3.5 h-3.5 text-outline" /> {visitor.purpose}
            </span>
          )}
          {visitor.mobile && (
            <span className="inline-flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 text-outline" /> {visitor.mobile}
            </span>
          )}
          {visitor.vehicleNumber && (
            <span className="inline-flex items-center gap-1.5">
              <Car className="w-3.5 h-3.5 text-outline" /> {visitor.vehicleNumber}
            </span>
          )}
        </div>
        <p className="inline-flex items-center gap-1.5 text-[11px] text-outline">
          <Clock className="w-3.5 h-3.5" />
          In: {formatDateTime(visitor.checkedInAt)}
          {visitor.checkedOutAt ? ` · Out: ${formatDateTime(visitor.checkedOutAt)}` : ''}
        </p>

        {isActive && canMarkOut && (
          <button
            type="button"
            className="btn-accent btn-sm mt-1 w-full justify-center"
            onClick={() => onMarkOut(visitor.id)}
            disabled={isMarkingOut}
          >
            <LogOut className="w-4 h-4" />
            {isMarkingOut ? 'Marking Out…' : 'Mark Out'}
          </button>
        )}
      </div>
    </div>
  );
}

function DeliveryActivityCard({ delivery }: { delivery: Delivery }) {
  return (
    <div className="card-elevated overflow-hidden">
      <div className="flex items-center gap-1.5 px-4 pt-3">
        <Package className="w-3.5 h-3.5 text-primary" />
        <h2 className="text-[13px] font-semibold text-on-surface">{delivery.deliveryType.replace('_', ' ')}</h2>
      </div>
      <div className="px-4 pt-1.5 pb-3 text-xs text-on-surface-variant space-y-0.5">
        {delivery.photoUrl && (
          <img
            src={delivery.photoUrl}
            alt={delivery.deliveryPersonName}
            className="w-full h-32 rounded-xl object-cover border border-outline-variant/20 mb-2"
          />
        )}
        <p>{delivery.flat?.block?.name}-{delivery.flat?.flatNumber} {delivery.flat?.residentName ? `· ${delivery.flat.residentName}` : ''}</p>
        <p>{delivery.deliveryPersonName}{delivery.companyName ? ` · ${delivery.companyName}` : ''}</p>
        {delivery.mobile && <p>{delivery.mobile}</p>}
        <p className="text-[11px] text-outline">At: {formatDateTime(delivery.deliveredAt)}</p>
      </div>
    </div>
  );
}