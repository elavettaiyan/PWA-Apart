import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Clock3, MapPin, Plus, ImageIcon, X, Pencil, Trash2, BellRing } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { getApiBaseUrl } from '../../lib/platform';
import { cn, formatDateTime, getStatusColor } from '../../lib/utils';
import Modal from '../../components/ui/Modal';
import { EmptyState, PageLoader } from '../../components/ui/Loader';
import { useAuthStore } from '../../store/authStore';
import { SOCIETY_MANAGERS, type SocietyEvent } from '../../types';

const REMINDER_OPTIONS = [60, 180, 1440];
const MAX_IMAGES = 4;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

function toAssetUrl(value: string) {
  if (value.startsWith('data:') || value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }

  return `${getApiBaseUrl().replace('/api', '')}${value}`;
}

function toDateTimeLocalValue(value?: string | null) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  const pad = (input: number) => String(input).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toDateTimeParts(value?: string | null) {
  const localValue = toDateTimeLocalValue(value);
  if (!localValue) {
    return { date: '', time: '' };
  }

  const [date, time] = localValue.split('T');
  return {
    date,
    time: time || '',
  };
}

function formatSchedulePreview(dateValue: string, timeValue: string) {
  if (!dateValue && !timeValue) {
    return 'Select date and time';
  }

  if (dateValue && timeValue) {
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(`${dateValue}T${timeValue}`));
  }

  if (dateValue) {
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(`${dateValue}T00:00`));
  }

  return timeValue;
}

