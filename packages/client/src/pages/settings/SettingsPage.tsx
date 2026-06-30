import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings, CreditCard, Eye, EyeOff, CheckCircle2, XCircle,
  Loader2, Zap, ToggleLeft, ToggleRight, ShieldCheck, Globe, Clock,
  Users, ChevronDown, Building2, AlertTriangle, Mail, Trash2, Pencil,
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
import type { AdminAssignmentType, ApprovalActionType, ApprovalConfig, ConfigurableMenuRole, FlatType, MenuVisibilityResponse, NavigationMenuId, PremiumStatusResponse, Role, SocietySettings } from '../../types';
import { SOCIETY_ADMINS } from '../../types';
import ManageStaffPanel from '../../components/settings/ManageStaffPanel';


interface PaymentGatewayConfig {
  id?: string;
  gateway: 'PHONEPE' | 'RAZORPAY';
  merchantId: string;
  clientId?: string;
  clientSecret?: string;
  clientSecretSet?: boolean;
  clientVersion?: number;
  keyId?: string;
  keySecret?: string;
  keySecretSet?: boolean;
  webhookSecret?: string;
  webhookSecretSet?: boolean;
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
    razorpayMessage?: string;
    error?: string;
  };
}

type PaymentGatewayResponse = {
  exists: boolean;
  activeGateway: 'PHONEPE' | 'RAZORPAY' | null;
  config: PaymentGatewayConfig;
  configs: Record<'PHONEPE' | 'RAZORPAY', PaymentGatewayConfig & { exists?: boolean }>;
};

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

const APPROVAL_WORKFLOW_OPTIONS: Array<{ actionType: ApprovalActionType; title: string; description: string }> = [
  {
    actionType: 'TENANT_REGISTRATION',
    title: 'Tenant Registration',
    description: 'Require committee review before a new tenant is added to a flat.',
  },
  {
    actionType: 'TENANT_PROFILE_CHANGE',
    title: 'Tenant Profile Change',
    description: 'Require approval before tenant self-service profile changes are applied.',
  },
];

const APPROVAL_APPROVER_ROLES: Role[] = ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER', 'OWNER'];

