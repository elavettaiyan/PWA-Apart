import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Package, Search, ShieldCheck } from 'lucide-react';
import api from '../../lib/api';
import { PageLoader } from '../../components/ui/Loader';
import { cn, formatDateTime, getStatusColor } from '../../lib/utils';
import { useAuthStore } from '../../store/authStore';
import type { Delivery, FlatOption, Visitor } from '../../types';

type ActivityMode = 'VISITOR' | 'DELIVERY';

const FULL_ACCESS_ROLES = ['SUPER_ADMIN', 'SERVICE_STAFF'];

export default function EntryActivityPage() {
  const { user } = useAuthStore();
  const showFlatFilter = FULL_ACCESS_ROLES.includes(user?.role || '') || ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER'].includes(user?.role || '');
  const [mode, setMode] = useState<ActivityMode>('VISITOR');
  const [search, setSearch] = useState('');
  const [flatId, setFlatId] = useState('');

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
            ? <VisitorActivityCard key={record.id} visitor={record as Visitor} />
            : <DeliveryActivityCard key={record.id} delivery={record as Delivery} />
        ))}
      </div>

      {(mode === 'VISITOR' ? filteredVisitors.length === 0 : filteredDeliveries.length === 0) && (
        <div className="card p-6 text-center text-on-surface-variant">
          <ClipboardList className="w-10 h-10 mx-auto mb-3 text-outline/40" />
          No matching {mode === 'VISITOR' ? 'visitor' : 'delivery'} records found.
        </div>
      )}
    </div>
  );
}

function VisitorActivityCard({ visitor }: { visitor: Visitor }) {
  return (
    <div className="card-elevated overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-primary" />
          <h2 className="text-[13px] font-semibold text-on-surface">{visitor.visitorName}</h2>
        </div>
        <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold', getStatusColor(visitor.status))}>{visitor.status}</span>
      </div>
      <div className="px-4 pt-1.5 pb-3 text-xs text-on-surface-variant space-y-0.5">
        {visitor.photoUrl && (
          <img
            src={visitor.photoUrl}
            alt={visitor.visitorName}
            className="w-full h-32 rounded-xl object-cover border border-outline-variant/20 mb-2"
          />
        )}
        <p>{visitor.flat?.block?.name}-{visitor.flat?.flatNumber} {visitor.flat?.residentName ? `· ${visitor.flat.residentName}` : ''}</p>
        <p>{visitor.purpose} · {visitor.mobile}</p>
        {visitor.vehicleNumber && <p>Vehicle: {visitor.vehicleNumber}</p>}
        <p className="text-[11px] text-outline">In: {formatDateTime(visitor.checkedInAt)}{visitor.checkedOutAt ? ` · Out: ${formatDateTime(visitor.checkedOutAt)}` : ''}</p>
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