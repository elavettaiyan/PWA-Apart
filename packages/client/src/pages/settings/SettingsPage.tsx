import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings, CreditCard, Eye, EyeOff, CheckCircle2, XCircle,
  Loader2, Zap, ToggleLeft, ToggleRight, ShieldCheck, Globe, Clock,
  Users, ChevronDown, Building2, AlertTriangle, Mail, Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { PageLoader } from '../../components/ui/Loader';
import Modal from '../../components/ui/Modal';
import { isSectionRestricted } from '../../lib/appRestrictions';
import { cn } from '../../lib/utils';
import { getFallbackMenuVisibility } from '../../lib/menuConfig';
import {
  GATE_REGIONAL_LANGUAGE_KEY,
  MAX_GATE_REGIONAL_LANGUAGES,
  REGIONAL_DICTATION_LANGUAGES,
  parseGateRegionalLanguages,
  type DictationLang,
} from '../../lib/useDictation';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import type { ConfigurableMenuRole, FlatType, MenuVisibilityResponse, NavigationMenuId, PremiumStatusResponse } from '../../types';
import { SOCIETY_ADMINS } from '../../types';
import ManageStaffPanel from '../../components/settings/ManageStaffPanel';


interface PhonePeConfig {
  id?: string;
  gateway: string;
  merchantId: string;
  clientId?: string;
  clientSecret?: string;
  clientSecretSet?: boolean;
  clientVersion?: number;
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

const FLAT_TYPE_OPTIONS: Array<{ value: FlatType; label: string }> = [
  { value: 'ONE_BHK', label: '1 BHK' },
  { value: 'TWO_BHK', label: '2 BHK' },
  { value: 'THREE_BHK', label: '3 BHK' },
  { value: 'FOUR_BHK', label: '4 BHK' },
  { value: 'STUDIO', label: 'Studio' },
  { value: 'PENTHOUSE', label: 'Penthouse' },
  { value: 'SHOP', label: 'Shop' },
  { value: 'OTHER', label: 'Other' },
];

export default function SettingsPage() {
  const legalBaseUrl = 'https://dwellhub.in';
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const activeSocietyId = user?.activeSocietyId || user?.societyId || '';
  const [showSaltKey, setShowSaltKey] = useState(false);
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [form, setForm] = useState({
    merchantId: '',
    clientId: '',
    clientSecret: '',
    clientVersion: '1',
    saltKey: '',
    saltIndex: '1',
    environment: 'UAT',
    redirectUrl: '',
    callbackUrl: '',
  });
  const [hasChanges, setHasChanges] = useState(false);

  const [deleteOtp, setDeleteOtp] = useState(['', '', '', '', '', '']);
  const [deleteAccountStep, setDeleteAccountStep] = useState<'idle' | 'otp'>('idle');
  const [deleteAccountResendCooldown, setDeleteAccountResendCooldown] = useState(0);
  const deleteOtpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [preferredGateLanguages, setPreferredGateLanguages] = useState<DictationLang[]>([]);
  const [gateLanguageDirty, setGateLanguageDirty] = useState(false);

  const isAdmin = user?.role === 'SUPER_ADMIN' || SOCIETY_ADMINS.includes(user?.role as any);

  useEffect(() => {
    if (deleteAccountResendCooldown <= 0) return;
    const timer = setTimeout(() => setDeleteAccountResendCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [deleteAccountResendCooldown]);

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    const stored = localStorage.getItem(GATE_REGIONAL_LANGUAGE_KEY);
    setPreferredGateLanguages(parseGateRegionalLanguages(stored));
  }, []);

  const { data, isLoading } = useQuery<{ exists: boolean; config: PhonePeConfig }>({
    queryKey: ['payment-gateway-config'],
    queryFn: async () => (await api.get('/settings/payment-gateway')).data,
    enabled: isAdmin,
  });

  const { data: premiumStatus } = useQuery<PremiumStatusResponse>({
    queryKey: ['premium-status'],
    queryFn: async () => (await api.get('/premium/status')).data,
    enabled: isAdmin,
  });

  const { data: menuVisibility } = useQuery<MenuVisibilityResponse>({
    queryKey: ['menu-visibility', activeSocietyId],
    queryFn: async () => (await api.get('/settings/menu-visibility')).data,
    enabled: isAdmin,
    placeholderData: () => getFallbackMenuVisibility(activeSocietyId),
    retry: false,
  });

  // Society settings for billing/collections
  const { data: societySettings, isLoading: settingsLoading } = useQuery<any>({
    queryKey: ['society-settings', activeSocietyId],
    queryFn: async () => (await api.get('/settings/society-settings')).data,
    enabled: isAdmin,
    retry: false,
  });

  const [billingSettings, setBillingSettings] = useState<any | null>(null);

  useEffect(() => {
    if (societySettings) setBillingSettings(societySettings);
  }, [societySettings]);

  const settingsMutation = useMutation({
    mutationFn: (payload: any) => api.put('/settings/society-settings', payload),
    onSuccess: (res: any) => {
      toast.success(res.data?.message || 'Settings saved');
      queryClient.invalidateQueries({ queryKey: ['society-settings', activeSocietyId] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save settings'),
  });

  // Populate form when data loads
  useEffect(() => {
    if (data?.config) {
      setForm({
        merchantId: data.config.merchantId || '',
        clientId: data.config.clientId || '',
        clientSecret: '',
        clientVersion: String(data.config.clientVersion || 1),
        saltKey: data.exists ? '' : '', // Don't pre-fill masked key
        saltIndex: String(data.config.saltIndex || 1),
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

  const menuVisibilityMutation = useMutation({
    mutationFn: async ({ role, visibleMenuIds }: { role: ConfigurableMenuRole; visibleMenuIds: NavigationMenuId[] }) => (
      await api.put(`/settings/menu-visibility/${role}`, { visibleMenuIds })
    ).data as MenuVisibilityResponse & { message?: string },
    onSuccess: (response) => {
      queryClient.setQueryData(['menu-visibility', activeSocietyId], {
        societyId: response.societyId,
        configurableRoles: response.configurableRoles,
      });
      toast.success(response.message || 'Menu visibility updated');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to update menu visibility'),
  });

  // ─── Community Profile ───────────────────────────────────
  interface CommunityProfile { name: string; communityType: string; address: string; city: string; state: string; pincode: string; totalUnits: number | null; }

  const { data: communityProfile } = useQuery<CommunityProfile>({
    queryKey: ['community-profile'],
    queryFn: async () => (await api.get('/settings/community-profile')).data,
    enabled: isAdmin,
  });

  const [cpForm, setCpForm] = useState({
    name: '', communityType: 'APARTMENT', address: '', city: '', state: '', pincode: '', totalUnits: '',
  });
  const [cpDirty, setCpDirty] = useState(false);
  const [configuredFlatTypes, setConfiguredFlatTypes] = useState<FlatType[]>([]);
  const [flatTypesDirty, setFlatTypesDirty] = useState(false);

  useEffect(() => {
    if (communityProfile) {
      setCpForm({
        name: communityProfile.name || '',
        communityType: communityProfile.communityType || 'APARTMENT',
        address: communityProfile.address || '',
        city: communityProfile.city || '',
        state: communityProfile.state || '',
        pincode: communityProfile.pincode || '',
        totalUnits: communityProfile.totalUnits != null ? String(communityProfile.totalUnits) : '',
      });
    }
  }, [communityProfile]);

  useEffect(() => {
    if (societySettings) {
      setConfiguredFlatTypes(Array.isArray(societySettings.configuredFlatTypes) ? societySettings.configuredFlatTypes : []);
      setFlatTypesDirty(false);
    }
  }, [societySettings]);

  const cpMutation = useMutation({
    mutationFn: (payload: any) => api.put('/settings/community-profile', payload),
    onSuccess: (res) => {
      toast.success('Community profile updated');
      queryClient.invalidateQueries({ queryKey: ['community-profile'] });
      setCpDirty(false);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to update'),
  });

  const handleCpChange = (field: string, value: string) => {
    setCpForm((prev) => ({ ...prev, [field]: value }));
    setCpDirty(true);
  };

  const handleCpSave = () => {
    if (!cpForm.name.trim()) return toast.error('Community name is required');
    if (!cpForm.address.trim()) return toast.error('Address is required');
    if (!cpForm.city.trim()) return toast.error('City is required');
    if (!cpForm.state.trim()) return toast.error('State is required');
    if (cpForm.pincode && !/^\d{6}$/.test(cpForm.pincode)) return toast.error('Pincode must be 6 digits');

    const payload: any = {
      name: cpForm.name.trim(),
      communityType: cpForm.communityType,
      address: cpForm.address.trim(),
      city: cpForm.city.trim(),
      state: cpForm.state.trim(),
      pincode: cpForm.pincode.trim(),
    };
    if (cpForm.totalUnits.trim()) payload.totalUnits = parseInt(cpForm.totalUnits, 10);
    else payload.totalUnits = null;

    cpMutation.mutate(payload);
  };

  const toggleConfiguredFlatType = (flatType: FlatType) => {
    setConfiguredFlatTypes((current) => (
      current.includes(flatType)
        ? current.filter((value) => value !== flatType)
        : [...current, flatType]
    ));
    setFlatTypesDirty(true);
  };

  const handleFlatTypesSave = () => {
    settingsMutation.mutate({ configuredFlatTypes });
  };

  const handleChange = (field: string, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setHasChanges(true);
    setTestResult(null);
  };

  const sendDeleteAccountOtpMutation = useMutation({
    mutationFn: async () => (await api.post('/auth/delete-account/send-otp')).data,
    onSuccess: (response) => {
      toast.success(response.message || 'Verification code sent to your email');
      setDeleteAccountStep('otp');
      setDeleteAccountResendCooldown(60);
      setDeleteOtp(['', '', '', '', '', '']);
      setTimeout(() => deleteOtpRefs.current[0]?.focus(), 100);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to send deletion verification code');
    },
  });

  const verifyDeleteAccountMutation = useMutation({
    mutationFn: async (otp: string) => (await api.post('/auth/delete-account/verify-otp', { otp })).data,
    onSuccess: (response) => {
      toast.success(response.message || 'Account deleted successfully');
      queryClient.clear();
      logout();
      navigate('/login', { replace: true });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to delete account');
    },
  });

  const handleDeleteOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...deleteOtp];
    next[index] = value.slice(-1);
    setDeleteOtp(next);
    if (value && index < 5) {
      deleteOtpRefs.current[index + 1]?.focus();
    }
  };

  const handleDeleteOtpKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !deleteOtp[index] && index > 0) {
      deleteOtpRefs.current[index - 1]?.focus();
    }
  };

  const handleDeleteOtpPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      setDeleteOtp(pasted.split(''));
      deleteOtpRefs.current[5]?.focus();
    }
  };

  const handleVerifyDeleteAccount = () => {
    const otp = deleteOtp.join('');
    if (otp.length !== 6) {
      toast.error('Enter the 6-digit verification code');
      return;
    }

    verifyDeleteAccountMutation.mutate(otp);
  };

  const handleSave = () => {
    if (!form.merchantId.trim()) return toast.error('Merchant ID is required');
    if ((form.clientId.trim() && !form.clientSecret.trim() && !cfg?.clientSecretSet) || (!form.clientId.trim() && form.clientSecret.trim())) {
      return toast.error('Client ID and Client Secret must be provided together');
    }
    const parsedSaltIndex = parseInt(form.saltIndex, 10);
    if (!Number.isFinite(parsedSaltIndex) || parsedSaltIndex < 1) return toast.error('Salt Index must be 1 or greater');
    const parsedClientVersion = parseInt(form.clientVersion, 10);
    if (!Number.isFinite(parsedClientVersion) || parsedClientVersion < 1) return toast.error('Client Version must be 1 or greater');

    const payload: any = {
      merchantId: form.merchantId,
      clientId: form.clientId.trim(),
      clientVersion: parsedClientVersion,
      saltIndex: parsedSaltIndex,
      environment: form.environment,
      redirectUrl: form.redirectUrl,
      callbackUrl: form.callbackUrl,
    };

    // Keep existing stored salt key when editing and input is left blank.
    if (form.saltKey.trim()) {
      payload.saltKey = form.saltKey.trim();
    }
    if (form.clientSecret.trim()) {
      payload.clientSecret = form.clientSecret.trim();
    }

    saveMutation.mutate(payload);
  };

  const handleSaveGateLanguage = () => {
    if (typeof localStorage === 'undefined') return;

    if (preferredGateLanguages.length > 0) {
      localStorage.setItem(GATE_REGIONAL_LANGUAGE_KEY, JSON.stringify(preferredGateLanguages));
      toast.success('Gate language preference saved');
    } else {
      localStorage.removeItem(GATE_REGIONAL_LANGUAGE_KEY);
      toast.success('Gate Management will use English only');
    }

    setGateLanguageDirty(false);
  };

  const toggleGateLanguage = (language: DictationLang) => {
    setPreferredGateLanguages((current) => {
      const exists = current.includes(language);
      if (exists) {
        return current.filter((entry) => entry !== language);
      }
      if (current.length >= MAX_GATE_REGIONAL_LANGUAGES) {
        toast.error(`Select up to ${MAX_GATE_REGIONAL_LANGUAGES} regional languages`);
        return current;
      }
      return [...current, language];
    });
    setGateLanguageDirty(true);
  };

  if (isAdmin && isLoading) return <PageLoader />;

  const cfg = data?.config;
  const isConfigured = data?.exists;

  return (
    <div>
      <div className="page-header">
        <div>
          <p className="section-label mb-1">Configuration</p>
          <h1 className="page-title">Settings</h1>
        </div>
      </div>

      {isAdmin && (
      <>
      <SettingsAccordion
        title="Community Profile"
        description="Community name, type, address, and unit details"
        icon={Building2}
        iconWrapperClassName="group-open:bg-blue-100"
        iconClassName="group-open:text-blue-800"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Community Name</label>
              <input
                className="input"
                value={cpForm.name}
                onChange={(e) => handleCpChange('name', e.target.value)}
                placeholder="e.g., Green Valley Residences"
              />
            </div>
            <div>
              <label className="label">Community Type</label>
              <select
                className="input"
                value={cpForm.communityType}
                onChange={(e) => handleCpChange('communityType', e.target.value)}
              >
                <option value="APARTMENT">Apartment / Society</option>
                <option value="VILLA">Villa Community</option>
                <option value="GATED_COMMUNITY">Gated Community</option>
                <option value="TOWNSHIP">Township</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Address</label>
            <input
              className="input"
              value={cpForm.address}
              onChange={(e) => handleCpChange('address', e.target.value)}
              placeholder="Full street address"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">City</label>
              <input
                className="input"
                value={cpForm.city}
                onChange={(e) => handleCpChange('city', e.target.value)}
              />
            </div>
            <div>
              <label className="label">State</label>
              <input
                className="input"
                value={cpForm.state}
                onChange={(e) => handleCpChange('state', e.target.value)}
              />
            </div>
            <div>
              <label className="label">Pincode</label>
              <input
                className="input"
                value={cpForm.pincode}
                onChange={(e) => handleCpChange('pincode', e.target.value)}
                maxLength={6}
              />
            </div>
          </div>
          <div className="md:w-1/3">
            <label className="label">Total Units</label>
            <input
              className="input"
              type="number"
              min={0}
              value={cpForm.totalUnits}
              onChange={(e) => handleCpChange('totalUnits', e.target.value)}
              placeholder="e.g., 120"
            />
            <p className="text-xs text-on-surface-variant mt-1">Total flats, villas, or units in this community</p>
          </div>
          <div className="rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <label className="label">Available Flat Types</label>
                <p className="text-xs text-on-surface-variant">Choose which flat types can be used in Flats & Residents when adding or editing units.</p>
              </div>
              {flatTypesDirty ? (
                <span className="text-xs text-warning flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Unsaved flat type changes
                </span>
              ) : null}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {FLAT_TYPE_OPTIONS.map((option) => {
                const active = configuredFlatTypes.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => toggleConfiguredFlatType(option.value)}
                    className={cn(
                      'rounded-xl border px-4 py-3 text-sm font-semibold transition-colors',
                      active
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={handleFlatTypesSave}
                disabled={settingsMutation.isPending || !flatTypesDirty}
                className="btn-secondary"
              >
                {settingsMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
                ) : (
                  'Save Flat Types'
                )}
              </button>
              <span className="text-xs text-on-surface-variant">Leave all unchecked to allow every flat type.</span>
            </div>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleCpSave}
              disabled={cpMutation.isPending || !cpDirty}
              className="btn-primary"
            >
              {cpMutation.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
              ) : (
                'Save Profile'
              )}
            </button>
            {cpDirty && (
              <span className="text-xs text-warning flex items-center gap-1">
                <Clock className="w-3 h-3" /> Unsaved changes
              </span>
            )}
          </div>
        </div>
      </SettingsAccordion>

      <SettingsAccordion
        title="Society Administration"
        description="Manage staff accounts and administration access"
        icon={ShieldCheck}
        iconWrapperClassName="group-open:bg-emerald-100"
        iconClassName="group-open:text-emerald-800"
      >
        <div className="space-y-5">
          <ManageStaffPanel embedded />
        </div>
      </SettingsAccordion>

      <SettingsAccordion
        title="Members & Roles"
        description="Expand to assign committee roles and manage member access"
        icon={Users}
        iconWrapperClassName="group-open:bg-amber-100"
        iconClassName="group-open:text-amber-800"
      >
        <MembersRoles />
      </SettingsAccordion>

      <SettingsAccordion
        title="Menu Management"
        description="Choose which extra navigation menus each role can see"
        icon={Settings}
        iconWrapperClassName="group-open:bg-fuchsia-100"
        iconClassName="group-open:text-fuchsia-800"
      >
        <MenuManagementPanel
          menuVisibility={menuVisibility || getFallbackMenuVisibility(activeSocietyId)}
          savingRole={menuVisibilityMutation.isPending ? menuVisibilityMutation.variables?.role : null}
          onToggleMenu={(role, visibleMenuIds) => menuVisibilityMutation.mutate({ role, visibleMenuIds })}
        />
      </SettingsAccordion>

      {!isSectionRestricted('settings-premium-plan') && (
      <SettingsAccordion
        title="Premium Plan"
        description="Review subscription status, limits, and billing impact"
        icon={ShieldCheck}
        iconWrapperClassName="group-open:bg-violet-100"
        iconClassName="group-open:text-violet-800"
      >
      <div className="space-y-4">
        <div className="flex items-center justify-end gap-4 mb-6">
          <span className={cn(
            'badge',
            premiumStatus?.isPremium ? 'badge-success' : premiumStatus?.trial?.isOnTrial ? 'badge-warning' : 'badge-neutral'
          )}>
            {premiumStatus?.isPremium ? 'Premium Active' : premiumStatus?.trial?.isOnTrial ? `Free Trial · ${premiumStatus.trial.daysRemaining}d left` : 'Free Tier'}
          </span>
        </div>

        {premiumStatus ? (
          <div className="space-y-4">
            {premiumStatus.overdue?.isOverdue && premiumStatus.overdue.message && (
              <div className={cn(
                'rounded-xl px-4 py-3 text-sm',
                premiumStatus.overdue.stage === 'ROLE_LOGIN_BLOCKED' || premiumStatus.overdue.stage === 'ARCHIVED'
                  ? 'bg-error-container/20 text-error'
                  : 'bg-warning-container text-on-warning-container',
              )}>
                <p className="font-semibold">
                  {premiumStatus.overdue.stage === 'ROLE_LOGIN_BLOCKED'
                    ? 'Premium overdue access restrictions are active'
                    : premiumStatus.overdue.stage === 'ARCHIVED'
                      ? 'Society access archived'
                      : 'Premium renewal payment overdue'}
                </p>
                <p className="mt-1">{premiumStatus.overdue.message}</p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-xl bg-surface-container-low p-4">
                <p className="text-xs uppercase tracking-widest font-bold text-on-surface-variant">Current flats</p>
                <p className="mt-1 text-lg font-semibold text-on-surface">{premiumStatus.currentFlatCount}</p>
              </div>
              {premiumStatus.isPremium && (
                <>
                  <div className="rounded-xl bg-surface-container-low p-4">
                    <p className="text-xs uppercase tracking-widest font-bold text-on-surface-variant">Locked billing count</p>
                    <p className="mt-1 text-lg font-semibold text-on-surface">{premiumStatus.preview.lockedFlatCount}</p>
                  </div>
                  <div className="rounded-xl bg-surface-container-low p-4">
                    <p className="text-xs uppercase tracking-widest font-bold text-on-surface-variant">Monthly amount</p>
                    <p className="mt-1 text-lg font-semibold text-on-surface">₹{premiumStatus.preview.amount}</p>
                  </div>
                </>
              )}
              {!premiumStatus.isPremium && (
                <div className="rounded-xl bg-surface-container-low p-4">
                  <p className="text-xs uppercase tracking-widest font-bold text-on-surface-variant">Flat limit</p>
                  <p className="mt-1 text-lg font-semibold text-on-surface">{premiumStatus.trial?.isOnTrial ? `${premiumStatus.trial.flatLimit} (trial)` : `${premiumStatus.trial?.flatLimit ?? 5} (free tier)`}</p>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low px-4 py-3">
              <p className="text-sm text-on-surface-variant">{premiumStatus.preview.message}</p>
              {premiumStatus.activeSubscription?.currentPeriodEnd && (
                <p className="mt-2 text-xs text-on-surface-variant">
                  Current billing period ends on {new Date(premiumStatus.activeSubscription.currentPeriodEnd).toLocaleDateString()}.
                </p>
              )}
            </div>

            {!premiumStatus.isPremium && premiumStatus.trial?.isOnTrial && (
              <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 text-sm text-amber-800">
                <p className="font-semibold">Free trial active — {premiumStatus.trial.daysRemaining} day{premiumStatus.trial.daysRemaining !== 1 ? 's' : ''} remaining</p>
                <p className="mt-1 text-amber-700">You can add up to {premiumStatus.trial.flatLimit} flats during the trial. Upgrade to Premium from the flat-creation flow before your trial ends to avoid interruption.</p>
              </div>
            )}
            {!premiumStatus.isPremium && !premiumStatus.trial?.isOnTrial && (
              <div className="rounded-xl bg-warning-container px-4 py-3 text-sm text-on-warning-container">
                Your free trial has ended. Upgrade to Premium from the flat-creation flow to unlock more than {premiumStatus.trial?.flatLimit ?? 5} flats. Razorpay checkout will lock the billable flat count at the moment the subscription starts.
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-on-surface-variant">Premium plan details are unavailable right now.</p>
        )}
      </div>
      </SettingsAccordion>
      )}

      <SettingsAccordion
        title="Payment Gateway"
        description="Configure PhonePe Android SDK credentials and optional legacy web redirect fields"
        icon={CreditCard}
        iconWrapperClassName="group-open:bg-rose-100"
        iconClassName="group-open:text-rose-800"
      >
      <div className="space-y-6">
        <div className="flex items-center justify-between mb-6">
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
                    <ToggleRight className="w-8 h-8 text-emerald-700" />
                    <span className="text-emerald-700">Active</span>
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
                ? 'bg-emerald-50 text-emerald-900'
                : 'bg-rose-50 text-rose-900',
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
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">
            <p className="font-semibold text-on-surface">Required for Android SDK checkout</p>
            <p className="mt-1">Merchant ID, Client ID, Client Secret, and Client Version.</p>
            <p className="mt-2 font-semibold text-on-surface">Optional for legacy web redirect</p>
            <p className="mt-1">Salt Key, Salt Index, Redirect URL, and Callback URL are only needed if you still want PhonePe web redirect payments outside the Android app.</p>
          </div>

          {/* Environment Selector */}
          <div>
            <label className="label">Environment</label>
            <div className="flex flex-col gap-3 sm:flex-row">
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
                        : 'border-primary bg-primary-container text-primary'
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

          {/* Merchant and SDK credentials */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Merchant ID <span className="text-error">*</span></label>
              <input
                className="input"
                value={form.merchantId}
                onChange={(e) => handleChange('merchantId', e.target.value)}
                placeholder="e.g., MERCHANTUAT"
              />
              <p className="text-xs text-outline mt-1">Required for Android SDK and legacy web redirect flows</p>
            </div>
            <div>
              <label className="label">Client ID <span className="text-error">*</span></label>
              <input
                className="input"
                value={form.clientId}
                onChange={(e) => handleChange('clientId', e.target.value)}
                placeholder="Required for Android SDK auth token flow"
              />
              <p className="text-xs text-outline mt-1">Required for PhonePe Android SDK auth token flow</p>
            </div>
            <div>
              <label className="label">Salt Key</label>
              <div className="relative">
                <input
                  className="input pr-10"
                  type={showSaltKey ? 'text' : 'password'}
                  value={form.saltKey}
                  onChange={(e) => handleChange('saltKey', e.target.value)}
                  placeholder={isConfigured ? 'Leave blank to keep existing key' : 'Optional for legacy web redirect'}
                />
                <button
                  type="button"
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-outline hover:text-on-surface-variant touch-manipulation"
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
              {!cfg?.saltKeySet && (
                <p className="text-xs text-outline mt-1">Optional. Only needed for non-Android PhonePe redirect payments.</p>
              )}
            </div>
            <div>
              <label className="label">Client Secret <span className="text-error">*</span></label>
              <div className="relative">
                <input
                  className="input pr-10"
                  type={showClientSecret ? 'text' : 'password'}
                  value={form.clientSecret}
                  onChange={(e) => handleChange('clientSecret', e.target.value)}
                  placeholder={cfg?.clientSecretSet ? 'Leave blank to keep existing client secret' : 'Your PhonePe client secret'}
                />
                <button
                  type="button"
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-outline hover:text-on-surface-variant touch-manipulation"
                  onClick={() => setShowClientSecret(!showClientSecret)}
                >
                  {showClientSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {cfg?.clientSecretSet && (
                <p className="text-xs text-warning mt-1">
                  Current client secret is already saved. Leave this blank to keep it, or enter a new value to rotate it.
                </p>
              )}
              {!cfg?.clientSecretSet && (
                <p className="text-xs text-outline mt-1">Required together with Client ID for Android SDK checkout.</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Salt Index</label>
              <input
                className="input w-full sm:w-32"
                type="number"
                value={form.saltIndex}
                onChange={(e) => handleChange('saltIndex', e.target.value)}
                min={1}
              />
              <p className="text-xs text-outline mt-1">Optional. Used only with Salt Key for legacy web redirect flow.</p>
            </div>
            <div>
              <label className="label">Client Version <span className="text-error">*</span></label>
              <input
                className="input w-full sm:w-32"
                type="number"
                value={form.clientVersion}
                onChange={(e) => handleChange('clientVersion', e.target.value)}
                min={1}
              />
              <p className="text-xs text-outline mt-1">Required for SDK auth token generation. Usually 1 unless PhonePe assigned a different version.</p>
            </div>
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
                <p className="text-xs text-outline mt-1">Optional. Used only for legacy web redirect payments.</p>
              </div>
              <div>
                <label className="label">Callback URL (Server-to-Server)</label>
                <input
                  className="input"
                  value={form.callbackUrl}
                  onChange={(e) => handleChange('callbackUrl', e.target.value)}
                  placeholder="Server callback endpoint"
                />
                <p className="text-xs text-outline mt-1">Optional for SDK-only Android use. Needed for legacy web redirect callback handling.</p>
              </div>
            </div>
          </details>
        </div>

        {/* Action Buttons */}
        <div className="mt-8 border-t border-outline-variant/10 pt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row">
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
            <span className="text-xs text-warning flex items-center gap-1 sm:justify-end">
              <Clock className="w-3 h-3" /> Unsaved changes
            </span>
          )}
          </div>
        </div>
      </div>

      {/* Test Result Card */}
      {testResult && (
        <div
          className={cn(
            'rounded-2xl border border-outline-variant/15 bg-surface-container-low p-5',
            testResult.success ? 'ring-2 ring-tertiary/20' : 'ring-2 ring-error/20',
          )}
        >
          <div className="flex items-start gap-3">
            {testResult.success ? (
              <CheckCircle2 className="w-6 h-6 text-emerald-700 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-6 h-6 text-error shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <h3
                className={cn(
                  'font-semibold',
                  testResult.success ? 'text-emerald-700' : 'text-rose-700',
                )}
              >
                {testResult.success ? 'Test Passed ✓' : 'Test Failed ✗'}
              </h3>
              <p className="text-sm text-on-surface-variant mt-1">{testResult.message}</p>

              {testResult.details && (
                <div className="mt-3 bg-surface-container-low rounded-lg p-3">
                  <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
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
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-2">📘 PhonePe credential guide</h3>
        <ol className="text-sm text-slate-700 space-y-1.5 list-decimal list-inside">
          <li>Sign up on <a href="https://www.phonepe.com/business" target="_blank" rel="noopener noreferrer" className="underline font-medium">PhonePe Business</a></li>
          <li>Complete KYC and business verification</li>
          <li>Navigate to <strong>Developer Settings → API Keys</strong></li>
          <li>For Android SDK checkout, copy <strong>Merchant ID</strong>, <strong>Client ID</strong>, <strong>Client Secret</strong>, and <strong>Client Version</strong></li>
          <li>Copy <strong>Salt Key</strong> and <strong>Salt Index</strong> only if you still want legacy web redirect payments</li>
          <li>For testing, use the UAT sandbox credentials provided by PhonePe</li>
        </ol>
        <div className="mt-3 p-3 bg-white/60 rounded-lg text-xs font-mono text-slate-600">
            <p><strong>Sandbox note:</strong></p>
            <p>Use the UAT Merchant ID, Client ID, Client Secret, and Client Version issued to your own PhonePe merchant account for Android SDK checkout.</p>
            <p>Use Salt Key and Salt Index only when you need legacy web redirect support.</p>
            <p>Do not rely on shared sample credentials because they may be expired, disabled, or rate-limited.</p>
        </div>
      </div>
      </SettingsAccordion>

      <SettingsAccordion
        title="Collections & Billing"
        description="Controls for late fees, partial payments, advances and auto-adjust behavior"
        icon={AlertTriangle}
        iconWrapperClassName="group-open:bg-amber-100"
        iconClassName="group-open:text-amber-800"
      >
        <div className="space-y-4">
          {settingsLoading || !billingSettings ? (
            <div className="p-4">Loading...</div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="flex items-center justify-between rounded-xl p-4 bg-surface-container-low">
                  <div>
                    <div className="font-semibold">Late Fee Enabled</div>
                    <div className="text-sm text-on-surface-variant">Persist and charge configured late fees</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={!!billingSettings.lateFeeEnabled}
                    onChange={(e) => setBillingSettings({ ...billingSettings, lateFeeEnabled: e.target.checked })}
                  />
                </label>

                <label className="flex items-center justify-between rounded-xl p-4 bg-surface-container-low">
                  <div>
                    <div className="font-semibold">Partial Payment Allowed</div>
                    <div className="text-sm text-on-surface-variant">Allow residents to make partial payments</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={!!billingSettings.partialPaymentAllowed}
                    onChange={(e) => setBillingSettings({ ...billingSettings, partialPaymentAllowed: e.target.checked })}
                  />
                </label>

                <label className="flex items-center justify-between rounded-xl p-4 bg-surface-container-low">
                  <div>
                    <div className="font-semibold">Advance Payments Allowed</div>
                    <div className="text-sm text-on-surface-variant">Allow crediting advance balances for overpayments</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={!!billingSettings.advancePaymentAllowed}
                    onChange={(e) => setBillingSettings({ ...billingSettings, advancePaymentAllowed: e.target.checked })}
                  />
                </label>

                <label className="flex items-center justify-between rounded-xl p-4 bg-surface-container-low">
                  <div>
                    <div className="font-semibold">Auto Adjust Advance</div>
                    <div className="text-sm text-on-surface-variant">Automatically consume advance balance when generating bills</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={!!billingSettings.autoAdjustAdvance}
                    onChange={(e) => setBillingSettings({ ...billingSettings, autoAdjustAdvance: e.target.checked })}
                  />
                </label>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => settingsMutation.mutate(billingSettings)}
                  disabled={settingsMutation.isPending}
                  className="btn-primary"
                >
                  {settingsMutation.isPending ? 'Saving...' : 'Save Collections Settings'}
                </button>
                {settingsMutation.isError && <span className="text-sm text-error">Failed to save settings</span>}
              </div>
            </div>
          )}
        </div>
      </SettingsAccordion>

      <SettingsAccordion
        title="Gate Language"
        description="Choose up to three regional languages to show with English in Gate Management"
        icon={Globe}
        iconWrapperClassName="group-open:bg-sky-100"
        iconClassName="group-open:text-sky-800"
      >
        <div className="space-y-4">
          <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-low p-4">
            <label className="label">Additional regional languages</label>
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
              {REGIONAL_DICTATION_LANGUAGES.map((language) => {
                const checked = preferredGateLanguages.includes(language.value);
                const disabled = !checked && preferredGateLanguages.length >= MAX_GATE_REGIONAL_LANGUAGES;

                return (
                  <label
                    key={language.value}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors',
                      checked
                        ? 'border-primary/25 bg-primary-container/20'
                        : 'border-outline-variant/15 bg-surface',
                      disabled ? 'opacity-50' : 'cursor-pointer hover:border-primary/20',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-outline-variant/30 text-primary focus:ring-primary"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleGateLanguage(language.value)}
                    />
                    <span className="text-sm font-medium text-on-surface">{language.label}</span>
                  </label>
                );
              })}
            </div>
            <p className="mt-2 text-sm text-on-surface-variant">
              Gate Management will always show English. Select up to {MAX_GATE_REGIONAL_LANGUAGES} additional languages for voice capture shortcuts.
            </p>
            <p className="mt-1 text-xs text-on-surface-variant">
              Selected: {preferredGateLanguages.length} / {MAX_GATE_REGIONAL_LANGUAGES}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn-primary"
              onClick={handleSaveGateLanguage}
              disabled={!gateLanguageDirty}
            >
              Save Gate Language
            </button>
            {gateLanguageDirty && (
              <span className="text-xs text-warning flex items-center gap-1">
                <Clock className="w-3 h-3" /> Unsaved changes
              </span>
            )}
          </div>
        </div>
      </SettingsAccordion>
      </>
      )}

      <SettingsAccordion
        title="Account"
        description="Security actions and permanent account deletion"
        icon={AlertTriangle}
        iconWrapperClassName="group-open:bg-error-container"
        iconClassName="group-open:text-error"
      >
        <div className="space-y-4">
          <div className="rounded-2xl border border-error/15 bg-error-container/40 p-5">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-xl bg-white/80 p-2 text-error">
                <Trash2 className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-on-error-container">Delete account</h3>
                <p className="mt-1 text-sm text-on-surface-variant">
                  This permanently removes your sign-in access from Dwell Hub. Financial and audit records required by the society are retained without keeping your active account.
                </p>
                <p className="mt-2 text-xs text-error">
                  This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-4">
                <div className="rounded-xl border border-outline-variant/15 bg-white/70 px-4 py-3 text-sm text-on-surface-variant">
                  {user?.skipAccountDeletionVerification ? (
                    <>
                      <div className="flex items-center gap-2 text-on-surface">
                        <ShieldCheck className="h-4 w-4 text-primary" />
                        <span className="font-medium">Review OTP</span>
                      </div>
                      <p className="mt-1">This review account uses a fixed OTP for deletion instead of an email verification code.</p>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 text-on-surface">
                        <Mail className="h-4 w-4 text-primary" />
                        <span className="font-medium">Verification email</span>
                      </div>
                      <p className="mt-1 break-all">{user?.email}</p>
                    </>
                  )}
                </div>

                {deleteAccountStep === 'otp' ? (
                  <div className="space-y-4">
                    <div onPaste={handleDeleteOtpPaste}>
                      <label className="label">Enter 6-digit code</label>
                      <div className="grid grid-cols-6 gap-2">
                        {deleteOtp.map((digit, index) => (
                          <input
                            key={index}
                            ref={(element) => { deleteOtpRefs.current[index] = element; }}
                            inputMode="numeric"
                            maxLength={1}
                            className="h-12 w-full min-w-0 rounded-xl border border-outline-variant/30 bg-white text-center text-lg font-semibold text-on-surface outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 sm:w-12"
                            value={digit}
                            onChange={(event) => handleDeleteOtpChange(index, event.target.value)}
                            onKeyDown={(event) => handleDeleteOtpKeyDown(index, event)}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        className="btn-primary bg-error hover:bg-error/90 focus:ring-error"
                        onClick={handleVerifyDeleteAccount}
                        disabled={verifyDeleteAccountMutation.isPending}
                      >
                        {verifyDeleteAccountMutation.isPending ? 'Deleting account...' : 'Verify and delete'}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => sendDeleteAccountOtpMutation.mutate()}
                        disabled={sendDeleteAccountOtpMutation.isPending || deleteAccountResendCooldown > 0}
                      >
                        {deleteAccountResendCooldown > 0 ? `Resend in ${deleteAccountResendCooldown}s` : 'Resend code'}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          setDeleteAccountStep('idle');
                          setDeleteOtp(['', '', '', '', '', '']);
                          setDeleteAccountResendCooldown(0);
                        }}
                        disabled={verifyDeleteAccountMutation.isPending}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      className="btn-primary bg-error hover:bg-error/90 focus:ring-error"
                      onClick={() => sendDeleteAccountOtpMutation.mutate()}
                      disabled={sendDeleteAccountOtpMutation.isPending}
                    >
                      {sendDeleteAccountOtpMutation.isPending ? 'Sending code...' : 'Delete account'}
                    </button>
                  </div>
                )}
            </div>
          </div>
        </div>
      </SettingsAccordion>

      <SettingsAccordion
        title="Legal"
        description="Privacy, terms, bylaws, and refund policies"
        icon={ShieldCheck}
        iconWrapperClassName="group-open:bg-slate-200"
        iconClassName="group-open:text-slate-900"
      >
      <div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() => navigate('/bylaws')}
            className="rounded-xl border border-outline-variant/15 bg-surface-container-low px-4 py-4 text-left hover:border-primary/20 transition-colors"
          >
            <p className="text-xs uppercase tracking-widest font-bold text-on-surface-variant">Association</p>
            <p className="mt-1 text-sm font-semibold text-primary">Association Bylaws</p>
            <p className="mt-1 text-xs text-on-surface-variant">Open society rules, penalties, and governance guidelines.</p>
          </button>
          <a href={`${legalBaseUrl}/privacy`} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-outline-variant/15 bg-surface-container-low px-4 py-4 hover:border-primary/20 transition-colors">
            <p className="text-xs uppercase tracking-widest font-bold text-on-surface-variant">Privacy</p>
            <p className="mt-1 text-sm font-semibold text-primary">Privacy Policy</p>
          </a>
          <a href={`${legalBaseUrl}/terms`} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-outline-variant/15 bg-surface-container-low px-4 py-4 hover:border-primary/20 transition-colors">
            <p className="text-xs uppercase tracking-widest font-bold text-on-surface-variant">Use</p>
            <p className="mt-1 text-sm font-semibold text-primary">Terms of Service</p>
          </a>
          <a href={`${legalBaseUrl}/refund-policy`} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-outline-variant/15 bg-surface-container-low px-4 py-4 hover:border-primary/20 transition-colors">
            <p className="text-xs uppercase tracking-widest font-bold text-on-surface-variant">Payments</p>
            <p className="mt-1 text-sm font-semibold text-primary">Refund Policy</p>
          </a>
        </div>
      </div>
      </SettingsAccordion>

    </div>
  );
}

function SettingsAccordion({
  title,
  description,
  icon: Icon,
  defaultOpen = false,
  iconWrapperClassName,
  iconClassName,
  children,
}: {
  title: string;
  description: string;
  icon: typeof Settings;
  defaultOpen?: boolean;
  iconWrapperClassName?: string;
  iconClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group mb-6 rounded-3xl border border-outline-variant/15 bg-surface shadow-sm" open={defaultOpen}>
      <summary className="list-none cursor-pointer px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className={cn(
              'w-10 h-10 rounded-xl bg-surface-container-low flex items-center justify-center shrink-0 transition-colors',
              iconWrapperClassName,
            )}>
              <Icon className={cn('w-5 h-5 text-primary transition-colors', iconClassName || 'group-open:text-on-primary-container')} />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-on-surface">{title}</h2>
              <p className="text-xs text-on-surface-variant sm:text-sm sm:truncate">{description}</p>
            </div>
          </div>
          <ChevronDown className="w-4 h-4 text-outline transition-transform group-open:rotate-180 shrink-0" />
        </div>
      </summary>
      <div className="border-t border-outline-variant/10 px-5 py-5">{children}</div>
    </details>
  );
}

function MenuManagementPanel({
  menuVisibility,
  savingRole,
  onToggleMenu,
}: {
  menuVisibility: MenuVisibilityResponse;
  savingRole: ConfigurableMenuRole | null | undefined;
  onToggleMenu: (role: ConfigurableMenuRole, visibleMenuIds: NavigationMenuId[]) => void;
}) {
  const [selectedRole, setSelectedRole] = useState<ConfigurableMenuRole | null>(null);
  const selectedRoleConfig = menuVisibility.configurableRoles.find((roleConfig) => roleConfig.role === selectedRole) || null;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-low p-4 text-sm text-on-surface-variant">
        Current role menus stay locked as the mandatory baseline. Only additional menu items that already have usable route access can be enabled here.
      </div>

      <div className="space-y-3 md:hidden">
        {menuVisibility.configurableRoles.map((roleConfig) => {
          const isSaving = savingRole === roleConfig.role;
          const selectableCount = roleConfig.menuItems.filter((item) => item.selectable).length;

          return (
            <div key={roleConfig.role} className="rounded-2xl border border-outline-variant/15 bg-surface-container-low p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className={cn('inline-block px-2.5 py-0.5 rounded-full text-xs font-medium', ROLE_BADGE[roleConfig.role] || 'bg-surface-container text-on-surface-variant')}>
                    {roleConfig.roleLabel}
                  </span>
                  <p className="mt-3 text-sm font-medium text-on-surface">{roleConfig.visibleMenuIds.length} menus visible</p>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    {selectableCount === 0
                      ? 'Locked'
                      : `${roleConfig.visibleMenuIds.filter((menuId) => !roleConfig.mandatoryMenuIds.includes(menuId)).length} configurable visible`}
                  </p>
                </div>
                <button
                  type="button"
                  className="text-xs text-primary hover:text-primary font-medium inline-flex items-center gap-2 shrink-0"
                  onClick={() => setSelectedRole(roleConfig.role)}
                  disabled={isSaving}
                >
                  {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Configure
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto -mx-6 md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-on-surface-variant uppercase tracking-wider">
              <th className="px-6 py-2.5">Role</th>
              <th className="px-6 py-2.5">Visible Menus</th>
              <th className="px-6 py-2.5">Optional Menus</th>
              <th className="px-6 py-2.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {menuVisibility.configurableRoles.map((roleConfig) => {
              const isSaving = savingRole === roleConfig.role;
              const selectableCount = roleConfig.menuItems.filter((item) => item.selectable).length;

              return (
                <tr key={roleConfig.role} className="border-b last:border-0 hover:bg-surface-container-low/50">
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-3">
                      <span className={cn('inline-block px-2.5 py-0.5 rounded-full text-xs font-medium', ROLE_BADGE[roleConfig.role] || 'bg-surface-container text-on-surface-variant')}>
                        {roleConfig.roleLabel}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-3 text-on-surface">
                    {roleConfig.visibleMenuIds.length} menus
                  </td>
                  <td className="px-6 py-3 text-on-surface-variant">
                    {selectableCount === 0
                      ? 'Locked'
                      : `${roleConfig.visibleMenuIds.filter((menuId) => !roleConfig.mandatoryMenuIds.includes(menuId)).length} configurable visible`}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <button
                      type="button"
                      className="text-xs text-primary hover:text-primary font-medium inline-flex items-center gap-2"
                      onClick={() => setSelectedRole(roleConfig.role)}
                      disabled={isSaving}
                    >
                      {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      Configure
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-low p-4 text-sm text-on-surface-variant">
        Service staff menus are not included in this matrix yet because their navigation still depends on specialization, such as security versus non-security staff.
      </div>

      <Modal
        isOpen={!!selectedRoleConfig}
        onClose={() => {
          if (savingRole === selectedRole) return;
          setSelectedRole(null);
        }}
        title={selectedRoleConfig ? `${selectedRoleConfig.roleLabel} Menus` : 'Configure Menus'}
        size="lg"
      >
        {selectedRoleConfig ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low p-4">
              <p className="text-sm font-semibold text-on-surface">{selectedRoleConfig.roleLabel}</p>
              <p className="mt-1 text-xs text-on-surface-variant">
                Mandatory menus stay enabled. Default menus can be turned off only when they are not mandatory and the role is allowed to configure them.
              </p>
            </div>

            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {selectedRoleConfig.menuItems.map((item) => {
                const isSaving = savingRole === selectedRoleConfig.role;
                const disabled = !item.selectable || isSaving;

                return (
                  <label
                    key={item.id}
                    className={cn(
                      'flex flex-col gap-3 rounded-xl border px-4 py-3 transition-colors sm:flex-row sm:items-center sm:justify-between sm:gap-4',
                      item.enabled
                        ? 'border-primary/20 bg-primary-container/20'
                        : 'border-outline-variant/15 bg-surface',
                      disabled ? 'opacity-70' : 'cursor-pointer hover:border-primary/20',
                    )}
                  >
                    <div>
                      <p className="text-sm font-medium text-on-surface">{item.label}</p>
                      <p className="text-xs text-on-surface-variant mt-1">
                        {item.mandatory
                          ? 'Required by the current default role setup'
                          : !item.allowed
                            ? 'This role is not allowed to use this menu'
                            : item.defaultEnabled
                              ? 'Visible by default, but configurable'
                              : 'Hidden by default, but configurable'
                        }
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:shrink-0">
                      <span className={cn(
                        'badge',
                        item.mandatory
                          ? 'badge-neutral'
                          : !item.allowed
                            ? 'bg-surface-container text-on-surface-variant'
                            : item.enabled
                              ? 'badge-success'
                              : 'badge-neutral',
                      )}>
                        {item.mandatory ? 'Required' : !item.allowed ? 'Unavailable' : item.enabled ? 'Visible' : 'Hidden'}
                      </span>
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-outline-variant/30 text-primary focus:ring-primary"
                        checked={item.enabled}
                        disabled={disabled}
                        onChange={(event) => {
                          const nextVisibleMenuIds = event.target.checked
                            ? [...selectedRoleConfig.visibleMenuIds, item.id]
                            : selectedRoleConfig.visibleMenuIds.filter((menuId) => menuId !== item.id);
                          onToggleMenu(selectedRoleConfig.role, nextVisibleMenuIds);
                        }}
                      />
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSelectedRole(null)}
                disabled={savingRole === selectedRoleConfig.role}
              >
                Close
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
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
  SECRETARY: 'bg-slate-100 text-slate-700',
  JOINT_SECRETARY: 'bg-slate-100 text-slate-700',
  TREASURER: 'bg-warning-container text-warning',
  OWNER: 'bg-emerald-50 text-emerald-900',
  TENANT: 'bg-surface-container text-on-surface-variant',
  SERVICE_STAFF: 'bg-orange-50 text-orange-700',
};

function MembersRoles() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState('');
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [removalReason, setRemovalReason] = useState('');

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

  const removeMutation = useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason: string }) =>
      api.delete(`/settings/members/${userId}`, { data: { reason } }),
    onSuccess: () => {
      toast.success('Member removed');
      setRemoveTarget(null);
      setRemovalReason('');
      queryClient.invalidateQueries({ queryKey: ['settings-members'] });
      queryClient.invalidateQueries({ queryKey: ['staff'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to remove member'),
  });

  const formatRole = (role: string) =>
    ROLE_OPTIONS.find((r) => r.value === role)?.label || role.replace(/_/g, ' ');

  return (
    <div>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-outline" /></div>
      ) : members.length === 0 ? (
        <p className="text-sm text-outline text-center py-6">No members found</p>
      ) : (
        <>
        <div className="space-y-3 md:hidden">
          {members.map((m) => (
            <div key={m.id} className="rounded-2xl border border-outline-variant/15 bg-surface-container-low p-4">
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-on-surface">{m.name}</p>
                  <p className="mt-1 text-xs break-all text-on-surface-variant">{m.email}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-on-surface-variant mb-2">Current Role</p>
                  {editingId === m.id ? (
                    <div className="space-y-2">
                      <select
                        className="select w-full text-sm py-2"
                        value={selectedRole}
                        onChange={(e) => setSelectedRole(e.target.value)}
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                      <div className="flex gap-2">
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
                    </div>
                  ) : (
                    <span className={cn('inline-block px-2.5 py-0.5 rounded-full text-xs font-medium', ROLE_BADGE[m.role] || 'bg-surface-container text-on-surface-variant')}>
                      {formatRole(m.role)}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 pt-1">
                  {m.id === user?.id ? (
                    <span className="text-xs text-outline">You</span>
                  ) : editingId !== m.id ? (
                    <div className="inline-flex items-center gap-3 flex-wrap">
                      {m.role !== 'SERVICE_STAFF' && (
                        <button
                          className="text-xs text-primary hover:text-primary font-medium"
                          onClick={() => { setEditingId(m.id); setSelectedRole(m.role); }}
                        >
                          Change Role
                        </button>
                      )}
                      {(m.role === 'OWNER' || m.role === 'SERVICE_STAFF') && (
                        <button
                          className="text-xs text-error hover:text-error font-medium"
                          onClick={() => {
                            setRemoveTarget(m);
                            setRemovalReason('');
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ) : <span />}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="hidden overflow-x-auto -mx-6 md:block">
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
                      <div className="inline-flex items-center gap-3">
                        {m.role !== 'SERVICE_STAFF' && (
                          <button
                            className="text-xs text-primary hover:text-primary font-medium"
                            onClick={() => { setEditingId(m.id); setSelectedRole(m.role); }}
                          >
                            Change Role
                          </button>
                        )}
                        {(m.role === 'OWNER' || m.role === 'SERVICE_STAFF') && (
                          <button
                            className="text-xs text-error hover:text-error font-medium"
                            onClick={() => {
                              setRemoveTarget(m);
                              setRemovalReason('');
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
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
        </>
      )}

      <Modal
        isOpen={!!removeTarget}
        onClose={() => {
          if (removeMutation.isPending) return;
          setRemoveTarget(null);
          setRemovalReason('');
        }}
        title={`Remove ${removeTarget?.role === 'SERVICE_STAFF' ? 'Service Staff' : 'Owner'}`}
        size="md"
      >
        {removeTarget && (
          <div className="space-y-4">
            <div className="rounded-xl border border-error/15 bg-error-container/40 p-4">
              <p className="text-sm font-semibold text-on-surface">{removeTarget.name}</p>
              <p className="mt-1 text-xs text-on-surface-variant">{removeTarget.email} · {formatRole(removeTarget.role)}</p>
            </div>

            <div>
              <label className="label">Reason *</label>
              <textarea
                className="input min-h-[120px]"
                value={removalReason}
                onChange={(event) => setRemovalReason(event.target.value)}
                placeholder={`Explain why this ${removeTarget.role === 'SERVICE_STAFF' ? 'service staff' : 'owner'} is being removed from the society.`}
              />
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setRemoveTarget(null);
                  setRemovalReason('');
                }}
                disabled={removeMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary bg-error text-white hover:bg-error/90"
                disabled={removeMutation.isPending || !removalReason.trim()}
                onClick={() => removeMutation.mutate({ userId: removeTarget.id, reason: removalReason.trim() })}
              >
                {removeMutation.isPending ? 'Removing...' : `Remove ${removeTarget.role === 'SERVICE_STAFF' ? 'Staff' : 'Owner'}`}
              </button>
            </div>
          </div>
        )}
      </Modal>

    </div>
  );
}
