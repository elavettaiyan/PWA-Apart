import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings, CreditCard, Eye, EyeOff, CheckCircle2, XCircle,
  Loader2, Zap, ToggleLeft, ToggleRight, ShieldCheck, Globe, Clock,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { PageLoader } from '../../components/ui/Loader';
import { cn } from '../../lib/utils';

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

    const payload: any = { ...form };
    // If editing and salt key not changed, send existing indicator
    if (data?.exists && !form.saltKey.trim()) {
      return toast.error('Please enter the Salt Key to save (we cannot show the current one for security)');
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
          <h1 className="page-title">Settings</h1>
          <p className="text-sm text-gray-500 mt-1">Configure payment gateway and application settings</p>
        </div>
      </div>

      {/* PhonePe Configuration Card */}
      <div className="card p-6 mb-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-purple-50 rounded-xl flex items-center justify-center">
              <CreditCard className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">PhonePe Payment Gateway</h2>
              <p className="text-xs text-gray-500">
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
                    <ToggleRight className="w-8 h-8 text-emerald-500" />
                    <span className="text-emerald-600">Active</span>
                  </>
                ) : (
                  <>
                    <ToggleLeft className="w-8 h-8 text-gray-400" />
                    <span className="text-gray-500">Disabled</span>
                  </>
                )}
              </button>
            )}
            {!isConfigured && (
              <span className="badge bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20">
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
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-red-50 text-red-700',
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
                        ? 'border-red-500 bg-red-50 text-red-700'
                        : 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300',
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
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>
                <strong>Production mode:</strong> Real money will be charged. Make sure your PhonePe merchant account is fully activated.
              </span>
            </div>
          )}

          {/* Merchant ID & Salt Key */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Merchant ID <span className="text-red-500">*</span></label>
              <input
                className="input"
                value={form.merchantId}
                onChange={(e) => handleChange('merchantId', e.target.value)}
                placeholder="e.g., MERCHANTUAT"
              />
              <p className="text-xs text-gray-400 mt-1">From your PhonePe merchant dashboard</p>
            </div>
            <div>
              <label className="label">Salt Key <span className="text-red-500">*</span></label>
              <div className="relative">
                <input
                  className="input pr-10"
                  type={showSaltKey ? 'text' : 'password'}
                  value={form.saltKey}
                  onChange={(e) => handleChange('saltKey', e.target.value)}
                  placeholder={isConfigured ? 'Enter new key to update' : 'Your PhonePe salt key'}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  onClick={() => setShowSaltKey(!showSaltKey)}
                >
                  {showSaltKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {isConfigured && cfg?.saltKeySet && (
                <p className="text-xs text-amber-600 mt-1">
                  Current key is set (masked). Enter a new value to update it.
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
            <p className="text-xs text-gray-400 mt-1">Usually 1 (check your PhonePe dashboard)</p>
          </div>

          {/* URLs (collapsible advanced) */}
          <details className="group">
            <summary className="cursor-pointer text-sm font-medium text-gray-600 hover:text-gray-900 flex items-center gap-1">
              <Settings className="w-4 h-4" />
              Advanced URL Settings
            </summary>
            <div className="mt-4 space-y-4 pl-5 border-l-2 border-gray-100">
              <div>
                <label className="label">Redirect URL</label>
                <input
                  className="input"
                  value={form.redirectUrl}
                  onChange={(e) => handleChange('redirectUrl', e.target.value)}
                  placeholder="Where users return after payment"
                />
                <p className="text-xs text-gray-400 mt-1">User gets redirected here after payment on PhonePe</p>
              </div>
              <div>
                <label className="label">Callback URL (Server-to-Server)</label>
                <input
                  className="input"
                  value={form.callbackUrl}
                  onChange={(e) => handleChange('callbackUrl', e.target.value)}
                  placeholder="Server callback endpoint"
                />
                <p className="text-xs text-gray-400 mt-1">PhonePe sends payment status to this URL (must be publicly accessible)</p>
              </div>
            </div>
          </details>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-100">
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
            <span className="text-xs text-amber-600 flex items-center gap-1">
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
            testResult.success ? 'ring-2 ring-emerald-200' : 'ring-2 ring-red-200',
          )}
        >
          <div className="flex items-start gap-3">
            {testResult.success ? (
              <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-6 h-6 text-red-500 shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <h3
                className={cn(
                  'font-semibold',
                  testResult.success ? 'text-emerald-700' : 'text-red-700',
                )}
              >
                {testResult.success ? 'Test Passed ✓' : 'Test Failed ✗'}
              </h3>
              <p className="text-sm text-gray-600 mt-1">{testResult.message}</p>

              {testResult.details && (
                <div className="mt-3 bg-gray-50 rounded-lg p-3">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {testResult.details.httpStatus && (
                      <div>
                        <span className="text-gray-500">HTTP Status:</span>{' '}
                        <span className="font-mono font-medium">{testResult.details.httpStatus}</span>
                      </div>
                    )}
                    {testResult.details.code && (
                      <div>
                        <span className="text-gray-500">Response Code:</span>{' '}
                        <span className="font-mono font-medium">{testResult.details.code}</span>
                      </div>
                    )}
                    {testResult.details.responseTime && (
                      <div>
                        <span className="text-gray-500">Response Time:</span>{' '}
                        <span className="font-mono font-medium">{testResult.details.responseTime}</span>
                      </div>
                    )}
                    {testResult.details.environment && (
                      <div>
                        <span className="text-gray-500">Environment:</span>{' '}
                        <span className="font-mono font-medium">{testResult.details.environment}</span>
                      </div>
                    )}
                    {testResult.details.phonePeMessage && (
                      <div className="col-span-2">
                        <span className="text-gray-500">PhonePe Message:</span>{' '}
                        <span className="font-mono text-xs">{testResult.details.phonePeMessage}</span>
                      </div>
                    )}
                    {testResult.details.error && (
                      <div className="col-span-2">
                        <span className="text-gray-500">Error:</span>{' '}
                        <span className="font-mono text-xs text-red-600">{testResult.details.error}</span>
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
          <p><strong>UAT Test Credentials (Sandbox):</strong></p>
          <p>Merchant ID: PGTESTPAYUAT86</p>
          <p>Salt Key: 96434309-7796-489d-8924-ab56988a6076</p>
          <p>Salt Index: 1</p>
        </div>
      </div>
    </div>
  );
}
