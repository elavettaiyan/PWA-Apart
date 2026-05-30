import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  Search,
  Download,
  ChevronRight,
  Phone,
  Mail,
} from 'lucide-react';
import api from '../../lib/api';
import { PageLoader } from '../../components/ui/Loader';

// ── Types ──────────────────────────────────────────────────────

type CrmSociety = {
  id: string;
  name: string;
  city: string;
  state: string;
  isActive: boolean;
  isPremium: boolean;
  premiumOverrideUntil: string | null;
  premiumOverrideActive: boolean;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  crmTags: string[];
  createdAt: string;
  trial: {
    isOnTrial: boolean;
    isExpired: boolean;
    daysRemaining: number;
  };
  primaryContact: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    role: string;
  } | null;
  latestSubscription: {
    id: string;
    status: string;
    lockedFlatCount: number;
    amountPaise: number;
    currentPeriodEnd: string | null;
  } | null;
};

// ── Sub-components ─────────────────────────────────────────────

function PremiumBadge({ society }: { society: CrmSociety }) {
  if (society.isPremium) {
    return (
      <span className="badge bg-violet-100 text-violet-700 font-semibold text-[11px]">
        Premium
      </span>
    );
  }
  if (society.premiumOverrideActive) {
    return (
      <span className="badge bg-indigo-100 text-indigo-700 font-semibold text-[11px]">
        Override
      </span>
    );
  }
  if (society.trial.isOnTrial) {
    return (
      <span className="badge bg-amber-100 text-amber-700 font-semibold text-[11px]">
        Trial · {society.trial.daysRemaining}d
      </span>
    );
  }
  return (
    <span className="badge bg-slate-100 text-slate-500 font-semibold text-[11px]">
      Free
    </span>
  );
}

// ── Main Page ──────────────────────────────────────────────────

export default function CrmSocietiesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [premiumFilter, setPremiumFilter] = useState<'all' | 'true' | 'false' | 'trial' | 'override'>('all');
  const [exportLoading, setExportLoading] = useState(false);

  const { data: societies = [], isLoading } = useQuery<CrmSociety[]>({
    queryKey: ['crm-societies'],
    queryFn: async () => (await api.get('/admin/crm/societies')).data,
  });

  const filtered = useMemo(() => {
    return societies.filter((s) => {
      if (search) {
        const q = search.toLowerCase();
        const match =
          s.name.toLowerCase().includes(q) ||
          s.city.toLowerCase().includes(q) ||
          s.state.toLowerCase().includes(q) ||
          (s.primaryContact?.name?.toLowerCase().includes(q) ?? false) ||
          (s.primaryContact?.email?.toLowerCase().includes(q) ?? false);
        if (!match) return false;
      }
      if (statusFilter === 'active' && !s.isActive) return false;
      if (statusFilter === 'inactive' && s.isActive) return false;
      if (premiumFilter === 'true' && !s.isPremium) return false;
      if (premiumFilter === 'false' && (s.isPremium || s.premiumOverrideActive)) return false;
      if (premiumFilter === 'trial' && !s.trial.isOnTrial) return false;
      if (premiumFilter === 'override' && !s.premiumOverrideActive) return false;
      return true;
    });
  }, [societies, search, statusFilter, premiumFilter]);

  async function handleExport() {
    setExportLoading(true);
    try {
      const response = await api.get('/admin/crm/export', { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([response.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `societies-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // silent — user can retry
    } finally {
      setExportLoading(false);
    }
  }

  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
            Platform Controls
          </p>
          <h1 className="page-title flex items-center gap-2">
            <Building2 className="w-6 h-6 text-violet-500" />
            CRM — Society Management
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {filtered.length} of {societies.length} societies
          </p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exportLoading}
          className="btn-outline flex items-center gap-2 text-sm self-start sm:self-auto"
        >
          <Download className="w-4 h-4" />
          {exportLoading ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl p-4 shadow-card flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name, city, admin…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-9 w-full"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="input w-full sm:w-40"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <select
          value={premiumFilter}
          onChange={(e) => setPremiumFilter(e.target.value as typeof premiumFilter)}
          className="input w-full sm:w-44"
        >
          <option value="all">All tiers</option>
          <option value="true">Premium</option>
          <option value="trial">On Trial</option>
          <option value="override">Override Active</option>
          <option value="false">Free</option>
        </select>
      </div>

      {/* Society Cards */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 shadow-card text-center">
          <Building2 className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-sm text-slate-400">No societies match your filters.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((society) => (
            <button
              key={society.id}
              type="button"
              onClick={() => navigate(`/crm/${society.id}`)}
              className="w-full bg-white rounded-2xl p-4 shadow-card hover:shadow-card-hover transition-shadow text-left"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {/* Top row: name + badges */}
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <p className="text-sm font-semibold text-on-surface truncate">{society.name}</p>
                    <span
                      className={`badge text-[10px] font-semibold ${
                        society.isActive
                          ? 'badge-success'
                          : 'bg-red-100 text-red-600'
                      }`}
                    >
                      {society.isActive ? 'Active' : 'Inactive'}
                    </span>
                    <PremiumBadge society={society} />
                    {society.crmTags.map((tag) => (
                      <span key={tag} className="badge bg-slate-100 text-slate-500 text-[10px]">
                        {tag}
                      </span>
                    ))}
                  </div>

                  {/* Location */}
                  <p className="text-xs text-slate-500 mb-2">
                    {society.city}, {society.state}
                  </p>

                  {/* Contact */}
                  {society.primaryContact ? (
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      <span className="font-medium text-on-surface">
                        {society.primaryContact.name}
                        <span className="text-slate-400 font-normal ml-1">
                          ({society.primaryContact.role.replace('_', ' ')})
                        </span>
                      </span>
                      <span className="flex items-center gap-1">
                        <Mail className="w-3 h-3" />
                        {society.primaryContact.email}
                      </span>
                      {society.primaryContact.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="w-3 h-3" />
                          {society.primaryContact.phone}
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 italic">No admin contact found</p>
                  )}
                </div>

                {/* Subscription / date info + chevron */}
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <ChevronRight className="w-4 h-4 text-slate-300" />
                  {society.latestSubscription && (
                    <span
                      className={`badge text-[10px] ${
                        society.latestSubscription.status === 'ACTIVE'
                          ? 'badge-success'
                          : society.latestSubscription.status === 'HALTED'
                            ? 'bg-red-100 text-red-600'
                            : 'badge-neutral'
                      }`}
                    >
                      {society.latestSubscription.status}
                    </span>
                  )}
                  <p className="text-[11px] text-slate-400">
                    {new Date(society.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
