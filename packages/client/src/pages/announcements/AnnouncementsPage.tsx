import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Plus, ImageIcon, X, Trash2, Pin, CheckCheck, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { getApiBaseUrl } from '../../lib/platform';
import { cn, formatDateTime } from '../../lib/utils';
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

export default function AnnouncementsPage({ embedded = false }: { embedded?: boolean }) {
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

  const pinMutation = useMutation({
    mutationFn: ({ announcementId, isPinned }: { announcementId: string; isPinned: boolean }) => (
      api.patch(`/announcements/${announcementId}/pin`, { isPinned })
    ),
    onSuccess: (_, variables) => {
      toast.success(variables.isPinned ? 'Announcement pinned' : 'Announcement unpinned');
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
    },
    onError: (error: any) => toast.error(error.response?.data?.error || 'Failed to update pin status'),
  });

  const readStateMutation = useMutation({
    mutationFn: ({ announcementId, isRead }: { announcementId: string; isRead: boolean }) => (
      api.patch(`/announcements/${announcementId}/read-state`, { isRead })
    ),
    onSuccess: (_, variables) => {
      toast.success(variables.isRead ? 'Marked as read' : 'Marked as unread');
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
    },
    onError: (error: any) => toast.error(error.response?.data?.error || 'Failed to update read state'),
  });

  if (isLoading) return <PageLoader />;

  return (
    <div>
      {!embedded ? (
        <div className="page-header">
          <div>
            <p className="section-label mb-1">Community</p>
            <h1 className="page-title">Announcements</h1>
          </div>
          {canManage && (
            <button className="btn-primary" onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4" /> New Announcement
            </button>
          )}
        </div>
      ) : canManage ? (
        <div className="flex justify-end">
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4" /> New
          </button>
        </div>
      ) : null}

      {announcements.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No announcements yet"
          description="Society announcements will appear here for all residents and committee members."
        />
      ) : (
        <div className="space-y-3 mt-4">
          {announcements.map((announcement) => (
            <article
              key={announcement.id}
              className={cn(
                'rounded-2xl overflow-hidden transition-shadow border-l-[3px]',
                announcement.isPinned
                  ? 'bg-primary/[0.03] ring-1 ring-primary/15 shadow-sm border-l-primary'
                  : !announcement.isRead
                    ? 'bg-surface-container-low/80 shadow-sm ring-1 ring-outline-variant/10 border-l-amber-400'
                    : 'bg-surface-container-lowest shadow-sm ring-1 ring-outline-variant/10 border-l-transparent',
              )}
            >
              {/* Header row: badges */}
              {(announcement.isPinned || !announcement.isRead) && (
                <div className="flex items-center gap-2 px-4 pt-3 pb-0">
                  {announcement.isPinned && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                      <Pin className="h-3 w-3" /> Pinned
                    </span>
                  )}
                  {!announcement.isRead && (
                    <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                      New
                    </span>
                  )}
                </div>
              )}

              {/* Content */}
              <div className="px-4 pt-3 pb-2">
                <h2 className="text-[15px] font-semibold text-on-surface leading-snug">{announcement.title}</h2>
                <p className="text-[11px] text-on-surface-variant mt-1">
                  {announcement.createdBy?.name || 'Committee'} · {formatDateTime(announcement.createdAt)}
                </p>
                <p className="text-sm leading-relaxed text-on-surface-variant mt-2 line-clamp-3 whitespace-pre-wrap">{announcement.message}</p>
              </div>

              {/* Images */}
              {announcement.images.length > 0 && (
                <div className="flex gap-2 px-4 pb-2 overflow-x-auto">
                  {announcement.images.map((image, index) => (
                    <a
                      key={`${announcement.id}-${index}`}
                      href={toAssetUrl(image)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-shrink-0 h-20 w-20 overflow-hidden rounded-xl border border-outline-variant/10"
                    >
                      <img src={toAssetUrl(image)} alt={announcement.title} className="h-full w-full object-cover" />
                    </a>
                  ))}
                </div>
              )}

              {/* Action bar */}
              <div className="flex items-center border-t border-outline-variant/10 px-2 py-1">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-on-surface-variant hover:bg-surface-container-low transition"
                  onClick={() => readStateMutation.mutate({ announcementId: announcement.id, isRead: !announcement.isRead })}
                  disabled={readStateMutation.isPending}
                >
                  {announcement.isRead ? <RotateCcw className="w-3.5 h-3.5" /> : <CheckCheck className="w-3.5 h-3.5" />}
                  {announcement.isRead ? 'Unread' : 'Read'}
                </button>
                {canManage && (
                  <>
                    <button
                      type="button"
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition',
                        announcement.isPinned
                          ? 'text-primary hover:bg-primary/5'
                          : 'text-on-surface-variant hover:bg-surface-container-low',
                      )}
                      onClick={() => pinMutation.mutate({ announcementId: announcement.id, isPinned: !announcement.isPinned })}
                      disabled={pinMutation.isPending}
                    >
                      <Pin className="w-3.5 h-3.5" />
                      {announcement.isPinned ? 'Unpin' : 'Pin'}
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-error hover:bg-error-container/30 transition ml-auto"
                      onClick={() => deleteMutation.mutate(announcement.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete
                    </button>
                  </>
                )}
                {!canManage && <span className="ml-auto" />}
              </div>
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