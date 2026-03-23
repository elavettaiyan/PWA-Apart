import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings, CreditCard, Eye, EyeOff, CheckCircle2, XCircle,
  Loader2, Zap, ToggleLeft, ToggleRight, ShieldCheck, Globe, Clock,
  Users, ChevronDown,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { PageLoader } from '../../components/ui/Loader';
import { cn } from '../../lib/utils';
import { useAuthStore } from '../../store/authStore';

interface PhonePeConfig {
  id?: string;
  gateway: string;
  merchantId: string;
  saltKey: string;
  saltKeySet?: boolean;
  saltIndex: number;
  environment: string;
  baseUrl: string;
  redirectUrl: string;
  callbackUrl: string;
  isActive: boolean;
  lastTestedAt?: string;
  lastTestOk?: boolean;
}

interface TestResult {
  success: boolean;
  message: string;
  details?: {
    code?: string;
    httpStatus?: number;
    responseTime?: string;
    environment?: string;
    baseUrl?: string;
    phonePeMessage?: string;
    error?: string;
  };
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [showSaltKey, setShowSaltKey] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [form, setForm] = useState({
    merchantId: '',
    saltKey: '',
    saltIndex: 1,
    environment: 'UAT',
    redirectUrl: '',
    callbackUrl: '',
  });
  const [hasChanges, setHasChanges] = useState(false);

  const { data, isLoading } = useQuery<{ exists: boolean; config: PhonePeConfig }>({
    queryKey: ['payment-gateway-config'],
    queryFn: async () => (await api.get('/settings/payment-gateway')).data,
  });

