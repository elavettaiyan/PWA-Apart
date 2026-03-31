import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ScrollText, Plus, Edit3, Trash2, Shield } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { PageLoader, EmptyState } from '../../components/ui/Loader';
import Modal from '../../components/ui/Modal';
import { useAuthStore } from '../../store/authStore';
import type { AssociationBylaw } from '../../types';

const BYLAW_CATEGORIES = ['General', 'Parking', 'Pets', 'Noise', 'Safety', 'Maintenance', 'Events', 'Other'];

export default function BylawsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [editBylaw, setEditBylaw] = useState<AssociationBylaw | null>(null);
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'SUPER_ADMIN' || (['ADMIN', 'SECRETARY', 'JOINT_SECRETARY'] as string[]).includes(user?.role || '');

  const { data, isLoading } = useQuery<{ bylaws: AssociationBylaw[]; grouped: Record<string, AssociationBylaw[]> }>({
    queryKey: ['bylaws'],
    queryFn: async () => (await api.get('/association')).data,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/association/${id}`),
    onSuccess: () => {
      toast.success('Bylaw removed');
      queryClient.invalidateQueries({ queryKey: ['bylaws'] });
    },
  });

  if (isLoading) return <PageLoader />;

  const grouped = data?.grouped || {};

  return (
    <div>
      <div className="page-header">
        <div>
          <p className="section-label mb-1">Documents</p>
          <h1 className="page-title">Bylaws</h1>
        </div>
        {isAdmin && (
          <button className="btn-primary text-xs px-3 py-1.5" onClick={() => setShowCreate(true)}>
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        )}
      </div>

      {Object.keys(grouped).length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No bylaws defined"
          description="Start by adding society rules and regulations"
          action={isAdmin ? <button className="btn-primary" onClick={() => setShowCreate(true)}>Add First Bylaw</button> : undefined}
        />
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([category, bylaws]) => (
            <div key={category}>
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-3.5 h-3.5 text-primary" />
                <h2 className="text-sm font-semibold text-on-surface">{category}</h2>
                <span className="badge badge-neutral text-[10px]">{bylaws.length}</span>
              </div>
              <div className="space-y-2">
                {bylaws.map((bylaw) => (
                  <div key={bylaw.id} className="card-elevated overflow-hidden">
                    <div className="px-4 pt-3 pb-2">
                      <h3 className="text-[13px] font-semibold text-on-surface">{bylaw.title}</h3>
                      <p className="text-xs text-on-surface-variant mt-1 whitespace-pre-wrap line-clamp-3">{bylaw.content}</p>
                    </div>
                    <div className="flex items-center justify-between border-t border-outline-variant/10 px-4 py-1.5">
                      <div className="flex items-center gap-3 text-[11px] text-outline">
                        <span>{formatDate(bylaw.effectiveDate)}</span>
                        {bylaw.penaltyAmount && (
                          <span className="text-error font-medium">{formatCurrency(bylaw.penaltyAmount)}</span>
                        )}
                      </div>
                      {isAdmin && (
                        <div className="flex gap-0.5">
                          <button
                            className="p-1.5 text-outline hover:text-primary hover:bg-primary-container rounded-lg"
                            onClick={() => setEditBylaw(bylaw)}
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            className="p-1.5 text-outline hover:text-error hover:bg-error-container rounded-lg"
                            onClick={() => {
                              if (confirm('Remove this bylaw?')) deleteMutation.mutate(bylaw.id);
                            }}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal
        isOpen={showCreate || !!editBylaw}
        onClose={() => { setShowCreate(false); setEditBylaw(null); }}
        title={editBylaw ? 'Edit Bylaw' : 'Add New Bylaw'}
        size="md"
      >
        <BylawForm
          bylaw={editBylaw}
          onSuccess={() => {
            setShowCreate(false);
            setEditBylaw(null);
            queryClient.invalidateQueries({ queryKey: ['bylaws'] });
          }}
        />
      </Modal>
    </div>
  );
}

function BylawForm({ bylaw, onSuccess }: { bylaw: AssociationBylaw | null; onSuccess: () => void }) {
  const [form, setForm] = useState({
    title: bylaw?.title || '',
    content: bylaw?.content || '',
    category: bylaw?.category || 'General',
    penaltyAmount: bylaw?.penaltyAmount?.toString() || '',
    effectiveDate: bylaw?.effectiveDate?.split('T')[0] || new Date().toISOString().split('T')[0],
  });

  const mutation = useMutation({
    mutationFn: (data: any) => {
      if (bylaw) return api.put(`/association/${bylaw.id}`, data);
      return api.post('/association', data);
    },
    onSuccess: () => {
      toast.success(bylaw ? 'Bylaw updated!' : 'Bylaw added!');
      onSuccess();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(form); }} className="space-y-4">
      <div>
        <label className="label">Title</label>
        <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Category</label>
          <select className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {BYLAW_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Penalty Amount (₹)</label>
          <input type="number" className="input" value={form.penaltyAmount} onChange={(e) => setForm({ ...form, penaltyAmount: e.target.value })} placeholder="Optional" />
        </div>
      </div>
      <div>
        <label className="label">Content / Rule Description</label>
        <textarea className="input min-h-[120px]" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} required />
      </div>
      <div>
        <label className="label">Effective Date</label>
        <input type="date" className="input w-48" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} required />
      </div>
      <div className="flex justify-end gap-3 pt-4">
        <button type="submit" className="btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving...' : bylaw ? 'Update Bylaw' : 'Add Bylaw'}
        </button>
      </div>
    </form>
  );
}
