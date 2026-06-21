import { Building2, Info, Layers3, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';
import { useCreateBlockMutation, useDeleteBlockMutation, useSocieties, useUpdateBlockMutation } from '@/hooks/flatsHooks';
import type { Block } from '@/types';

interface AddBlockFormProps {
  block?: Block | null;
  onSuccess: () => void;
  onDeleteSuccess?: () => void;
}

export function AddBlockForm({ block, onSuccess, onDeleteSuccess }: AddBlockFormProps) {
  const user = useAuthStore((s) => s.user);
  const [form, setForm] = useState({
    name: '',
    totalWings: '',
    floors: '1',
    description: '',
  });
  const [societyId, setSocietyId] = useState('');

  const { data: societies = [] } = useSocieties();
  const createMutation = useCreateBlockMutation();
  const updateMutation = useUpdateBlockMutation();
  const deleteMutation = useDeleteBlockMutation();
  const mutation = block ? updateMutation : createMutation;

  useEffect(() => {
    setForm({
      name: block?.name || '',
      totalWings: block?.totalWings ? String(block.totalWings) : '',
      floors: String(block?.floors || 1),
      description: block?.description || '',
    });
  }, [block]);

  const effectiveSocietyId = societyId || user?.societyId || (societies && societies[0]?.id) || '';
  const isEditing = Boolean(block);

  const mappedFlatCount = block?._count?.flats ?? 0;
  const canDeleteBlock = isEditing && mappedFlatCount === 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEditing && !effectiveSocietyId) {
      toast.error('No society found. Please contact admin.');
      return;
    }

    if (isEditing && !block?.id) {
      toast.error('Block details are incomplete. Please reopen the editor and try again.');
      return;
    }

    const payload = {
      name: form.name.trim(),
      totalWings: form.totalWings ? Number(form.totalWings) : undefined,
      floors: Number(form.floors),
      description: form.description.trim() || undefined,
      ...(isEditing ? { blockId: block!.id } : { societyId: effectiveSocietyId }),
    };

    mutation.mutate(
      payload,
      {
        onSuccess: () => {
          toast.success(isEditing ? 'Block updated successfully!' : 'Block created successfully!');
          onSuccess();
        },
        onError: (e: any) => toast.error(e.response?.data?.error || `Failed to ${isEditing ? 'update' : 'create'} block`),
      }
    );
  };

  const handleDelete = () => {
    if (!block?.id || !canDeleteBlock) {
      return;
    }

    if (!window.confirm(`Delete block "${block.name}"? This is only allowed when no flats are mapped.`)) {
      return;
    }

    deleteMutation.mutate(block.id, {
      onSuccess: () => {
        toast.success('Block deleted successfully!');
        onDeleteSuccess?.();
      },
      onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to delete block'),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <section className="rounded-[28px] border border-outline-variant/60 bg-surface-container-lowest p-5 shadow-[0_4px_12px_rgba(0,0,0,0.03)] sm:p-6 lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-8">
        <div className="mb-6 lg:mb-0 lg:pr-2">
          <h3 className="font-headline text-xl font-semibold text-primary">
            {isEditing ? 'Edit Block' : 'Add New Block'}
          </h3>
          <p className="mt-2 text-sm leading-6 text-on-surface-variant">
            {isEditing
              ? 'Update the details for the residential unit. Ensure all fields reflect the current physical layout of the block.'
              : 'Define the structure and basic information for the new residential block.'}
          </p>

          {!isEditing ? (
            <div className="mt-6 rounded-[24px] border border-dashed border-outline-variant/80 bg-surface-container-lowest px-5 py-8 text-center">
              <Building2 className="mx-auto mb-3 h-10 w-10 text-outline" />
              <p className="text-sm font-semibold text-outline">Define the block structure first</p>
              <p className="mt-2 text-xs text-on-surface-variant">You can add flats and residents after the block is created.</p>
            </div>
          ) : null}
        </div>

        <div className="space-y-5">
          {user?.role === 'SUPER_ADMIN' && societies.length > 1 && !isEditing && (
            <div>
              <label className="label !mb-2 !normal-case !tracking-normal">Society</label>
              <select className="select !h-14 !rounded-2xl !bg-surface-container-low" value={effectiveSocietyId} onChange={(e) => setSocietyId(e.target.value)} required>
                {societies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}

          <FieldShell label="Block Name" icon={<Building2 className="h-5 w-5" />}>
            <input
              className="input !h-14 !rounded-2xl !border-outline-variant/80 !bg-surface-container-low pl-12 text-base"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              placeholder="e.g. North Block, Wing A"
            />
          </FieldShell>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FieldShell label="Total Wings" icon={<Building2 className="h-5 w-5" />}>
              <input
                type="number"
                className="input !h-14 !rounded-2xl !border-outline-variant/80 !bg-surface-container-low pl-12 text-base"
                value={form.totalWings}
                onChange={(e) => setForm({ ...form, totalWings: e.target.value })}
                min={1}
                placeholder="0"
              />
            </FieldShell>

            <FieldShell label="Total Floors" icon={<Layers3 className="h-5 w-5" />}>
              <input
                type="number"
                className="input !h-14 !rounded-2xl !border-outline-variant/80 !bg-surface-container-low pl-12 text-base"
                value={form.floors}
                onChange={(e) => setForm({ ...form, floors: e.target.value })}
                min={1}
                required
                placeholder="0"
              />
            </FieldShell>
          </div>

          <div>
            <label className="label !mb-2 !normal-case !tracking-normal">Description</label>
            <textarea
              className="input min-h-[140px] !rounded-2xl !border-outline-variant/80 !bg-surface-container-low text-base leading-8"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Briefly describe the block, its primary usage, or specific characteristics..."
            />
          </div>

          {isEditing ? (
            <div className="flex items-center justify-between border-t border-outline-variant/70 pt-5 text-sm">
              <div className="flex items-center gap-2 text-secondary">
                <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-current text-[10px]">✓</span>
                <span className="font-semibold">Mapped Flats: {mappedFlatCount}</span>
              </div>
              <span className="text-on-surface-variant">Resident occupancy is managed from the Flats &amp; Residents view.</span>
            </div>
          ) : null}
        </div>
      </section>

      <div className="flex items-start gap-3 px-1 text-xs italic text-on-surface-variant">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-outline" />
        <p>Changes to block infrastructure may affect service billing and resident directory records.</p>
      </div>

      <div className="sticky bottom-0 -mx-5 border-t border-outline-variant/70 bg-surface px-5 pb-[calc(1rem+var(--sab,0px))] pt-4 sm:-mx-6 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row-reverse">
          <button type="submit" className="btn-primary h-14 w-full justify-center rounded-[22px] text-lg font-semibold" disabled={mutation.isPending || deleteMutation.isPending}>
            <Save className="h-5 w-5" />
            {mutation.isPending ? (isEditing ? 'Updating...' : 'Creating...') : (isEditing ? 'Update Block' : 'Create Block')}
          </button>
          {canDeleteBlock ? (
            <button
              type="button"
              className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-[22px] border border-red-200 bg-red-50 px-5 text-base font-semibold text-red-600 transition hover:border-red-300 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:min-w-[220px]"
              onClick={handleDelete}
              disabled={mutation.isPending || deleteMutation.isPending}
            >
              <Trash2 className="h-5 w-5" />
              {deleteMutation.isPending ? 'Deleting...' : 'Delete Block'}
            </button>
          ) : null}
        </div>
      </div>
    </form>
  );
}

function FieldShell({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label !mb-2 !normal-case !tracking-normal">{label}</label>
      <div className="relative">
        <div className={cn('pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-outline')}>
          {icon}
        </div>
        {children}
      </div>
    </div>
  );
}