  // Populate form when data loads
  useEffect(() => {
    if (data?.config) {
      setForm({
        merchantId: data.config.merchantId || '',
        saltKey: data.exists ? '' : '', // Don't pre-fill masked key
        saltIndex: data.config.saltIndex || 1,
        environment: data.config.environment || 'UAT',
        redirectUrl: data.config.redirectUrl || '',
        callbackUrl: data.config.callbackUrl || '',
      });
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (payload: any) => api.post('/settings/payment-gateway', payload),
    onSuccess: (res) => {
      toast.success(res.data.message);
      queryClient.invalidateQueries({ queryKey: ['payment-gateway-config'] });
      setHasChanges(false);
      setTestResult(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save'),
  });

  const testMutation = useMutation({
    mutationFn: () => api.post('/settings/payment-gateway/test'),
    onSuccess: (res) => {
      setTestResult(res.data);
      queryClient.invalidateQueries({ queryKey: ['payment-gateway-config'] });
      if (res.data.success) {
        toast.success('Connection test passed!');
      } else {
        toast.error(res.data.message);
      }
    },
    onError: (e: any) => {
      setTestResult({ success: false, message: e.response?.data?.message || 'Test failed' });
      toast.error('Connection test failed');
    },
  });

  const toggleMutation = useMutation({
    mutationFn: () => api.patch('/settings/payment-gateway/toggle'),
    onSuccess: (res) => {
      toast.success(res.data.message);
      queryClient.invalidateQueries({ queryKey: ['payment-gateway-config'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const handleChange = (field: string, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setHasChanges(true);
    setTestResult(null);
  };

  const handleSave = () => {
    if (!form.merchantId.trim()) return toast.error('Merchant ID is required');
    if (!form.saltKey.trim() && !data?.exists) return toast.error('Salt Key is required');

    const payload: any = {
      merchantId: form.merchantId,
      saltIndex: form.saltIndex,
      environment: form.environment,
      redirectUrl: form.redirectUrl,
      callbackUrl: form.callbackUrl,
    };

    // Keep existing stored salt key when editing and input is left blank.
    if (form.saltKey.trim()) {
      payload.saltKey = form.saltKey.trim();
    }

    saveMutation.mutate(payload);
  };

  if (isLoading) return <PageLoader />;

  const cfg = data?.config;
  const isConfigured = data?.exists;

  return (
    <div>
      <div className="page-header">
        <div>
          <p className="section-label mb-2">Configuration</p>
          <h1 className="page-title">Settings</h1>
          <p className="text-sm text-on-surface-variant mt-1">Configure payment gateway and application settings</p>
        </div>
      </div>

      {/* Members & Roles */}
      <MembersRoles />

      {/* PhonePe Configuration Card */}
      <div className="card p-6 mb-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-purple-50 rounded-xl flex items-center justify-center">
              <CreditCard className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-on-surface">PhonePe Payment Gateway</h2>
              <p className="text-xs text-on-surface-variant">
                Configure your PhonePe merchant credentials to enable online payments
              </p>
            </div>
          </div>

          {/* Status Badge */}
          <div className="flex items-center gap-3">
            {isConfigured && (
              <button
                onClick={() => toggleMutation.mutate()}
                disabled={toggleMutation.isPending}
                className="flex items-center gap-2 text-sm font-medium"
              >
                {cfg?.isActive ? (
                  <>
                    <ToggleRight className="w-8 h-8 text-tertiary" />
                    <span className="text-tertiary">Active</span>
                  </>
                ) : (
                  <>
                    <ToggleLeft className="w-8 h-8 text-outline" />
                    <span className="text-on-surface-variant">Disabled</span>
                  </>
                )}
              </button>
            )}
            {!isConfigured && (
              <span className="badge bg-warning-container text-warning ring-1 ring-inset ring-warning/20">
                Not Configured
              </span>
            )}
          </div>
        </div>

        {/* Last Test Status */}
        {isConfigured && cfg?.lastTestedAt && (
          <div
            className={cn(
              'flex items-center gap-2 p-3 rounded-lg mb-6 text-sm',
              cfg.lastTestOk
                ? 'bg-tertiary-container text-tertiary'
                : 'bg-error-container text-error',
            )}
          >
            {cfg.lastTestOk ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 shrink-0" />
            )}
            <span>
              Last test: {cfg.lastTestOk ? 'Passed' : 'Failed'} —{' '}
              {new Date(cfg.lastTestedAt).toLocaleString()}
            </span>
          </div>
        )}

        {/* Form */}
        <div className="space-y-5">
          {/* Environment Selector */}
          <div>
            <label className="label">Environment</label>
            <div className="flex gap-3">
              {['UAT', 'PRODUCTION'].map((env) => (
                <button
                  key={env}
                  type="button"
                  onClick={() => handleChange('environment', env)}
                  className={cn(
                    'flex-1 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all',
                    form.environment === env
                      ? env === 'PRODUCTION'
                        ? 'border-error bg-error-container text-error'
                        : 'border-primary-500 bg-primary-container text-primary'
                      : 'border-outline-variant/15 bg-white text-on-surface-variant hover:border-outline-variant',
                  )}
                >
                  <div className="flex items-center justify-center gap-2">
                    {env === 'UAT' ? <Zap className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
                    {env === 'UAT' ? 'Sandbox (UAT)' : 'Production (Live)'}
                  </div>
                  <p className="text-xs mt-1 font-normal opacity-70">
                    {env === 'UAT' ? 'For testing with test credentials' : 'Real payments — use with caution'}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {form.environment === 'PRODUCTION' && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-error-container text-error text-sm">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>
                <strong>Production mode:</strong> Real money will be charged. Make sure your PhonePe merchant account is fully activated.
              </span>
            </div>
          )}

          {/* Merchant ID & Salt Key */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Merchant ID <span className="text-error">*</span></label>
              <input
                className="input"
                value={form.merchantId}
                onChange={(e) => handleChange('merchantId', e.target.value)}
                placeholder="e.g., MERCHANTUAT"
              />
              <p className="text-xs text-outline mt-1">From your PhonePe merchant dashboard</p>
            </div>
            <div>
              <label className="label">Salt Key <span className="text-error">*</span></label>
              <div className="relative">
                <input
                  className="input pr-10"
                  type={showSaltKey ? 'text' : 'password'}
                  value={form.saltKey}
                  onChange={(e) => handleChange('saltKey', e.target.value)}
                  placeholder={isConfigured ? 'Leave blank to keep existing key' : 'Your PhonePe salt key'}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface-variant"
                  onClick={() => setShowSaltKey(!showSaltKey)}
                >
                  {showSaltKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {isConfigured && cfg?.saltKeySet && (
                <p className="text-xs text-warning mt-1">
                  Current key is already saved. Leave this blank to keep it, or enter a new value to rotate it.
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="label">Salt Index</label>
            <input
              className="input w-32"
              type="number"
              value={form.saltIndex}
              onChange={(e) => handleChange('saltIndex', parseInt(e.target.value) || 1)}
              min={1}
            />
            <p className="text-xs text-outline mt-1">Usually 1 (check your PhonePe dashboard)</p>
          </div>

          {/* URLs (collapsible advanced) */}
          <details className="group">
            <summary className="cursor-pointer text-sm font-medium text-on-surface-variant hover:text-on-surface flex items-center gap-1">
              <Settings className="w-4 h-4" />
              Advanced URL Settings
            </summary>
            <div className="mt-4 space-y-4 pl-5 border-l-2 border-outline-variant/10">
              <div>
                <label className="label">Redirect URL</label>
                <input
                  className="input"
                  value={form.redirectUrl}
                  onChange={(e) => handleChange('redirectUrl', e.target.value)}
                  placeholder="Where users return after payment"
                />
                <p className="text-xs text-outline mt-1">User gets redirected here after payment on PhonePe</p>
              </div>
              <div>
                <label className="label">Callback URL (Server-to-Server)</label>
                <input
                  className="input"
                  value={form.callbackUrl}
                  onChange={(e) => handleChange('callbackUrl', e.target.value)}
                  placeholder="Server callback endpoint"
                />
                <p className="text-xs text-outline mt-1">PhonePe sends payment status to this URL (must be publicly accessible). Recommended path: /api/payments/phonepe/callback</p>
              </div>
            </div>
          </details>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between mt-8 pt-6 border-t border-outline-variant/10">
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className="btn-primary"
            >
              {saveMutation.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
              ) : (
                'Save Configuration'
              )}
            </button>

            {isConfigured && (
              <button
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending}
                className="btn-secondary"
              >
                {testMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Testing...</>
                ) : (
                  <><Zap className="w-4 h-4" /> Test Connection</>
                )}
              </button>
            )}
          </div>

          {hasChanges && (
            <span className="text-xs text-warning flex items-center gap-1">
              <Clock className="w-3 h-3" /> Unsaved changes
            </span>
          )}
        </div>
      </div>

      {/* Test Result Card */}
      {testResult && (
        <div
          className={cn(
            'card p-5',
            testResult.success ? 'ring-2 ring-tertiary/20' : 'ring-2 ring-error/20',
          )}
        >
          <div className="flex items-start gap-3">
            {testResult.success ? (
              <CheckCircle2 className="w-6 h-6 text-tertiary shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-6 h-6 text-error shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <h3
                className={cn(
                  'font-semibold',
                  testResult.success ? 'text-tertiary' : 'text-error',
                )}
              >
                {testResult.success ? 'Test Passed ✓' : 'Test Failed ✗'}
              </h3>
              <p className="text-sm text-on-surface-variant mt-1">{testResult.message}</p>

              {testResult.details && (
                <div className="mt-3 bg-surface-container-low rounded-lg p-3">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {testResult.details.httpStatus && (
                      <div>
                        <span className="text-on-surface-variant">HTTP Status:</span>{' '}
                        <span className="font-mono font-medium">{testResult.details.httpStatus}</span>
                      </div>
                    )}
                    {testResult.details.code && (
                      <div>
                        <span className="text-on-surface-variant">Response Code:</span>{' '}
                        <span className="font-mono font-medium">{testResult.details.code}</span>
                      </div>
                    )}
                    {testResult.details.responseTime && (
                      <div>
                        <span className="text-on-surface-variant">Response Time:</span>{' '}
                        <span className="font-mono font-medium">{testResult.details.responseTime}</span>
                      </div>
                    )}
                    {testResult.details.environment && (
                      <div>
                        <span className="text-on-surface-variant">Environment:</span>{' '}
                        <span className="font-mono font-medium">{testResult.details.environment}</span>
                      </div>
                    )}
                    {testResult.details.phonePeMessage && (
                      <div className="col-span-2">
                        <span className="text-on-surface-variant">PhonePe Message:</span>{' '}
                        <span className="font-mono text-xs">{testResult.details.phonePeMessage}</span>
                      </div>
                    )}
                    {testResult.details.error && (
                      <div className="col-span-2">
                        <span className="text-on-surface-variant">Error:</span>{' '}
                        <span className="font-mono text-xs text-error">{testResult.details.error}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Info Card */}
      <div className="card p-5 mt-6 bg-blue-50/50 border-blue-100">
        <h3 className="text-sm font-semibold text-blue-900 mb-2">📘 How to get PhonePe credentials</h3>
        <ol className="text-sm text-blue-800 space-y-1.5 list-decimal list-inside">
          <li>Sign up on <a href="https://www.phonepe.com/business" target="_blank" rel="noopener noreferrer" className="underline font-medium">PhonePe Business</a></li>
          <li>Complete KYC and business verification</li>
          <li>Navigate to <strong>Developer Settings → API Keys</strong></li>
          <li>Copy your <strong>Merchant ID</strong> and <strong>Salt Key</strong></li>
          <li>For testing, use the UAT sandbox credentials provided by PhonePe</li>
        </ol>
        <div className="mt-3 p-3 bg-white/60 rounded-lg text-xs font-mono text-blue-700">
            <p><strong>Sandbox note:</strong></p>
            <p>Use the UAT Merchant ID, Salt Key, and Salt Index issued to your own PhonePe merchant account.</p>
            <p>Do not rely on shared sample credentials because they may be expired, disabled, or rate-limited.</p>
        </div>
      </div>
    </div>
  );
}

// ── MEMBERS & ROLES ─────────────────────────────────────

type Member = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  isActive: boolean;
};

const ROLE_OPTIONS = [
  { value: 'ADMIN', label: 'Admin (President)' },
  { value: 'SECRETARY', label: 'Secretary' },
  { value: 'JOINT_SECRETARY', label: 'Joint Secretary' },
  { value: 'TREASURER', label: 'Treasurer' },
  { value: 'OWNER', label: 'Owner' },
  { value: 'SERVICE_STAFF', label: 'Service Staff' },
];

const ROLE_BADGE: Record<string, string> = {
  ADMIN: 'bg-purple-50 text-purple-700',
  SECRETARY: 'bg-blue-50 text-blue-700',
  JOINT_SECRETARY: 'bg-cyan-50 text-cyan-700',
  TREASURER: 'bg-warning-container text-warning',
  OWNER: 'bg-green-50 text-green-700',
  TENANT: 'bg-surface-container text-on-surface-variant',
  SERVICE_STAFF: 'bg-orange-50 text-orange-700',
};

function MembersRoles() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState('');

  const { data: members = [], isLoading } = useQuery<Member[]>({
    queryKey: ['settings-members'],
    queryFn: async () => (await api.get('/settings/members')).data,
  });

  const changeMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.patch(`/settings/members/${userId}/role`, { role }),
    onSuccess: () => {
      toast.success('Role updated');
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ['settings-members'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to update role'),
  });

  const formatRole = (role: string) =>
    ROLE_OPTIONS.find((r) => r.value === role)?.label || role.replace(/_/g, ' ');

  return (
    <div className="card p-6 mb-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 bg-blue-50 rounded-xl flex items-center justify-center">
          <Users className="w-6 h-6 text-blue-600" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-on-surface">Members & Roles</h2>
          <p className="text-xs text-on-surface-variant">Assign committee roles — President, Secretary, Treasurer, etc.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-outline" /></div>
      ) : members.length === 0 ? (
        <p className="text-sm text-outline text-center py-6">No members found</p>
      ) : (
        <div className="overflow-x-auto -mx-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-on-surface-variant uppercase tracking-wider">
                <th className="px-6 py-2.5">Name</th>
                <th className="px-6 py-2.5">Email</th>
                <th className="px-6 py-2.5">Current Role</th>
                <th className="px-6 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b last:border-0 hover:bg-surface-container-low/50">
                  <td className="px-6 py-3 font-medium text-on-surface">{m.name}</td>
                  <td className="px-6 py-3 text-on-surface-variant">{m.email}</td>
                  <td className="px-6 py-3">
                    {editingId === m.id ? (
                      <div className="flex items-center gap-2">
                        <select
                          className="select text-sm py-1"
                          value={selectedRole}
                          onChange={(e) => setSelectedRole(e.target.value)}
                        >
                          {ROLE_OPTIONS.map((r) => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                        <button
                          className="btn-primary btn-sm text-xs"
                          onClick={() => changeMutation.mutate({ userId: m.id, role: selectedRole })}
                          disabled={changeMutation.isPending || selectedRole === m.role}
                        >
                          Save
                        </button>
                        <button className="btn-secondary btn-sm text-xs" onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <span className={cn('inline-block px-2.5 py-0.5 rounded-full text-xs font-medium', ROLE_BADGE[m.role] || 'bg-surface-container text-on-surface-variant')}>
                        {formatRole(m.role)}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-right">
                    {editingId !== m.id && m.id !== user?.id && (
                      <button
                        className="text-xs text-primary hover:text-primary font-medium"
                        onClick={() => { setEditingId(m.id); setSelectedRole(m.role); }}
                      >
                        Change Role
                      </button>
                    )}
                    {m.id === user?.id && (
                      <span className="text-xs text-outline">You</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
