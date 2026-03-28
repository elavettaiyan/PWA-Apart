import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, UserCog, Phone, Mail, Wrench } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { PageLoader } from '../../components/ui/Loader';

type StaffMember = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  specialization: string | null;
  isActive: boolean;
  createdAt: string;
};

const SPECIALIZATIONS = ['Electrician', 'Plumber', 'Carpenter', 'Cleaner', 'Security', 'Gardener', 'Lift Operator', 'Other'];

export default function StaffPage() {
  const [showCreate, setShowCreate] = useState(false);
  const queryClient = useQueryClient();

  const { data: staff = [], isLoading } = useQuery<StaffMember[]>({
    queryKey: ['staff'],
    queryFn: async () => (await api.get('/staff')).data,
  });

  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="section-label mb-2">People</p>
          <h1 className="page-title">Manage Staff</h1>
          <p className="text-sm text-on-surface-variant">Create and manage service staff accounts</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4 mr-1" /> Add Staff
        </button>
      </div>

      {showCreate && (
        <CreateStaffForm
          onClose={() => setShowCreate(false)}
          onSuccess={() => { setShowCreate(false); queryClient.invalidateQueries({ queryKey: ['staff'] }); }}
        />
      )}

      {staff.length === 0 ? (
        <div className="card p-6 text-center">
          <UserCog className="w-12 h-12 text-outline/40 mx-auto mb-3" />
          <p className="text-on-surface-variant">No staff members yet</p>
          <p className="text-sm text-outline">Add service staff like electricians, plumbers, cleaners, etc.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {staff.map((member) => (
            <StaffCard key={member.id} member={member} />
          ))}
        </div>
      )}
    </div>
  );
}

function CreateStaffForm({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', specialization: '', password: '' });

  const create = useMutation({
    mutationFn: (data: typeof form) => api.post('/staff', data),
    onSuccess: (response) => {
      toast.success(response.data?.message || 'Staff member created');
      onSuccess();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to create staff'),
  });

  return (
    <div className="card p-6">
      <h3 className="font-semibold text-on-surface mb-4">Add New Staff Member</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Name *</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="label">Email *</label>
          <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <div>
          <label className="label">Specialization</label>
          <select className="select" value={form.specialization} onChange={(e) => setForm({ ...form, specialization: e.target.value })}>
            <option value="">Select...</option>
            {SPECIALIZATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Password</label>
          <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Required only for a brand new account" />
          <p className="mt-1 text-xs text-on-surface-variant">
            If this email already belongs to a service staff account in another apartment, the existing account will be linked to this society.
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-3 mt-4">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button
          className="btn-primary"
          onClick={() => create.mutate(form)}
          disabled={create.isPending || !form.name || !form.email}
        >
          {create.isPending ? 'Creating...' : 'Create'}
        </button>
      </div>
    </div>
  );
}

function StaffCard({ member }: { member: StaffMember }) {
  const queryClient = useQueryClient();

  const toggleActive = useMutation({
    mutationFn: () => api.patch(`/staff/${member.id}`, { isActive: !member.isActive }),
    onSuccess: () => { toast.success(member.isActive ? 'Staff deactivated' : 'Staff activated'); queryClient.invalidateQueries({ queryKey: ['staff'] }); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  return (
    <div className={`card p-5 ${!member.isActive ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-on-surface">{member.name}</h3>
          {member.specialization && (
            <span className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full mt-1">
              <Wrench className="w-3 h-3" /> {member.specialization}
            </span>
          )}
        </div>
        <button
          className={`text-xs px-2.5 py-1 rounded-full font-medium ${member.isActive ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-rose-900'}`}
          onClick={() => toggleActive.mutate()}
          disabled={toggleActive.isPending}
        >
          {member.isActive ? 'Active' : 'Inactive'}
        </button>
      </div>
      <div className="space-y-1.5 text-sm text-on-surface-variant">
        <p className="flex items-center gap-2"><Mail className="w-3.5 h-3.5 text-outline" /> {member.email}</p>
        {member.phone && <p className="flex items-center gap-2"><Phone className="w-3.5 h-3.5 text-outline" /> {member.phone}</p>}
      </div>
    </div>
  );
}
