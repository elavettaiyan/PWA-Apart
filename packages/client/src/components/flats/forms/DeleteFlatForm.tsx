import { useState } from 'react';
import type { Flat } from '@/types';

interface DeleteFlatFormProps {
  flat: Flat;
  isPending: boolean;
  onConfirm: (confirmation: string) => void;
}

export function DeleteFlatForm({ flat, isPending, onConfirm }: DeleteFlatFormProps) {
  const [confirmation, setConfirmation] = useState('');

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onConfirm(confirmation.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-xl border border-error/10 bg-error-container px-4 py-3">
        <p className="text-sm font-semibold text-on-error-container">Delete {flat.flatNumber}</p>
        <p className="mt-1 text-xs text-error">
          This action is restricted to vacant flats with no linked owner, tenant, billing, or complaint history.
        </p>
      </div>

      <div className="rounded-xl bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">
        <p className="font-medium text-on-surface">{flat.block?.name} · Floor {flat.floor}</p>
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
          className="btn-primary bg-error hover:bg-error/90 focus:ring-error disabled:opacity-50"
          disabled={isPending || confirmation.trim() !== flat.flatNumber}
        >
          {isPending ? 'Deleting...' : 'Delete Apartment'}
        </button>
      </div>
    </form>
  );
}
