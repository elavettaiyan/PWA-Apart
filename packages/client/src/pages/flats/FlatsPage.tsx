import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Building2, User, Phone, Mail, Layers, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { getFlatTypeLabel, getStatusColor, cn } from '../../lib/utils';
import { PageLoader, EmptyState } from '../../components/ui/Loader';
import Modal from '../../components/ui/Modal';
import type { Flat, Block } from '../../types';

export default function FlatsPage() {
  const [showAddFlat, setShowAddFlat] = useState(false);
  const [showAddBlock, setShowAddBlock] = useState(false);
  const [showAddOwner, setShowAddOwner] = useState(false);
  const [selectedFlat, setSelectedFlat] = useState<Flat | null>(null);
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  const { data: flats = [], isLoading } = useQuery<Flat[]>({
    queryKey: ['flats'],
    queryFn: async () => (await api.get('/flats/flats')).data,
  });

  const { data: blocks = [] } = useQuery<Block[]>({
    queryKey: ['blocks'],
    queryFn: async () => (await api.get('/flats/blocks')).data,
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
          <h1 className="page-title">Flats & Residents</h1>
          <p className="text-sm text-gray-500 mt-1">Manage all flats, owners, and tenants</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setShowAddBlock(true)}>
              <Layers className="w-4 h-4" /> Add Block
            </button>
            <button className="btn-primary" onClick={() => setShowAddFlat(true)}>
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
              <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <Layers className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{block.name}</p>
                <p className="text-xs text-gray-500">{block.floors} floors · {block._count?.flats ?? 0} flats</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          className="input pl-10"
          placeholder="Search by flat number, owner, or tenant..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
              className="card p-4 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => { setSelectedFlat(flat); setShowAddOwner(true); }}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold',
                    flat.isOccupied ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-400',
                  )}>
                    {flat.flatNumber}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{flat.flatNumber}</p>
                    <p className="text-xs text-gray-500">{flat.block?.name} · Floor {flat.floor}</p>
                  </div>
                </div>
                <span className={cn('badge', flat.isOccupied ? 'badge-success' : 'badge-neutral')}>
                  {flat.isOccupied ? 'Occupied' : 'Vacant'}
                </span>
              </div>

              <div className="space-y-2 text-xs text-gray-500">
                <div className="flex justify-between">
                  <span>Type</span>
                  <span className="font-medium text-gray-700">{getFlatTypeLabel(flat.type)}</span>
                </div>
                {flat.areaSqFt && (
                  <div className="flex justify-between">
                    <span>Area</span>
                    <span className="font-medium text-gray-700">{flat.areaSqFt} sq.ft</span>
                  </div>
                )}
              </div>

              {flat.owner && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <div className="flex items-center gap-2">
                    <User className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-xs font-medium text-gray-700">{flat.owner.name}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Phone className="w-3 h-3 text-gray-400" />
                    <span className="text-xs text-gray-500">{flat.owner.phone}</span>
                  </div>
                </div>
              )}

              {flat.tenant && flat.tenant.isActive && (
                <div className="mt-2 pt-2 border-t border-dashed border-gray-100">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Tenant</p>
                  <div className="flex items-center gap-2">
                    <User className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-xs font-medium text-blue-700">{flat.tenant.name}</span>
                  </div>
                </div>
              )}
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
        <AddFlatForm blocks={blocks} onSuccess={() => { setShowAddFlat(false); queryClient.invalidateQueries({ queryKey: ['flats'] }); }} />
      </Modal>

      {/* Add Owner Modal */}
      <Modal isOpen={showAddOwner} onClose={() => setShowAddOwner(false)} title={`Manage - ${selectedFlat?.flatNumber}`} size="lg">
        {selectedFlat && (
          <AddOwnerForm flat={selectedFlat} onSuccess={() => { setShowAddOwner(false); queryClient.invalidateQueries({ queryKey: ['flats'] }); }} />
        )}
      </Modal>
    </div>
  );
}

// ── Add Block Form ──────────────────────────────────────
function AddBlockForm({ onSuccess }: { onSuccess: () => void }) {
  const user = useAuthStore((s) => s.user);
  const [form, setForm] = useState({ name: '', floors: 1 });

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
            onChange={(e) => setForm({ ...form, floors: Number(e.target.value) })}
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
function AddFlatForm({ blocks, onSuccess }: { blocks: Block[]; onSuccess: () => void }) {
  const [form, setForm] = useState({ flatNumber: '', floor: 1, type: 'TWO_BHK', areaSqFt: '', blockId: blocks[0]?.id || '' });

  const mutation = useMutation({
    mutationFn: (data: any) => api.post('/flats/flats', data),
    onSuccess: () => { toast.success('Flat added!'); onSuccess(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate({ ...form, floor: Number(form.floor), areaSqFt: form.areaSqFt ? Number(form.areaSqFt) : undefined });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Block/Wing</label>
          <select className="select" value={form.blockId} onChange={(e) => setForm({ ...form, blockId: e.target.value })} required>
            {blocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Flat Number</label>
          <input className="input" value={form.flatNumber} onChange={(e) => setForm({ ...form, flatNumber: e.target.value })} required placeholder="e.g. A-101" />
        </div>
        <div>
          <label className="label">Floor</label>
          <input type="number" className="input" value={form.floor} onChange={(e) => setForm({ ...form, floor: Number(e.target.value) })} min={0} required />
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
        <button type="submit" className="btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Adding...' : 'Add Flat'}
        </button>
      </div>
    </form>
  );
}

// ── Add/Edit Owner Form ─────────────────────────────────
function AddOwnerForm({ flat, onSuccess }: { flat: Flat; onSuccess: () => void }) {
  const [form, setForm] = useState({
    name: flat.owner?.name || '',
    phone: flat.owner?.phone || '',
    email: flat.owner?.email || '',
    aadharNo: flat.owner?.aadharNo || '',
    panNo: flat.owner?.panNo || '',
  });

  const mutation = useMutation({
    mutationFn: (data: any) => {
      if (flat.owner?.id) {
        return api.put(`/flats/owners/${flat.owner.id}`, data);
      }
      return api.post('/flats/owners', { ...data, flatId: flat.id });
    },
    onSuccess: () => { toast.success('Owner details saved!'); onSuccess(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(form);
  };

  return (
    <div>
      <div className="mb-4 p-3 bg-gray-50 rounded-lg">
        <p className="text-sm text-gray-600">
          <strong>Flat:</strong> {flat.flatNumber} · {flat.block?.name} · Floor {flat.floor} · {getFlatTypeLabel(flat.type)}
        </p>
      </div>

      <h3 className="font-semibold text-gray-900 mb-3">Owner Details</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Name *</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="label">Phone *</label>
            <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
          </div>
          <div>
            <label className="label">Email</label>
            <input type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
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
        <div className="flex justify-end gap-3 pt-4">
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving...' : flat.owner ? 'Update Owner' : 'Add Owner'}
          </button>
        </div>
      </form>
    </div>
  );
}
