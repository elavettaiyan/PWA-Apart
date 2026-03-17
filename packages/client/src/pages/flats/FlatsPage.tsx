import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Building2, User, Phone, Layers, Trash2, Upload, Download, FileSpreadsheet } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { getFlatTypeLabel, cn } from '../../lib/utils';
import { PageLoader, EmptyState } from '../../components/ui/Loader';
import Modal from '../../components/ui/Modal';
import type { Flat, Block } from '../../types';

export default function FlatsPage() {
  const [showAddFlat, setShowAddFlat] = useState(false);
  const [showAddBlock, setShowAddBlock] = useState(false);
  const [showAddOwner, setShowAddOwner] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [activeFlat, setActiveFlat] = useState<Flat | null>(null);
  const [selectedFlatId, setSelectedFlatId] = useState<string | null>(null);
  const [showDeleteFlat, setShowDeleteFlat] = useState(false);
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

  const selectedFlat = useMemo(
    () => flats.find((flat) => flat.id === selectedFlatId) ?? null,
    [flats, selectedFlatId],
  );

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
          <h1 className="page-title">Flats & Residents</h1>
          <p className="text-sm text-gray-500 mt-1">Manage all flats, owners, and tenants</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <button
              className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => setShowDeleteFlat(true)}
              disabled={!selectedFlat}
            >
              <Trash2 className="w-4 h-4" /> Delete Selected
            </button>
            <button className="btn-secondary" onClick={() => setShowBulkUpload(true)}>
              <Upload className="w-4 h-4" /> Bulk Upload
            </button>
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

      <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-amber-900">Admin delete control</p>
            <p className="text-xs text-amber-800 mt-1">
              Select one apartment, then confirm its flat number to delete it. Deletion is blocked if the flat still has an owner, tenant, bills, or complaints.
            </p>
          </div>
          <div className="rounded-xl bg-white/80 px-3 py-2 text-sm text-gray-700 border border-amber-100 min-w-[220px]">
            {selectedFlat ? (
              <>
                <p className="font-semibold text-gray-900">{selectedFlat.flatNumber}</p>
                <p className="text-xs text-gray-500">{selectedFlat.block?.name} · Floor {selectedFlat.floor}</p>
              </>
            ) : (
              <p className="text-xs text-gray-500">No apartment selected</p>
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
                selectedFlatId === flat.id ? 'border-primary-500 ring-2 ring-primary-100' : 'border-transparent',
              )}
              onClick={() => setSelectedFlatId(flat.id)}
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
                <div className="flex justify-between">
                  <span>Status</span>
                  <span className="font-medium text-gray-700">{flat.isOccupied ? 'Occupied' : 'Vacant'}</span>
                </div>
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
        <AddFlatForm blocks={blocks} onSuccess={() => { setShowAddFlat(false); queryClient.invalidateQueries({ queryKey: ['flats'] }); }} />
      </Modal>

      {/* Add Owner Modal */}
      <Modal isOpen={showAddOwner} onClose={() => setShowAddOwner(false)} title={`Manage - ${activeFlat?.flatNumber}`} size="lg">
        {activeFlat && (
          <AddOwnerForm flat={activeFlat} onSuccess={() => { setShowAddOwner(false); queryClient.invalidateQueries({ queryKey: ['flats'] }); }} />
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
            <p className="text-sm text-gray-600">Select an apartment first.</p>
          </div>
        )}
      </Modal>

      {/* Bulk Upload Modal */}
      <Modal isOpen={showBulkUpload} onClose={() => setShowBulkUpload(false)} title="Bulk Upload Flats from Excel" size="lg">
        <BulkUploadForm onSuccess={() => { setShowBulkUpload(false); queryClient.invalidateQueries({ queryKey: ['flats'] }); queryClient.invalidateQueries({ queryKey: ['blocks'] }); }} />
      </Modal>
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
      <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3">
        <p className="text-sm font-semibold text-red-900">Delete {flat.flatNumber}</p>
        <p className="mt-1 text-xs text-red-700">
          This action is restricted to vacant flats with no linked owner, tenant, billing, or complaint history.
        </p>
      </div>

      <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-700">
        <p className="font-medium text-gray-900">{flat.block?.name} · Floor {flat.floor}</p>
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
          className="btn-primary bg-red-600 hover:bg-red-700 focus:ring-red-500 disabled:opacity-50"
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

  useEffect(() => {
    // Blocks are loaded asynchronously; ensure blockId is set once data arrives.
    if (!form.blockId && blocks.length > 0) {
      setForm((prev) => ({ ...prev, blockId: blocks[0].id }));
    }
  }, [blocks, form.blockId]);

  const mutation = useMutation({
    mutationFn: (data: any) => api.post('/flats/flats', data),
    onSuccess: () => { toast.success('Flat added!'); onSuccess(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
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
          {blocks.length === 0 && <p className="text-xs text-red-600 mt-1">No blocks found. Add a block first.</p>}
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
        <button type="submit" className="btn-primary" disabled={mutation.isPending || blocks.length === 0}>
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

      {!flat.owner && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
          <p className="text-xs text-blue-700">
            <strong>📱 Auto Login Creation:</strong> When you provide both email & phone number,
            a login account will be automatically created. The default password will be the phone number.
            The owner will be asked to change it on first login.
          </p>
        </div>
      )}

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

      {flat.owner?.email && (
        <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
          <p className="text-xs text-blue-700">
            <strong>Login Account:</strong> A login account {flat.owner.userId ? 'is linked' : 'will be created when email & phone are provided'} for this owner.
            Default password is the owner's phone number.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Bulk Upload Form ────────────────────────────────────
function BulkUploadForm({ onSuccess }: { onSuccess: () => void }) {
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
      <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
        <h3 className="text-sm font-semibold text-blue-900 mb-2 flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4" />
          Step 1: Download Template
        </h3>
        <p className="text-xs text-blue-700 mb-3">
          Download the Excel template, fill in your flat details, and upload it back.
          Owner accounts will be auto-created with phone number as default password.
        </p>
        <button onClick={handleDownloadTemplate} className="btn-secondary text-sm">
          <Download className="w-4 h-4" /> Download Template
        </button>
      </div>

      {/* Step 2: Upload File */}
      <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl">
        <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
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
          className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-primary-400 hover:bg-primary-50/50 transition"
        >
          {file ? (
            <div>
              <FileSpreadsheet className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
              <p className="text-sm font-medium text-gray-900">{file.name}</p>
              <p className="text-xs text-gray-500 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
              <p className="text-xs text-primary-600 mt-2">Click to change file</p>
            </div>
          ) : (
            <div>
              <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-600">Click to select Excel file</p>
              <p className="text-xs text-gray-400 mt-1">Supports .xlsx and .xls files</p>
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
        <div className="p-4 bg-white border border-gray-200 rounded-xl">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Upload Results</h3>

          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="p-3 bg-gray-50 rounded-lg text-center">
              <p className="text-lg font-bold text-gray-900">{results.total}</p>
              <p className="text-xs text-gray-500">Total Rows</p>
            </div>
            <div className="p-3 bg-emerald-50 rounded-lg text-center">
              <p className="text-lg font-bold text-emerald-700">{results.created}</p>
              <p className="text-xs text-emerald-600">Created</p>
            </div>
            <div className="p-3 bg-red-50 rounded-lg text-center">
              <p className="text-lg font-bold text-red-700">{results.errors}</p>
              <p className="text-xs text-red-600">Errors</p>
            </div>
          </div>

          {/* Detailed results */}
          <div className="max-h-48 overflow-y-auto space-y-1">
            {results.results.map((r, i) => (
              <div
                key={i}
                className={cn(
                  'flex items-center justify-between text-xs px-3 py-2 rounded',
                  r.status === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
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