export default function EventsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [editingEvent, setEditingEvent] = useState<SocietyEvent | null>(null);
  const [filter, setFilter] = useState<'UPCOMING' | 'PAST' | 'CANCELLED'>('UPCOMING');
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const canManage = user?.role === 'SUPER_ADMIN' || SOCIETY_MANAGERS.includes((user?.role || '') as any);

  const { data: events = [], isLoading } = useQuery<SocietyEvent[]>({
    queryKey: ['events'],
    queryFn: async () => (await api.get('/events')).data,
  });

  const deleteMutation = useMutation({
    mutationFn: (eventId: string) => api.delete(`/events/${eventId}`),
    onSuccess: () => {
      toast.success('Event deleted');
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
    onError: (error: any) => toast.error(error.response?.data?.error || 'Failed to delete event'),
  });

  const reminderMutation = useMutation({
    mutationFn: () => api.post('/events/reminders/send'),
    onSuccess: (response) => {
      const count = response.data?.reminderCount || 0;
      toast.success(count > 0 ? `${count} reminders sent` : 'No reminders were due');
    },
    onError: (error: any) => toast.error(error.response?.data?.error || 'Failed to send reminders'),
  });

  const visibleEvents = useMemo(() => {
    const now = Date.now();
    return events.filter((event) => {
      if (filter === 'CANCELLED') {
        return event.status === 'CANCELLED';
      }
      if (filter === 'PAST') {
        return event.status !== 'CANCELLED' && new Date(event.startAt).getTime() < now;
      }
      return event.status === 'SCHEDULED' && new Date(event.startAt).getTime() >= now;
    });
  }, [events, filter]);

  if (isLoading) return <PageLoader />;

  return (
    <div>
      <div className="page-header">
        <div>
          <p className="section-label mb-2">Community</p>
          <h1 className="page-title">Events</h1>
          <p className="text-sm text-on-surface-variant mt-1">Plan society gatherings and send reminders to members.</p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={() => reminderMutation.mutate()} disabled={reminderMutation.isPending}>
              <BellRing className="w-4 h-4" /> {reminderMutation.isPending ? 'Sending...' : 'Send Due Reminders'}
            </button>
            <button className="btn-primary" onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4" /> New Event
            </button>
          </div>
        )}
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {[
          { id: 'UPCOMING', label: 'Upcoming' },
          { id: 'PAST', label: 'Past' },
          { id: 'CANCELLED', label: 'Cancelled' },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            className={cn(
              'rounded-full px-4 py-2 text-sm font-medium transition',
              filter === item.id ? 'bg-primary text-on-primary' : 'bg-surface-container-lowest text-on-surface-variant ghost-border hover:bg-surface-container-low',
            )}
            onClick={() => setFilter(item.id as typeof filter)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {visibleEvents.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No events found"
          description="Create a society event to notify residents and committee members."
        />
      ) : (
        <div className="space-y-4">
          {visibleEvents.map((event) => (
            <article key={event.id} className="card-elevated p-5 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-on-surface">{event.title}</h2>
                    <span className={cn('badge', getStatusColor(event.status))}>{event.status}</span>
                  </div>
                  <p className="mt-2 text-sm text-on-surface-variant whitespace-pre-wrap">{event.description}</p>
                </div>
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    <button className="btn-secondary" onClick={() => setEditingEvent(event)}>
                      <Pencil className="w-4 h-4" /> Edit
                    </button>
                    <button
                      className="btn-secondary text-error border-error/20 hover:bg-error-container/40"
                      onClick={() => deleteMutation.mutate(event.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4" /> Delete
                    </button>
                  </div>
                )}
              </div>

              <div className="grid gap-3 text-sm text-on-surface-variant sm:grid-cols-2 xl:grid-cols-3">
                <div className="flex items-center gap-2">
                  <Clock3 className="w-4 h-4 text-outline" />
                  <span>{formatDateTime(event.startAt)}{event.endAt ? ` - ${formatDateTime(event.endAt)}` : ''}</span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-outline" />
                  <span>{event.place}</span>
                </div>
                <div className="flex items-center gap-2">
                  <BellRing className="w-4 h-4 text-outline" />
                  <span>{event.reminderMinutes.length > 0 ? `${event.reminderMinutes.join(', ')} min reminders` : 'No reminders'}</span>
                </div>
              </div>

              {event.imageUrls.length > 0 && (
                <div className="flex flex-wrap gap-3">
                  {event.imageUrls.map((image, index) => (
                    <a
                      key={`${event.id}-${index}`}
                      href={toAssetUrl(image)}
                      target="_blank"
                      rel="noreferrer"
                      className="block h-24 w-24 overflow-hidden rounded-2xl border border-outline-variant/15"
                    >
                      <img src={toAssetUrl(image)} alt={event.title} className="h-full w-full object-cover" />
                    </a>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="New Event" size="lg">
        <EventForm
          onSuccess={() => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['events'] });
          }}
        />
      </Modal>

      <Modal isOpen={!!editingEvent} onClose={() => setEditingEvent(null)} title="Edit Event" size="lg">
        {editingEvent && (
          <EventForm
            event={editingEvent}
            onSuccess={() => {
              setEditingEvent(null);
              queryClient.invalidateQueries({ queryKey: ['events'] });
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function EventForm({ event, onSuccess }: { event?: SocietyEvent; onSuccess: () => void }) {
  const initialStart = toDateTimeParts(event?.startAt);
  const initialEnd = toDateTimeParts(event?.endAt);
  const [title, setTitle] = useState(event?.title || '');
  const [description, setDescription] = useState(event?.description || '');
  const [place, setPlace] = useState(event?.place || '');
  const [startDate, setStartDate] = useState(initialStart.date);
  const [startTime, setStartTime] = useState(initialStart.time);
  const [endDate, setEndDate] = useState(initialEnd.date);
  const [endTime, setEndTime] = useState(initialEnd.time);
  const [status, setStatus] = useState<SocietyEvent['status']>(event?.status || 'SCHEDULED');
  const [reminderMinutes, setReminderMinutes] = useState<number[]>(event?.reminderMinutes || [60, 1440]);
  const [images, setImages] = useState<File[]>([]);

  const mutation = useMutation({
    mutationFn: (formData: FormData) => (
      event
        ? api.patch(`/events/${event.id}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } })
        : api.post('/events', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
    ),
    onSuccess: () => {
      toast.success(event ? 'Event updated' : 'Event created');
      onSuccess();
    },
    onError: (error: any) => toast.error(error.response?.data?.error || 'Failed to save event'),
  });

  const handleImageChange = (eventInput: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(eventInput.target.files || []);
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
    eventInput.target.value = '';
  };

  const handleSubmit = (submitEvent: React.FormEvent) => {
    submitEvent.preventDefault();
    const formData = new FormData();
    formData.append('title', title.trim());
    formData.append('description', description.trim());
    formData.append('place', place.trim());
    formData.append('startAt', new Date(`${startDate}T${startTime}`).toISOString());
    if (endDate && endTime) {
      formData.append('endAt', new Date(`${endDate}T${endTime}`).toISOString());
    }
    formData.append('status', event ? status : 'SCHEDULED');
    formData.append('reminderMinutes', JSON.stringify(reminderMinutes));
    images.forEach((image) => formData.append('images', image));
    mutation.mutate(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Title</label>
        <input className="input" value={title} onChange={(inputEvent) => setTitle(inputEvent.target.value)} required />
      </div>
      <div>
        <label className="label">Description</label>
        <textarea className="input min-h-[120px]" value={description} onChange={(inputEvent) => setDescription(inputEvent.target.value)} required />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <DateTimeField
          label="Start schedule"
          dateValue={startDate}
          timeValue={startTime}
          onDateChange={setStartDate}
          onTimeChange={setStartTime}
          required
        />
        <DateTimeField
          label="End schedule"
          dateValue={endDate}
          timeValue={endTime}
          onDateChange={setEndDate}
          onTimeChange={setEndTime}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Place</label>
          <input className="input" value={place} onChange={(inputEvent) => setPlace(inputEvent.target.value)} required />
        </div>
        {event ? (
          <div>
            <label className="label">Status</label>
            <select className="select" value={status} onChange={(inputEvent) => setStatus(inputEvent.target.value as SocietyEvent['status'])}>
              <option value="SCHEDULED">Scheduled</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
        ) : null}
      </div>
      <div>
        <label className="label">Reminders</label>
        <div className="flex flex-wrap gap-2">
          {REMINDER_OPTIONS.map((minutes) => {
            const enabled = reminderMinutes.includes(minutes);
            return (
              <button
                key={minutes}
                type="button"
                className={cn(
                  'rounded-full px-4 py-2 text-sm font-medium transition',
                  enabled ? 'bg-primary text-on-primary' : 'bg-surface-container-lowest text-on-surface-variant ghost-border hover:bg-surface-container-low',
                )}
                onClick={() => setReminderMinutes((current) => (
                  current.includes(minutes)
                    ? current.filter((item) => item !== minutes)
                    : [...current, minutes].sort((left, right) => right - left)
                ))}
              >
                {minutes >= 1440 ? `${minutes / 1440} day before` : `${minutes / 60} hr before`}
              </button>
            );
          })}
        </div>
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
        {event?.imageUrls?.length ? (
          <p className="mt-2 text-xs text-on-surface-variant">Uploading new images will replace the current event gallery.</p>
        ) : null}
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
        <button
          type="submit"
          className="btn-primary"
          disabled={mutation.isPending || !title.trim() || !description.trim() || !place.trim() || !startDate || !startTime}
        >
          {mutation.isPending ? 'Saving...' : event ? 'Save Changes' : 'Create Event'}
        </button>
      </div>
    </form>
  );
}

function DateTimeField({
  label,
  dateValue,
  timeValue,
  onDateChange,
  onTimeChange,
  required = false,
}: {
  label: string;
  dateValue: string;
  timeValue: string;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  required?: boolean;
}) {
  const previewValue = formatSchedulePreview(dateValue, timeValue);
  const hasSelection = Boolean(dateValue || timeValue);

  return (
    <div>
      <label className="label">{label}</label>
      <div className="event-date-field">
        <div className="event-date-summary">
          <p className="event-date-summary-label">Selected</p>
          <p className={cn('event-date-summary-value', !hasSelection && 'event-date-summary-placeholder')}>
            {previewValue}
          </p>
        </div>
        <div className="event-date-segment">
          <span className="event-date-icon-wrap">
            <CalendarDays className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="event-date-caption">Date</p>
            <input
              className="event-picker-input"
              type="date"
              value={dateValue}
              onChange={(inputEvent) => onDateChange(inputEvent.target.value)}
              required={required}
            />
          </div>
        </div>
        <div className="event-date-segment">
          <span className="event-date-icon-wrap">
            <Clock3 className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="event-date-caption">Time</p>
            <input
              className="event-picker-input"
              type="time"
              value={timeValue}
              onChange={(inputEvent) => onTimeChange(inputEvent.target.value)}
              required={required}
            />
          </div>
        </div>
      </div>
    </div>
  );
}