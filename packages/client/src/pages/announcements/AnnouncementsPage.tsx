import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Plus, ImageIcon, X, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { getApiBaseUrl } from '../../lib/platform';
import { formatDateTime } from '../../lib/utils';
import Modal from '../../components/ui/Modal';
import { EmptyState, PageLoader } from '../../components/ui/Loader';
import { useAuthStore } from '../../store/authStore';
import { SOCIETY_MANAGERS, type Announcement } from '../../types';

const MAX_IMAGES = 4;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

function toAssetUrl(value: string) {
  if (value.startsWith('data:') || value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }

  return `${getApiBaseUrl().replace('/api', '')}${value}`;
}

export default function AnnouncementsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const canManage = user?.role === 'SUPER_ADMIN' || SOCIETY_MANAGERS.includes((user?.role || '') as any);

  const { data: announcements = [], isLoading } = useQuery<Announcement[]>({
    queryKey: ['announcements'],
    queryFn: async () => (await api.get('/announcements')).data,
  });

  const deleteMutation = useMutation({
    mutationFn: (announcementId: string) => api.delete(`/announcements/${announcementId}`),
    onSuccess: () => {
      toast.success('Announcement deleted');
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
    },
    onError: (error: any) => toast.error(error.response?.data?.error || 'Failed to delete announcement'),
  });

  if (isLoading) return <PageLoader />;

  return (
    <div>
      <div className="page-header">
        <div>
          <p className="section-label mb-2">Community</p>
          <h1 className="page-title">Announcements</h1>
          <p className="text-sm text-on-surface-variant mt-1">Society-wide updates from admins and committee members.</p>
        </div>
        {canManage && (
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4" /> New Announcement
          </button>
        )}
      </div>

      {announcements.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No announcements yet"
          description="Society announcements will appear here for all residents and committee members."
        />
      ) : (
        <div className="space-y-4">
          {announcements.map((announcement) => (
            <article key={announcement.id} className="card-elevated p-5 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-on-surface">{announcement.title}</h2>
                  <p className="text-xs text-on-surface-variant mt-1">
                    {announcement.createdBy?.name || 'Committee'} · {formatDateTime(announcement.createdAt)}
                  </p>
                </div>
                {canManage && (
                  <button
                    type="button"
                    className="btn-secondary text-error border-error/20 hover:bg-error-container/40"
                    onClick={() => deleteMutation.mutate(announcement.id)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="w-4 h-4" /> Delete
                  </button>
                )}
              </div>

              <p className="text-sm leading-6 text-on-surface-variant whitespace-pre-wrap">{announcement.message}</p>

              {announcement.images.length > 0 && (
                <div className="flex flex-wrap gap-3">
                  {announcement.images.map((image, index) => (
                    <a
                      key={`${announcement.id}-${index}`}
                      href={toAssetUrl(image)}
                      target="_blank"
                      rel="noreferrer"
                      className="block h-24 w-24 overflow-hidden rounded-2xl border border-outline-variant/15"
                    >
                      <img src={toAssetUrl(image)} alt={announcement.title} className="h-full w-full object-cover" />
                    </a>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="New Announcement" size="lg">
        <AnnouncementForm
          onSuccess={() => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['announcements'] });
          }}
        />
      </Modal>
    </div>
  );
}

function AnnouncementForm({ onSuccess }: { onSuccess: () => void }) {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [images, setImages] = useState<File[]>([]);

  const mutation = useMutation({
    mutationFn: (formData: FormData) => api.post('/announcements', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
    onSuccess: () => {
      toast.success('Announcement sent');
      onSuccess();
    },
    onError: (error: any) => toast.error(error.response?.data?.error || 'Failed to create announcement'),
  });

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    const nextFiles: File[] = [];

    for (const file of files) {
      if (images.length + nextFiles.length >= MAX_IMAGES) {
        toast.error(`Maximum ${MAX_IMAGES} images allowed`);
        break;
      }
      if (file.size > MAX_IMAGE_SIZE) {
        toast.error(`"${file.name}" exceeds 5 MB limit`);
        continue;
      }
      nextFiles.push(file);
    }

    setImages((current) => [...current, ...nextFiles]);
    event.target.value = '';
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const formData = new FormData();
    formData.append('title', title.trim());
    formData.append('message', message.trim());
    images.forEach((image) => formData.append('images', image));
    mutation.mutate(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Title</label>
        <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} required />
      </div>
      <div>
        <label className="label">Message</label>
        <textarea
          className="input min-h-[140px]"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          required
          placeholder="Write the society-wide announcement"
        />
      </div>
      <div>
        <label className="label">Images</label>
        {images.length < MAX_IMAGES && (
          <label className="flex w-fit cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed border-outline-variant/30 px-4 py-2 hover:border-primary">
            <ImageIcon className="w-4 h-4 text-outline" />
            <span className="text-sm text-on-surface-variant">Choose images</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={handleImageChange} />
          </label>
        )}
        {images.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-3">
            {images.map((image, index) => (
              <div key={`${image.name}-${index}`} className="relative h-20 w-20 overflow-hidden rounded-2xl border border-outline-variant/15">
                <img src={URL.createObjectURL(image)} alt={image.name} className="h-full w-full object-cover" />
                <button
                  type="button"
                  className="absolute right-1 top-1 rounded-full bg-black/55 p-1 text-white"
                  onClick={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <button type="submit" className="btn-primary" disabled={mutation.isPending || !title.trim() || !message.trim()}>
          {mutation.isPending ? 'Sending...' : 'Send Announcement'}
        </button>
      </div>
    </form>
  );
}