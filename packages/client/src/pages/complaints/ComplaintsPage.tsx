import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquareWarning, Plus, MessageCircle, AlertTriangle, ImageIcon, X } from 'lucide-react';
import { getApiBaseUrl } from '../../lib/platform';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { getStatusColor, formatDate, cn } from '../../lib/utils';
import { PageLoader, EmptyState } from '../../components/ui/Loader';
import Modal from '../../components/ui/Modal';
import { getDefaultComplaintCategoryForUser, isNonSecurityServiceStaff } from '../../lib/serviceStaff';
import { useAuthStore } from '../../store/authStore';
import type { Complaint } from '../../types';

const CATEGORIES = ['Plumbing', 'Electrical', 'Civil', 'Lift', 'Parking', 'Security', 'Cleaning', 'Noise', 'Other'];

export default function ComplaintsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const defaultCategory = getDefaultComplaintCategoryForUser(user);
  const isSpecializedStaffView = isNonSecurityServiceStaff(user) && !!defaultCategory;

  const { data: complaints = [], isLoading } = useQuery<Complaint[]>({
    queryKey: ['complaints', statusFilter, defaultCategory],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (statusFilter) {
        searchParams.set('status', statusFilter);
      }
      if (defaultCategory) {
        searchParams.set('category', defaultCategory);
      }
      const query = searchParams.toString();
      return (await api.get(`/complaints${query ? `?${query}` : ''}`)).data;
    },
  });

  if (isLoading) return <PageLoader />;

  const statusCounts = {
    OPEN: complaints.filter((c) => c.status === 'OPEN').length,
    IN_PROGRESS: complaints.filter((c) => c.status === 'IN_PROGRESS').length,
    RESOLVED: complaints.filter((c) => c.status === 'RESOLVED').length,
    CLOSED: complaints.filter((c) => c.status === 'CLOSED').length,
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <p className="section-label mb-2">Service Desk</p>
          <h1 className="page-title">Complaints</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            {isSpecializedStaffView
              ? `${defaultCategory} complaints for your service desk`
              : 'Track and manage resident complaints'}
          </p>
        </div>
        {!isSpecializedStaffView && (
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4" /> New Complaint
          </button>
        )}
      </div>

      {/* Status Filter Pills */}
      <div className="flex flex-wrap gap-2 mb-6">
        {[
          { label: 'All', value: '', count: complaints.length },
          { label: 'Open', value: 'OPEN', count: statusCounts.OPEN },
          { label: 'In Progress', value: 'IN_PROGRESS', count: statusCounts.IN_PROGRESS },
          { label: 'Resolved', value: 'RESOLVED', count: statusCounts.RESOLVED },
          { label: 'Closed', value: 'CLOSED', count: statusCounts.CLOSED },
        ].map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={cn(
              'px-4 py-2 rounded-full text-sm font-medium transition',
              statusFilter === tab.value
                ? 'bg-primary text-on-primary'
                : 'bg-surface-container-lowest text-on-surface-variant ghost-border hover:bg-surface-container-low',
            )}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {/* Complaints List */}
      {complaints.length === 0 ? (
        <EmptyState
          icon={MessageSquareWarning}
          title="No complaints"
          description="All clear! No complaints at the moment."
        />
      ) : (
        <div className="space-y-3">
          {complaints.map((complaint) => (
            <div
              key={complaint.id}
              className="bg-surface-container-low rounded-2xl p-4 sm:p-5 hover:bg-surface-container transition-colors cursor-pointer"
              onClick={() => setSelectedComplaint(complaint)}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-semibold text-on-surface truncate">{complaint.title}</h3>
                    <span className={cn('badge', getStatusColor(complaint.priority))}>{complaint.priority}</span>
                  </div>
                  <p className="text-xs text-on-surface-variant line-clamp-2 mb-2">{complaint.description}</p>
                  <div className="flex flex-wrap gap-3 text-xs text-on-surface-variant">
                    <span>📋 {complaint.category}</span>
                    {complaint.flat && <span>🏠 {complaint.flat.block?.name} - {complaint.flat.flatNumber}</span>}
                    <span>👤 {complaint.createdBy?.name}</span>
                    <span>📅 {formatDate(complaint.createdAt)}</span>
                    {complaint._count?.comments ? (
                      <span className="flex items-center gap-1">
                        <MessageCircle className="w-3 h-3" /> {complaint._count.comments}
                      </span>
                    ) : null}
                  </div>
                </div>
                <span className={cn('badge shrink-0', getStatusColor(complaint.status))}>
                  {complaint.status.replace('_', ' ')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Complaint Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="New Complaint" size="md">
        <CreateComplaintForm onSuccess={() => { setShowCreate(false); queryClient.invalidateQueries({ queryKey: ['complaints'] }); }} />
      </Modal>

      {/* Complaint Detail Modal */}
      <Modal
        isOpen={!!selectedComplaint}
        onClose={() => setSelectedComplaint(null)}
        title={selectedComplaint?.title || ''}
        size="lg"
      >
        {selectedComplaint && (
          <ComplaintDetail
            complaint={selectedComplaint}
            onUpdate={() => { setSelectedComplaint(null); queryClient.invalidateQueries({ queryKey: ['complaints'] }); }}
          />
        )}
      </Modal>
    </div>
  );
}

const MAX_IMAGES = 2;
const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2 MB

function CreateComplaintForm({ onSuccess }: { onSuccess: () => void }) {
  const [form, setForm] = useState({ title: '', description: '', category: 'Plumbing', priority: 'MEDIUM' });
  const [images, setImages] = useState<File[]>([]);

  const mutation = useMutation({
    mutationFn: (formData: FormData) => api.post('/complaints', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
    onSuccess: () => { toast.success('Complaint submitted!'); onSuccess(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const valid: File[] = [];
    for (const file of files) {
      if (valid.length + images.length >= MAX_IMAGES) {
        toast.error(`Maximum ${MAX_IMAGES} images allowed`);
        break;
      }
      if (file.size > MAX_IMAGE_SIZE) {
        toast.error(`"${file.name}" exceeds 2 MB limit`);
        continue;
      }
      valid.push(file);
    }
    setImages((prev) => [...prev, ...valid]);
    e.target.value = ''; // reset input
  };

  const removeImage = (index: number) => setImages((prev) => prev.filter((_, i) => i !== index));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('title', form.title);
    formData.append('description', form.description);
    formData.append('category', form.category);
    formData.append('priority', form.priority);
    images.forEach((img) => formData.append('images', img));
    mutation.mutate(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Title</label>
        <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required placeholder="Brief description of the issue" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Category</label>
          <select className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Priority</label>
          <select className="select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </select>
        </div>
      </div>
      <div>
        <label className="label">Description</label>
        <textarea className="input min-h-[100px]" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required placeholder="Detailed description..." />
      </div>

      {/* Image Upload */}
      <div>
        <label className="label">Images (max {MAX_IMAGES}, under 2 MB each)</label>
        {images.length < MAX_IMAGES && (
          <label className="flex items-center gap-2 px-4 py-2 border-2 border-dashed border-outline-variant rounded-lg cursor-pointer hover:border-primary transition w-fit">
            <ImageIcon className="w-4 h-4 text-outline" />
            <span className="text-sm text-on-surface-variant">Choose images</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={handleImageChange} />
          </label>
        )}
        {images.length > 0 && (
          <div className="flex gap-3 mt-3">
            {images.map((img, i) => (
              <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border">
                <img src={URL.createObjectURL(img)} alt="" className="w-full h-full object-cover" />
                <button type="button" onClick={() => removeImage(i)} className="absolute top-0.5 right-0.5 bg-black/50 text-white rounded-full p-0.5">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3 pt-4">
        <button type="submit" className="btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Submitting...' : 'Submit Complaint'}
        </button>
      </div>
    </form>
  );
}

function ComplaintDetail({ complaint, onUpdate }: { complaint: Complaint; onUpdate: () => void }) {
  const [status, setStatus] = useState(complaint.status);
  const [comment, setComment] = useState('');
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'SUPER_ADMIN' || (['ADMIN', 'SECRETARY', 'JOINT_SECRETARY'] as string[]).includes(user?.role || '');
  const isStaff = user?.role === 'SERVICE_STAFF';
  const canUpdateStatus = isAdmin || isStaff;

  const statusMutation = useMutation({
    mutationFn: (data: any) => api.patch(`/complaints/${complaint.id}/status`, data),
    onSuccess: () => { toast.success('Status updated!'); onUpdate(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const commentMutation = useMutation({
    mutationFn: (content: string) => api.post(`/complaints/${complaint.id}/comments`, { content }),
    onSuccess: () => { toast.success('Comment added!'); setComment(''); queryClient.invalidateQueries({ queryKey: ['complaints'] }); },
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div><span className="text-on-surface-variant">Category:</span> <span className="font-medium">{complaint.category}</span></div>
        <div><span className="text-on-surface-variant">Priority:</span> <span className={cn('badge ml-2', getStatusColor(complaint.priority))}>{complaint.priority}</span></div>
        <div><span className="text-on-surface-variant">Created by:</span> <span className="font-medium">{complaint.createdBy?.name}</span></div>
        <div><span className="text-on-surface-variant">Date:</span> <span className="font-medium">{formatDate(complaint.createdAt)}</span></div>
      </div>

      <div className="p-3 bg-surface-container-low rounded-lg">
        <p className="text-sm text-on-surface-variant">{complaint.description}</p>
      </div>

      {/* Complaint Images */}
      {complaint.images && complaint.images.length > 0 && (
        <div>
          <h4 className="font-semibold text-on-surface mb-2 text-sm">Attachments</h4>
          <div className="flex gap-3 flex-wrap">
            {complaint.images.map((img, i) => {
              const src = img.startsWith('data:') ? img : `${getApiBaseUrl().replace('/api', '')}${img}`;
              return (
                <a key={i} href={src} target="_blank" rel="noopener noreferrer" className="block w-24 h-24 rounded-lg overflow-hidden border hover:shadow-md transition">
                  <img src={src} alt={`Attachment ${i + 1}`} className="w-full h-full object-cover" />
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* Update Status - Admin / Staff */}
      {canUpdateStatus && (
        <div className="flex items-center gap-3">
          <select className="select w-40" value={status} onChange={(e) => setStatus(e.target.value as any)}>
            <option value="OPEN">Open</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="RESOLVED">Resolved</option>
            <option value="CLOSED">Closed</option>
            <option value="REJECTED">Rejected</option>
          </select>
          <button
            className="btn-primary btn-sm"
            onClick={() => statusMutation.mutate({ status })}
            disabled={statusMutation.isPending}
          >
            Update Status
          </button>
        </div>
      )}

      {/* Comments */}
      <div className="border-t pt-4">
        <h4 className="font-semibold text-on-surface mb-3">Comments</h4>
        {complaint.comments?.map((c) => (
          <div key={c.id} className="mb-3 p-3 bg-surface-container-low rounded-lg">
            <div className="flex justify-between text-xs text-on-surface-variant mb-1">
              <span className="font-medium">{c.authorName}</span>
              <span>{formatDate(c.createdAt)}</span>
            </div>
            <p className="text-sm text-on-surface-variant">{c.content}</p>
          </div>
        ))}
        <div className="flex gap-2 mt-3">
          <input
            className="input flex-1"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a comment..."
          />
          <button
            className="btn-primary btn-sm"
            onClick={() => comment && commentMutation.mutate(comment)}
            disabled={commentMutation.isPending || !comment}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