export default function SettingsPage() {
  const legalBaseUrl = 'https://dwellhub.in';
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const activeSocietyId = user?.activeSocietyId || user?.societyId || '';
  const [selectedGateway, setSelectedGateway] = useState<'PHONEPE' | 'RAZORPAY'>('PHONEPE');
  const [pendingGateway, setPendingGateway] = useState<'PHONEPE' | 'RAZORPAY' | null>(null);
  const [showGatewaySwitchConfirm, setShowGatewaySwitchConfirm] = useState(false);
  const [showGatewayActivationConfirm, setShowGatewayActivationConfirm] = useState(false);
  const [showSaltKey, setShowSaltKey] = useState(false);
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [showKeySecret, setShowKeySecret] = useState(false);
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [form, setForm] = useState({
    gateway: 'PHONEPE' as 'PHONEPE' | 'RAZORPAY',
    merchantId: '',
    clientId: '',
    clientSecret: '',
    clientVersion: '1',
    keyId: '',
    keySecret: '',
    webhookSecret: '',
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

  const { data, isLoading } = useQuery<PaymentGatewayResponse>({
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
  const { data: societySettings, isLoading: settingsLoading } = useQuery<SocietySettings>({
    queryKey: ['society-settings', activeSocietyId],
    queryFn: async () => (await api.get('/settings/society-settings')).data,
    enabled: isAdmin,
    retry: false,
  });

  const [billingSettings, setBillingSettings] = useState<SocietySettings | null>(null);

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

  const runLateFeeSchedulerMutation = useMutation({
    mutationFn: () => api.post('/settings/society-settings/run-late-fees', activeSocietyId ? { societyId: activeSocietyId } : {}),
    onSuccess: (res: any) => {
      toast.success(res.data?.message || 'Late fee scheduler completed');
      queryClient.invalidateQueries({ queryKey: ['society-settings', activeSocietyId] });
      queryClient.invalidateQueries({ queryKey: ['billing-summary'] });
      queryClient.invalidateQueries({ queryKey: ['bills'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to run late fee scheduler'),
  });

  const { data: tenantRegistrationApprovalConfig } = useQuery<ApprovalConfig>({
    queryKey: ['approval-config', activeSocietyId, 'TENANT_REGISTRATION'],
    queryFn: async () => (await api.get('/approvals/config/TENANT_REGISTRATION')).data,
    enabled: isAdmin && !!activeSocietyId,
  });

  const { data: tenantProfileChangeApprovalConfig } = useQuery<ApprovalConfig>({
    queryKey: ['approval-config', activeSocietyId, 'TENANT_PROFILE_CHANGE'],
    queryFn: async () => (await api.get('/approvals/config/TENANT_PROFILE_CHANGE')).data,
    enabled: isAdmin && !!activeSocietyId,
  });

  const approvalConfigMutation = useMutation({
    mutationFn: async ({ actionType, enabled, approverRoles }: { actionType: ApprovalActionType; enabled: boolean; approverRoles: Role[] }) => (
      await api.put(`/approvals/config/${actionType}`, { enabled, approverRoles })
    ).data as ApprovalConfig,
    onSuccess: (config) => {
      queryClient.setQueryData(['approval-config', activeSocietyId, config.actionType], config);
      toast.success('Approval workflow updated');
    },
    onError: (error: any) => toast.error(error.response?.data?.error || 'Failed to update approval workflow'),
  });

  // Populate form when data loads
  useEffect(() => {
    if (data?.configs) {
      const activeGateway = data.activeGateway || 'PHONEPE';
      const nextConfig = data.configs[activeGateway] || data.config;
      setSelectedGateway(activeGateway);
      setForm({
        gateway: activeGateway,
        merchantId: nextConfig.merchantId || '',
        clientId: nextConfig.clientId || '',
        clientSecret: '',
        clientVersion: String(nextConfig.clientVersion || 1),
        keyId: nextConfig.keyId || '',
        keySecret: '',
        webhookSecret: '',
        saltKey: '',
        saltIndex: String(nextConfig.saltIndex || 1),
        environment: nextConfig.environment || 'UAT',
        redirectUrl: nextConfig.redirectUrl || '',
        callbackUrl: nextConfig.callbackUrl || '',
      });
      setHasChanges(false);
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
    mutationFn: () => api.post('/settings/payment-gateway/test', { gateway: selectedGateway }),
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
    mutationFn: () => api.patch('/settings/payment-gateway/toggle', { gateway: selectedGateway }),
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
  const [communitySettingsSaving, setCommunitySettingsSaving] = useState(false);
  const [configuredFlatTypes, setConfiguredFlatTypes] = useState<FlatType[]>([]);
  const [flatTypesDirty, setFlatTypesDirty] = useState(false);
  const [isCommunityInfoEditing, setIsCommunityInfoEditing] = useState(false);

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

  const buildCommunityProfilePayload = () => {
    if (!cpForm.name.trim()) {
      toast.error('Community name is required');
      return null;
    }
    if (!cpForm.address.trim()) {
      toast.error('Address is required');
      return null;
    }
    if (!cpForm.city.trim()) {
      toast.error('City is required');
      return null;
    }
    if (!cpForm.state.trim()) {
      toast.error('State is required');
      return null;
    }
    if (cpForm.pincode && !/^\d{6}$/.test(cpForm.pincode)) {
      toast.error('Pincode must be 6 digits');
      return null;
    }

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

    return payload;
  };

  const resetCommunityProfileForm = () => {
    setCpForm({
      name: communityProfile?.name || '',
      communityType: communityProfile?.communityType || 'APARTMENT',
      address: communityProfile?.address || '',
      city: communityProfile?.city || '',
      state: communityProfile?.state || '',
      pincode: communityProfile?.pincode || '',
      totalUnits: communityProfile?.totalUnits != null ? String(communityProfile.totalUnits) : '',
    });
    setCpDirty(false);
  };

  const handleCommunityInfoSave = () => {
    const payload = buildCommunityProfilePayload();
    if (!payload) {
      return;
    }

    cpMutation.mutate(payload, {
      onSuccess: () => {
        setIsCommunityInfoEditing(false);
      },
    });
  };

  const handleCommunityInfoCancel = () => {
    resetCommunityProfileForm();
    setIsCommunityInfoEditing(false);
  };

  const handleCpSave = async () => {
    const payload = cpDirty ? buildCommunityProfilePayload() : null;
    if (cpDirty && !payload) {
      return;
    }

    if (!cpDirty && !housingSettingsDirty) {
      return;
    }

    setCommunitySettingsSaving(true);

    try {
      const requests: Promise<any>[] = [];

      if (cpDirty) {
        requests.push(api.put('/settings/community-profile', payload));
      }

      if (housingSettingsDirty) {
        requests.push(api.put('/settings/society-settings', {
          configuredFlatTypes,
          supportsPets: !!billingSettings?.supportsPets,
        }));
      }

      await Promise.all(requests);

      queryClient.invalidateQueries({ queryKey: ['community-profile'] });
      queryClient.invalidateQueries({ queryKey: ['society-settings', activeSocietyId] });
      setCpDirty(false);
      setFlatTypesDirty(false);
      setIsCommunityInfoEditing(false);
      toast.success('Settings saved');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to save settings');
    } finally {
      setCommunitySettingsSaving(false);
    }
  };

  const toggleConfiguredFlatType = (flatType: FlatType) => {
    setConfiguredFlatTypes((current) => (
      current.includes(flatType)
        ? current.filter((value) => value !== flatType)
        : [...current, flatType]
    ));
    setFlatTypesDirty(true);
  };

  const housingSettingsDirty = flatTypesDirty || (!!billingSettings && !!societySettings && !!billingSettings.supportsPets !== !!societySettings.supportsPets);

  const handleChange = (field: string, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setHasChanges(true);
    setTestResult(null);
  };

  const applyGatewaySelection = (gateway: 'PHONEPE' | 'RAZORPAY') => {
    if (!data?.configs) return;
    const nextConfig = data.configs[gateway];
    setSelectedGateway(gateway);
    setForm({
      gateway,
      merchantId: nextConfig?.merchantId || '',
      clientId: nextConfig?.clientId || '',
      clientSecret: '',
      clientVersion: String(nextConfig?.clientVersion || 1),
      keyId: nextConfig?.keyId || '',
      keySecret: '',
      webhookSecret: '',
      saltKey: '',
      saltIndex: String(nextConfig?.saltIndex || 1),
      environment: nextConfig?.environment || (gateway === 'PHONEPE' ? 'UAT' : 'PRODUCTION'),
      redirectUrl: nextConfig?.redirectUrl || '',
      callbackUrl: nextConfig?.callbackUrl || '',
    });
    setHasChanges(false);
    setTestResult(null);
  };

  const handleGatewaySelection = (gateway: 'PHONEPE' | 'RAZORPAY') => {
    if (gateway === selectedGateway) return;
    if (hasChanges) {
      setPendingGateway(gateway);
      setShowGatewaySwitchConfirm(true);
      return;
    }
    applyGatewaySelection(gateway);
  };

  const confirmGatewaySelection = () => {
    if (!pendingGateway) return;
    applyGatewaySelection(pendingGateway);
    setPendingGateway(null);
    setShowGatewaySwitchConfirm(false);
  };

  const closeGatewaySelectionConfirm = () => {
    setPendingGateway(null);
    setShowGatewaySwitchConfirm(false);
  };

  const handleGatewayActivationRequest = () => {
    setShowGatewayActivationConfirm(true);
  };

  const confirmGatewayActivation = () => {
    toggleMutation.mutate();
    setShowGatewayActivationConfirm(false);
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
    const parsedSaltIndex = parseInt(form.saltIndex, 10);
    const parsedClientVersion = parseInt(form.clientVersion, 10);
    const currentConfig = data?.configs?.[selectedGateway];

    if (selectedGateway === 'PHONEPE') {
      if (!form.merchantId.trim()) return toast.error('Merchant ID is required');
      if ((form.clientId.trim() && !form.clientSecret.trim() && !currentConfig?.clientSecretSet) || (!form.clientId.trim() && form.clientSecret.trim())) {
        return toast.error('Client ID and Client Secret must be provided together');
      }
      if (!Number.isFinite(parsedSaltIndex) || parsedSaltIndex < 1) return toast.error('Salt Index must be 1 or greater');
      if (!Number.isFinite(parsedClientVersion) || parsedClientVersion < 1) return toast.error('Client Version must be 1 or greater');
    } else {
      if (!form.keyId.trim() && !currentConfig?.keyId) {
        return toast.error('Razorpay Key ID is required');
      }
      if (!form.keySecret.trim() && !currentConfig?.keySecretSet) {
        return toast.error('Razorpay Key Secret is required');
      }
      if ((form.keyId.trim() && !form.keySecret.trim() && !currentConfig?.keySecretSet) || (!form.keyId.trim() && form.keySecret.trim())) {
        return toast.error('Razorpay Key ID and Key Secret must be provided together');
      }
    }

    const payload: any = {
      gateway: selectedGateway,
      merchantId: form.merchantId,
      environment: form.environment,
      redirectUrl: form.redirectUrl,
      callbackUrl: form.callbackUrl,
      isActive: true,
    };

    if (selectedGateway === 'PHONEPE') {
      payload.clientId = form.clientId.trim();
      payload.clientVersion = parsedClientVersion;
      payload.saltIndex = parsedSaltIndex;
      if (form.saltKey.trim()) {
        payload.saltKey = form.saltKey.trim();
      }
      if (form.clientSecret.trim()) {
        payload.clientSecret = form.clientSecret.trim();
      }
    } else {
      payload.keyId = form.keyId.trim();
      if (form.keySecret.trim()) {
        payload.keySecret = form.keySecret.trim();
      }
      if (form.webhookSecret.trim()) {
        payload.webhookSecret = form.webhookSecret.trim();
      }
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
  const selectedConfig: (PaymentGatewayConfig & { exists?: boolean }) | undefined = data?.configs?.[selectedGateway] || cfg;
  const isConfigured = Boolean(selectedConfig?.exists || selectedConfig?.id || (data?.activeGateway === selectedGateway && data?.exists));
  const isSelectedGatewayActive = data?.activeGateway === selectedGateway && !!selectedConfig?.isActive;
  const selectedGatewayGuideUrl = selectedGateway === 'PHONEPE'
    ? 'https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/authorization'
    : 'https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/' ;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="mt-1 text-sm text-on-surface-variant">Manage community preferences, billing rules, staff access, and integrations.</p>
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
        <div className="space-y-5">
          <section className="rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-5">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Community Info</p>
                <h3 className="mt-1 text-base font-semibold text-on-surface">Company Profile</h3>
                <p className="mt-1 text-sm text-on-surface-variant">Maintain the main identity, address, and unit count for this community.</p>
              </div>
              {!isCommunityInfoEditing ? (
                <button
                  type="button"
                  onClick={() => setIsCommunityInfoEditing(true)}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-outline-variant/20 bg-white text-slate-500 transition hover:border-primary/20 hover:text-primary"
                  aria-label="Edit company profile"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              ) : null}
            </div>

            {isCommunityInfoEditing ? (
              <>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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

                <div className="mt-4">
                  <label className="label">Address</label>
                  <input
                    className="input"
                    value={cpForm.address}
                    onChange={(e) => handleCpChange('address', e.target.value)}
                    placeholder="Full street address"
                  />
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
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

                <div className="mt-4 md:w-1/3">
                  <label className="label">Total Units</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={cpForm.totalUnits}
                    onChange={(e) => handleCpChange('totalUnits', e.target.value)}
                    placeholder="e.g., 120"
                  />
                  <p className="mt-1 text-xs text-on-surface-variant">Total flats, villas, or units in this community</p>
                </div>

                <div className="mt-5 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleCommunityInfoSave}
                    disabled={cpMutation.isPending || !cpDirty}
                    className="btn-primary"
                  >
                    {cpMutation.isPending ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
                    ) : (
                      'Save Company Profile'
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleCommunityInfoCancel}
                    disabled={cpMutation.isPending}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                <ProfileSummaryItem label="Community Name" value={cpForm.name || 'Not set'} />
                <ProfileSummaryItem label="Community Type" value={formatCommunityType(cpForm.communityType)} />
                <ProfileSummaryItem label="Total Units" value={cpForm.totalUnits || 'Not set'} />
                <ProfileSummaryItem label="Address" value={cpForm.address || 'Not set'} className="md:col-span-2 xl:col-span-3" />
                <ProfileSummaryItem label="City" value={cpForm.city || 'Not set'} />
                <ProfileSummaryItem label="State" value={cpForm.state || 'Not set'} />
                <ProfileSummaryItem label="Pincode" value={cpForm.pincode || 'Not set'} />
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-5">
            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Available Flat Types</p>
              <h3 className="mt-1 text-base font-semibold text-on-surface">Unit type configuration</h3>
              <p className="mt-1 text-sm text-on-surface-variant">Choose which flat types can be used in Flats & Residents when adding or editing units.</p>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
          </section>

          <section className="rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-5">
            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">General Settings</p>
              <h3 className="mt-1 text-base font-semibold text-on-surface">Resident profile preferences</h3>
              <p className="mt-1 text-sm text-on-surface-variant">Control shared profile options that affect resident-facing forms and views.</p>
            </div>

            <div className="rounded-xl border border-outline-variant/40 bg-white p-4">
              <label className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-semibold text-on-surface">Supports Pets</div>
                  <div className="text-sm text-on-surface-variant">Show pet details in resident-facing profile forms and views.</div>
                </div>
                <input
                  type="checkbox"
                  checked={!!billingSettings?.supportsPets}
                  onChange={(e) => setBillingSettings((current) => (current ? { ...current, supportsPets: e.target.checked } : current))}
                />
              </label>
            </div>
          </section>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleCpSave}
              disabled={communitySettingsSaving || (!cpDirty && !housingSettingsDirty)}
              className="btn-primary"
            >
              {communitySettingsSaving ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
              ) : (
                'Save Profile'
              )}
            </button>
          </div>
        </div>
      </SettingsAccordion>

      <SettingsAccordion
        title="Society Administration"
        description="Manage staff accounts and service staff access"
        icon={ShieldCheck}
        iconWrapperClassName="group-open:bg-emerald-100"
        iconClassName="group-open:text-emerald-800"
      >
        <div className="space-y-5">
          <ManageStaffPanel embedded />
        </div>
      </SettingsAccordion>

      <SettingsAccordion
        title="Roles & Menus"
        description="Choose which extra navigation menus each role can see and manage committee role capacity"
        icon={Settings}
        iconWrapperClassName="group-open:bg-fuchsia-100"
        iconClassName="group-open:text-fuchsia-800"
      >
        <div className="space-y-5">
          <MenuManagementPanel
            menuVisibility={menuVisibility || getFallbackMenuVisibility(activeSocietyId)}
            savingRole={menuVisibilityMutation.isPending ? menuVisibilityMutation.variables?.role : null}
            onToggleMenu={(role, visibleMenuIds) => menuVisibilityMutation.mutate({ role, visibleMenuIds })}
          />

          <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-low p-4">
            <label className="label">Committee Members Limit</label>
            {settingsLoading || !billingSettings ? (
              <div className="text-sm text-on-surface-variant">Loading...</div>
            ) : (
              <>
                <input
                  type="number"
                  min={0}
                  className="input"
                  value={billingSettings.committeeMemberLimit ?? 0}
                  onChange={(e) => setBillingSettings({ ...billingSettings, committeeMemberLimit: Number(e.target.value) })}
                />
                <p className="mt-2 text-xs text-on-surface-variant">Set 0 to allow unlimited committee members.</p>
                <div className="mt-4 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => settingsMutation.mutate(billingSettings)}
                    disabled={settingsMutation.isPending}
                    className="btn-primary"
                  >
                    {settingsMutation.isPending ? 'Saving...' : 'Save Roles & Menus Settings'}
                  </button>
                  {settingsMutation.isError && <span className="text-sm text-error">Failed to save settings</span>}
                </div>
              </>
            )}
          </div>
        </div>
      </SettingsAccordion>

      <SettingsAccordion
        title="Approval Workflows"
        description="Configure which resident actions need committee approval"
        icon={CheckCircle2}
        iconWrapperClassName="group-open:bg-sky-100"
        iconClassName="group-open:text-sky-800"
      >
        <div className="space-y-4">
          <p className="text-sm text-on-surface-variant">These controls affect whether tenant registrations and tenant self-service profile changes are applied immediately or routed through Inbox for review.</p>

          {APPROVAL_WORKFLOW_OPTIONS.map((workflow) => {
            const config = workflow.actionType === 'TENANT_REGISTRATION'
              ? tenantRegistrationApprovalConfig
              : tenantProfileChangeApprovalConfig;

            return (
              <ApprovalWorkflowCard
                key={workflow.actionType}
                title={workflow.title}
                description={workflow.description}
                config={config || {
                  societyId: activeSocietyId,
                  actionType: workflow.actionType,
                  enabled: false,
                  approverRoles: ['ADMIN', 'SECRETARY'],
                  updatedAt: null,
                }}
                saving={approvalConfigMutation.isPending && approvalConfigMutation.variables?.actionType === workflow.actionType}
                onToggleEnabled={(enabled) => approvalConfigMutation.mutate({
                  actionType: workflow.actionType,
                  enabled,
                  approverRoles: config?.approverRoles || ['ADMIN', 'SECRETARY'],
                })}
                onToggleRole={(role) => {
                  const currentRoles: Role[] = config?.approverRoles?.length ? config.approverRoles : ['ADMIN', 'SECRETARY'];
                  const nextRoles = currentRoles.includes(role)
                    ? currentRoles.filter((value) => value !== role)
                    : [...currentRoles, role];

                  approvalConfigMutation.mutate({
                    actionType: workflow.actionType,
                    enabled: config?.enabled ?? false,
                    approverRoles: nextRoles.length > 0 ? nextRoles : ['ADMIN', 'SECRETARY'],
                  });
                }}
              />
            );
          })}
        </div>
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
        description="Choose the active maintenance payment gateway and configure its credentials"
        icon={CreditCard}
        iconWrapperClassName="group-open:bg-rose-100"
        iconClassName="group-open:text-rose-800"
      >
      <div className="space-y-6">
        <div className="space-y-2">
          <label className="label">Payment Gateway</label>
          <div className="relative max-w-md">
            <select
              className="input appearance-none pr-10"
              value={selectedGateway}
              onChange={(e) => handleGatewaySelection(e.target.value as 'PHONEPE' | 'RAZORPAY')}
            >
              <option value="PHONEPE">PhonePe</option>
              <option value="RAZORPAY">Razorpay</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant" />
          </div>
        </div>

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            {isConfigured && (
              <button
                onClick={handleGatewayActivationRequest}
                disabled={toggleMutation.isPending}
                className="flex items-center gap-2 text-sm font-medium"
              >
                {isSelectedGatewayActive ? (
                  <>
                    <ToggleRight className="w-8 h-8 text-emerald-700" />
                    <span className="text-emerald-700">Active</span>
                  </>
                ) : (
                  <>
                    <ToggleLeft className="w-8 h-8 text-outline" />
                    <span className="text-on-surface-variant">Set as active gateway</span>
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
        {isConfigured && selectedConfig?.lastTestedAt && (
          <div
            className={cn(
              'flex items-center gap-2 p-3 rounded-lg mb-6 text-sm',
              selectedConfig.lastTestOk
                ? 'bg-emerald-50 text-emerald-900'
                : 'bg-rose-50 text-rose-900',
            )}
          >
            {selectedConfig.lastTestOk ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 shrink-0" />
            )}
            <span>
              Last test: {selectedConfig.lastTestOk ? 'Passed' : 'Failed'} —{' '}
              {new Date(selectedConfig.lastTestedAt).toLocaleString()}
            </span>
          </div>
        )}

        {/* Form */}
        <div className="space-y-5">
          <div>
            <label className="label">Environment</label>
            <div className="flex gap-8 border-b border-slate-200">
              {['UAT', 'PRODUCTION'].map((env) => (
                <button
                  key={env}
                  type="button"
                  onClick={() => handleChange('environment', env)}
                  className={cn(
                    'pb-3 text-sm transition-colors',
                    form.environment === env
                      ? 'border-b-2 border-blue-600 font-bold text-blue-600'
                      : 'font-medium text-slate-500 hover:text-slate-800',
                  )}
                >
                  {env === 'UAT' ? 'Sandbox (UAT)' : 'Production (Live)'}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-on-surface-variant">
              {form.environment === 'UAT'
                ? 'Use test credentials and non-production callbacks while validating the setup.'
                : 'Real payments will be processed in this mode.'}
            </p>
          </div>

          {form.environment === 'PRODUCTION' && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-error-container text-error text-sm">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>
                <strong>Production mode:</strong> Real money will be charged. Make sure your {selectedGateway === 'PHONEPE' ? 'PhonePe merchant account' : 'Razorpay account'} is fully activated.
              </span>
            </div>
          )}

          {/* Merchant and SDK credentials */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">{selectedGateway === 'PHONEPE' ? 'Merchant ID' : 'Merchant Label'} {selectedGateway === 'PHONEPE' ? <span className="text-error">*</span> : null}</label>
              <input
                className="input"
                value={form.merchantId}
                onChange={(e) => handleChange('merchantId', e.target.value)}
                placeholder={selectedGateway === 'PHONEPE' ? 'e.g., MERCHANTUAT' : 'Optional internal label'}
              />
              <p className="text-xs text-outline mt-1">
                {selectedGateway === 'PHONEPE'
                  ? 'Required for Android SDK and legacy web redirect flows'
                  : 'Optional. Use this only if you want an internal label for this Razorpay setup.'}
              </p>
            </div>
            {selectedGateway === 'PHONEPE' ? (
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
            ) : (
            <div>
              <label className="label">Razorpay Key ID <span className="text-error">*</span></label>
              <input
                className="input"
                value={form.keyId}
                onChange={(e) => handleChange('keyId', e.target.value)}
                placeholder="rzp_live_xxxxx or rzp_test_xxxxx"
              />
              <p className="text-xs text-outline mt-1">Required to launch Razorpay checkout.</p>
            </div>
            )}
            {selectedGateway === 'PHONEPE' ? (
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
              {isConfigured && selectedConfig?.saltKeySet && (
                <p className="text-xs text-warning mt-1">
                  Current key is already saved. Leave this blank to keep it, or enter a new value to rotate it.
                </p>
              )}
              {!selectedConfig?.saltKeySet && (
                <p className="text-xs text-outline mt-1">Optional. Only needed for non-Android PhonePe redirect payments.</p>
              )}
            </div>
            ) : (
            <div>
              <label className="label">Webhook Secret</label>
              <div className="relative">
                <input
                  className="input pr-10"
                  type={showWebhookSecret ? 'text' : 'password'}
                  value={form.webhookSecret}
                  onChange={(e) => handleChange('webhookSecret', e.target.value)}
                  placeholder={selectedConfig?.webhookSecretSet ? 'Leave blank to keep existing webhook secret' : 'Recommended for webhook verification'}
                />
                <button
                  type="button"
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-outline hover:text-on-surface-variant touch-manipulation"
                  onClick={() => setShowWebhookSecret(!showWebhookSecret)}
                >
                  {showWebhookSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {selectedConfig?.webhookSecretSet && (
                <p className="text-xs text-warning mt-1">Current webhook secret is already saved. Leave blank to keep it, or enter a new one to rotate it.</p>
              )}
            </div>
            )}
            {selectedGateway === 'PHONEPE' ? (
            <div>
              <label className="label">Client Secret <span className="text-error">*</span></label>
              <div className="relative">
                <input
                  className="input pr-10"
                  type={showClientSecret ? 'text' : 'password'}
                  value={form.clientSecret}
                  onChange={(e) => handleChange('clientSecret', e.target.value)}
                  placeholder={selectedConfig?.clientSecretSet ? 'Leave blank to keep existing client secret' : 'Your PhonePe client secret'}
                />
                <button
                  type="button"
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-outline hover:text-on-surface-variant touch-manipulation"
                  onClick={() => setShowClientSecret(!showClientSecret)}
                >
                  {showClientSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {selectedConfig?.clientSecretSet && (
                <p className="text-xs text-warning mt-1">
                  Current client secret is already saved. Leave this blank to keep it, or enter a new value to rotate it.
                </p>
              )}
              {!selectedConfig?.clientSecretSet && (
                <p className="text-xs text-outline mt-1">Required together with Client ID for Android SDK checkout.</p>
              )}
            </div>
            ) : (
            <div>
              <label className="label">Razorpay Key Secret <span className="text-error">*</span></label>
              <div className="relative">
                <input
                  className="input pr-10"
                  type={showKeySecret ? 'text' : 'password'}
                  value={form.keySecret}
                  onChange={(e) => handleChange('keySecret', e.target.value)}
                  placeholder={selectedConfig?.keySecretSet ? 'Leave blank to keep existing key secret' : 'Your Razorpay key secret'}
                />
                <button
                  type="button"
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-outline hover:text-on-surface-variant touch-manipulation"
                  onClick={() => setShowKeySecret(!showKeySecret)}
                >
                  {showKeySecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {selectedConfig?.keySecretSet && (
                <p className="text-xs text-warning mt-1">Current key secret is already saved. Leave blank to keep it, or enter a new value to rotate it.</p>
              )}
            </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {selectedGateway === 'PHONEPE' ? (
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
            ) : null}
            <div>
              <label className="label">{selectedGateway === 'PHONEPE' ? 'Client Version' : 'Environment'} {selectedGateway === 'PHONEPE' ? <span className="text-error">*</span> : null}</label>
              {selectedGateway === 'PHONEPE' ? (
              <input
                className="input w-full sm:w-32"
                type="number"
                value={form.clientVersion}
                onChange={(e) => handleChange('clientVersion', e.target.value)}
                min={1}
              />
              ) : (
              <input
                className="input w-full"
                value={form.environment}
                disabled
              />
              )}
              <p className="text-xs text-outline mt-1">{selectedGateway === 'PHONEPE' ? 'Required for SDK auth token generation. Usually 1 unless PhonePe assigned a different version.' : 'Razorpay runs against its hosted API environment.'}</p>
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
                <p className="text-xs text-outline mt-1">Used when the user returns to the app after checkout.</p>
              </div>
              <div>
                <label className="label">Callback URL (Server-to-Server)</label>
                <input
                  className="input"
                  value={form.callbackUrl}
                  onChange={(e) => handleChange('callbackUrl', e.target.value)}
                  placeholder="Server callback endpoint"
                />
                <p className="text-xs text-outline mt-1">Server callback endpoint for gateway status/webhook updates.</p>
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
            'rounded-xl border px-4 py-3',
            testResult.success
              ? 'border-emerald-200 bg-emerald-50/70'
              : 'border-rose-200 bg-rose-50/70',
          )}
        >
          <div className="flex items-start gap-3">
            {testResult.success ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
            ) : (
              <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" />
            )}
            <div className="flex-1">
              <h3
                className={cn(
                  'text-sm font-semibold',
                  testResult.success ? 'text-emerald-800' : 'text-rose-800',
                )}
              >
                {testResult.success ? 'Connection test passed' : 'Connection test failed'}
              </h3>
              <p className="mt-1 text-sm text-on-surface-variant">{testResult.message}</p>

              {testResult.details && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-on-surface-variant">
                    {testResult.details.httpStatus && (
                      <div>
                        <span>HTTP Status:</span>{' '}
                        <span className="font-mono font-medium">{testResult.details.httpStatus}</span>
                      </div>
                    )}
                    {testResult.details.code && (
                      <div>
                        <span>Response Code:</span>{' '}
                        <span className="font-mono font-medium">{testResult.details.code}</span>
                      </div>
                    )}
                    {testResult.details.responseTime && (
                      <div>
                        <span>Response Time:</span>{' '}
                        <span className="font-mono font-medium">{testResult.details.responseTime}</span>
                      </div>
                    )}
                    {testResult.details.environment && (
                      <div>
                        <span>Environment:</span>{' '}
                        <span className="font-mono font-medium">{testResult.details.environment}</span>
                      </div>
                    )}
                    {testResult.details.phonePeMessage && (
                      <div className="basis-full">
                        <span>PhonePe Message:</span>{' '}
                        <span className="font-mono text-xs">{testResult.details.phonePeMessage}</span>
                      </div>
                    )}
                    {testResult.details.error && (
                      <div className="basis-full">
                        <span>Error:</span>{' '}
                        <span className="font-mono text-xs text-rose-700">{testResult.details.error}</span>
                      </div>
                    )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Info Card */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="mb-1 text-sm font-semibold text-slate-900">Integration guide</h3>
            <p className="text-sm text-slate-700">
              {selectedGateway === 'PHONEPE'
                ? 'See the official PhonePe setup guide for credential generation, sandbox access, and optional redirect support.'
                : 'See the official Razorpay setup guide for API keys, test mode, webhook setup, and checkout configuration.'}
            </p>
          </div>
          <a
            href={selectedGatewayGuideUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-xl border border-outline-variant/20 bg-white px-4 py-2 text-sm font-medium text-primary transition-colors hover:border-primary/20"
          >
            Open {selectedGateway === 'PHONEPE' ? 'PhonePe' : 'Razorpay'} Guide
          </a>
        </div>
        <div className="mt-4 rounded-xl bg-white/60 p-4 text-xs text-slate-600">
          <p className="font-semibold text-slate-800">Quick reference</p>
          <p className="mt-1">
            {selectedGateway === 'PHONEPE'
              ? 'Required: Merchant ID, Client ID, Client Secret, Client Version. Optional: Salt Key, Salt Index, Redirect URL, Callback URL.'
              : 'Required: Key ID and Key Secret. Recommended: Webhook Secret. Optional: Merchant Label, Redirect URL and Callback URL.'}
          </p>
        </div>
      </div>
      </SettingsAccordion>

      <Modal
        isOpen={showGatewaySwitchConfirm}
        onClose={closeGatewaySelectionConfirm}
        title="Discard current gateway changes?"
        size="md"
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            You have unsaved changes for {selectedGateway === 'PHONEPE' ? 'PhonePe' : 'Razorpay'}. Switching the dropdown now will discard those edits from the form.
          </div>
          <p className="text-sm text-on-surface-variant">
            Continue only if you intentionally want to switch to {pendingGateway === 'PHONEPE' ? 'PhonePe' : 'Razorpay'} settings without saving the current form.
          </p>
          <div className="flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={closeGatewaySelectionConfirm}>Cancel</button>
            <button type="button" className="btn-primary" onClick={confirmGatewaySelection}>Switch Gateway</button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showGatewayActivationConfirm}
        onClose={() => {
          if (toggleMutation.isPending) return;
          setShowGatewayActivationConfirm(false);
        }}
        title={isSelectedGatewayActive ? 'Confirm active gateway status' : `Activate ${selectedGateway === 'PHONEPE' ? 'PhonePe' : 'Razorpay'}?`}
        size="md"
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            {isSelectedGatewayActive
              ? `${selectedGateway === 'PHONEPE' ? 'PhonePe' : 'Razorpay'} is already the active resident payment gateway.`
              : `Residents will start using ${selectedGateway === 'PHONEPE' ? 'PhonePe' : 'Razorpay'} for maintenance payments after this change.`}
          </div>
          {!isSelectedGatewayActive ? (
            <p className="text-sm text-on-surface-variant">
              Make this change only after you have saved the credentials, selected the correct environment, and verified a connection test. Existing payment history stays intact, but all new resident payments will use the newly active gateway.
            </p>
          ) : (
            <p className="text-sm text-on-surface-variant">
              No gateway change will happen. Close this dialog if you only wanted to review the current active status.
            </p>
          )}
          <div className="flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => setShowGatewayActivationConfirm(false)} disabled={toggleMutation.isPending}>Cancel</button>
            {!isSelectedGatewayActive ? (
              <button type="button" className="btn-primary" onClick={confirmGatewayActivation} disabled={toggleMutation.isPending}>
                {toggleMutation.isPending ? 'Updating...' : 'Confirm Gateway Change'}
              </button>
            ) : null}
          </div>
        </div>
      </Modal>

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

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-xl p-4 bg-surface-container-low">
                  <label className="label">Due Date of Every Month</label>
                  <input
                    type="number"
                    min={1}
                    max={28}
                    className="input"
                    value={billingSettings.dueDay ?? 10}
                    onChange={(e) => setBillingSettings({ ...billingSettings, dueDay: Number(e.target.value) })}
                  />
                </div>
                <div className="rounded-xl p-4 bg-surface-container-low">
                  <label className="label">Grace Period (Days)</label>
                  <input
                    type="number"
                    min={0}
                    className="input"
                    value={billingSettings.gracePeriodDays ?? 0}
                    onChange={(e) => setBillingSettings({ ...billingSettings, gracePeriodDays: Number(e.target.value) })}
                  />
                </div>
                <div className="rounded-xl p-4 bg-surface-container-low">
                  <label className="label">Late Fee Type</label>
                  <select
                    className="select"
                    value={billingSettings.lateFeeMode ?? 'PER_DAY'}
                    onChange={(e) => setBillingSettings({ ...billingSettings, lateFeeMode: e.target.value as SocietySettings['lateFeeMode'] })}
                  >
                    <option value="PER_DAY">Per Day</option>
                    <option value="ONE_TIME_PER_BILL">One-Time Per Bill</option>
                    <option value="RECURRING">Recurring Late Fee</option>
                  </select>
                </div>
                {billingSettings.lateFeeMode === 'RECURRING' ? (
                  <div className="rounded-xl p-4 bg-surface-container-low">
                    <label className="label">Recurring Frequency</label>
                    <select
                      className="select"
                      value={billingSettings.recurringLateFeeFrequency ?? 'MONTHLY'}
                      onChange={(e) => setBillingSettings({ ...billingSettings, recurringLateFeeFrequency: e.target.value as SocietySettings['recurringLateFeeFrequency'] })}
                    >
                      <option value="MONTHLY">Monthly</option>
                      <option value="DAILY">Daily</option>
                    </select>
                  </div>
                ) : null}
              </div>

              <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/70 p-4">
                <div className="font-semibold text-slate-900">Manual Late Fee Run</div>
                <div className="mt-1 text-sm text-slate-600">
                  Trigger the late fee scheduler immediately for this society. This is useful when testing overdue and late fee behavior after changing billing dates or fee settings.
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => runLateFeeSchedulerMutation.mutate()}
                    disabled={runLateFeeSchedulerMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-lg border border-amber-500 bg-white px-4 py-2 text-sm font-semibold text-amber-800 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {runLateFeeSchedulerMutation.isPending ? 'Running Scheduler...' : 'Run Late Fee Scheduler Now'}
                  </button>
                  {runLateFeeSchedulerMutation.isError ? <span className="text-sm text-error">Failed to run scheduler</span> : null}
                </div>
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
        title="General Settings"
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

function formatCommunityType(value: string) {
  switch (value) {
    case 'APARTMENT':
      return 'Apartment / Society';
    case 'VILLA':
      return 'Villa Community';
    case 'GATED_COMMUNITY':
      return 'Gated Community';
    case 'TOWNSHIP':
      return 'Township';
    default:
      return value || 'Not set';
  }
}

function ProfileSummaryItem({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl border border-outline-variant/20 bg-white px-4 py-3', className)}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">{label}</p>
      <p className="mt-2 text-sm font-medium text-on-surface">{value}</p>
    </div>
  );
}

function ApprovalWorkflowCard({
  title,
  description,
  config,
  saving,
  onToggleEnabled,
  onToggleRole,
}: {
  title: string;
  description: string;
  config: ApprovalConfig;
  saving: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  onToggleRole: (role: Role) => void;
}) {
  return (
    <section className="rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-base font-semibold text-on-surface">{title}</h3>
          <p className="mt-1 text-sm text-on-surface-variant">{description}</p>
          <p className="mt-2 text-xs text-on-surface-variant">
            {config.updatedAt ? `Last updated ${new Date(config.updatedAt).toLocaleString()}` : 'Using default configuration'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => onToggleEnabled(!config.enabled)}
          disabled={saving}
          className={cn(
            'inline-flex min-w-[132px] items-center justify-center rounded-xl border px-4 py-2 text-sm font-semibold transition-colors',
            config.enabled
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
          )}
        >
          {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : config.enabled ? 'Approval On' : 'Approval Off'}
        </button>
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-on-surface-variant">Approver Roles</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {APPROVAL_APPROVER_ROLES.map((role) => {
            const active = config.approverRoles.includes(role);
            return (
              <button
                key={role}
                type="button"
                onClick={() => onToggleRole(role)}
                disabled={saving}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                  active
                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50',
                )}
              >
                {role.replace(/_/g, ' ')}
              </button>
            );
          })}
        </div>
      </div>
    </section>
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
  adminAssignmentType?: AdminAssignmentType | null;
  isActive: boolean;
};

const ROLE_OPTIONS = [
  { value: 'SECRETARY', label: 'Secretary' },
  { value: 'JOINT_SECRETARY', label: 'Joint Secretary' },
  { value: 'TREASURER', label: 'Treasurer' },
  { value: 'COMMITTEE_MEMBER', label: 'Committee Member' },
  { value: 'OWNER', label: 'Owner' },
  { value: 'SERVICE_STAFF', label: 'Service Staff' },
];

const ROLE_BADGE: Record<string, string> = {
  ADMIN: 'bg-purple-50 text-purple-700',
  SECRETARY: 'bg-slate-100 text-slate-700',
  JOINT_SECRETARY: 'bg-slate-100 text-slate-700',
  TREASURER: 'bg-warning-container text-warning',
  COMMITTEE_MEMBER: 'bg-sky-50 text-sky-700',
  OWNER: 'bg-emerald-50 text-emerald-900',
  TENANT: 'bg-surface-container text-on-surface-variant',
  SERVICE_STAFF: 'bg-orange-50 text-orange-700',
};

function MembersRoles() {
  const queryClient = useQueryClient();
  const { user, setUser } = useAuthStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState('');
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [removalReason, setRemovalReason] = useState('');
  const [transferTarget, setTransferTarget] = useState<Member | null>(null);

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

  const transferMutation = useMutation({
    mutationFn: async ({ userId }: { userId: string }) => {
      await api.post(`/settings/members/${userId}/transfer-president`);
      return (await api.get('/auth/me')).data;
    },
    onSuccess: (nextUser) => {
      toast.success('President transferred');
      setTransferTarget(null);
      setUser(nextUser);
      queryClient.invalidateQueries({ queryKey: ['settings-members'] });
      queryClient.invalidateQueries({ queryKey: ['my-societies'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to transfer President role'),
  });

  const formatRole = (role: string, adminAssignmentType?: AdminAssignmentType | null) => {
    if (role === 'ADMIN') {
      return adminAssignmentType === 'TEMPORARY' ? 'Temporary Admin' : 'President';
    }

    return ROLE_OPTIONS.find((r) => r.value === role)?.label || role.replace(/_/g, ' ');
  };

  const canTransferPresident = (member: Member) => user?.role === 'ADMIN' && member.id !== user.id && member.role === 'OWNER';

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
                      {formatRole(m.role, m.adminAssignmentType)}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 pt-1">
                  {m.id === user?.id ? (
                    <span className="text-xs text-outline">You</span>
                  ) : editingId !== m.id ? (
                    <div className="inline-flex items-center gap-3 flex-wrap">
                      {m.role !== 'SERVICE_STAFF' && m.role !== 'ADMIN' && (
                        <button
                          className="text-xs text-primary hover:text-primary font-medium"
                          onClick={() => { setEditingId(m.id); setSelectedRole(m.role); }}
                        >
                          Change Role
                        </button>
                      )}
                      {canTransferPresident(m) && (
                        <button
                          className="text-xs text-primary hover:text-primary font-medium"
                          onClick={() => setTransferTarget(m)}
                        >
                          Transfer President
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
                        {formatRole(m.role, m.adminAssignmentType)}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-right">
                    {editingId !== m.id && m.id !== user?.id && (
                      <div className="inline-flex items-center gap-3">
                        {m.role !== 'SERVICE_STAFF' && m.role !== 'ADMIN' && (
                          <button
                            className="text-xs text-primary hover:text-primary font-medium"
                            onClick={() => { setEditingId(m.id); setSelectedRole(m.role); }}
                          >
                            Change Role
                          </button>
                        )}
                        {canTransferPresident(m) && (
                          <button
                            className="text-xs text-primary hover:text-primary font-medium"
                            onClick={() => setTransferTarget(m)}
                          >
                            Transfer President
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

        <Modal
          isOpen={!!transferTarget}
          onClose={() => {
            if (transferMutation.isPending) return;
            setTransferTarget(null);
          }}
          title="Transfer President"
          size="md"
        >
          {transferTarget && (
            <div className="space-y-4">
              <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-4">
                <p className="text-sm font-semibold text-on-surface">{transferTarget.name}</p>
                <p className="mt-1 text-xs text-on-surface-variant">{transferTarget.email}</p>
                <p className="mt-2 text-xs text-on-surface-variant">
                  Only active owners can become President. After transfer, your account will become Owner and lose admin privileges immediately.
                </p>
              </div>

              <div className="rounded-xl border border-warning/20 bg-warning-container/40 p-4 text-sm text-on-surface">
                Make sure your account is already mapped as an owner in this community before you confirm. The server will block the transfer otherwise.
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setTransferTarget(null)}
                  disabled={transferMutation.isPending}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={transferMutation.isPending}
                  onClick={() => transferMutation.mutate({ userId: transferTarget.id })}
                >
                  {transferMutation.isPending ? 'Transferring...' : 'Confirm Transfer'}
                </button>
              </div>
            </div>
          )}
        </Modal>
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
