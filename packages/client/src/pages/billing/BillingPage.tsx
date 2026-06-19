import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Receipt, Plus, CreditCard, Banknote, BellRing, History, FileBarChart2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency, formatDate, getStatusColor, getMonthName, cn } from '../../lib/utils';
import { PageLoader, EmptyState } from '../../components/ui/Loader';
import Modal from '../../components/ui/Modal';
import { initPhonePeSdk, startPhonePeCheckout } from '../../lib/phonePeNative';
import { isNativeAndroid, isNativeIos } from '../../lib/platform';
import { useAuthStore } from '../../store/authStore';
import { isOwnerViewActive } from '../../lib/ownerView';
import type {
  BillKind,
  BillingGenerationResult,
  CustomBillingMode,
  FlatOption,
  MaintenanceBill,
  MaintenanceBillLineItem,
  MaintenanceConfigSummary,
  OwnerBillingSummary,
  SocietyBillingSettings,
} from '../../types';

const currentDate = new Date();
const yearOptions = Array.from({ length: 5 }, (_, index) => currentDate.getFullYear() - 1 + index);
type BillingStatusFilter = 'ALL' | 'PENDING' | 'OVERDUE' | 'PARTIAL' | 'PAID';
type BillingKindFilter = 'ALL' | BillKind;
const billingStatusOptions: Array<{ value: BillingStatusFilter; label: string }> = [
  { value: 'ALL', label: 'All Status' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'PARTIAL', label: 'Partial' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'PAID', label: 'Paid' },
];
const billingKindOptions: Array<{ value: BillingKindFilter; label: string }> = [
  { value: 'ALL', label: 'All Bills' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'OPENING_BALANCE', label: 'Opening Balance' },
  { value: 'SPECIAL', label: 'Special Bills' },
];
const customBillingModeOptions: Array<{ value: CustomBillingMode; label: string }> = [
  { value: 'OPENING_BALANCE', label: 'Opening Balance' },
  { value: 'STANDALONE_SPECIAL', label: 'Standalone Special Bill' },
];

type BillingConfigFormState = {
  baseAmount: number | '';
  waterCharge: number | '';
  parkingCharge: number | '';
  sinkingFund: number | '';
  repairFund: number | '';
  otherCharges: number | '';
  lateFeePerDay: number | '';
  lateFeeAmount: number | '';
  recurringLateFeeAmount: number | '';
};

type CustomBillingFormState = {
  mode: CustomBillingMode;
  flatId: string;
  title: string;
  description: string;
  notes: string;
  amount: string;
};

function buildConfigForm(summary?: MaintenanceConfigSummary): BillingConfigFormState {
  return {
    baseAmount: summary?.baseAmount ?? 0,
    waterCharge: summary?.waterCharge ?? 0,
    parkingCharge: summary?.parkingCharge ?? 0,
    sinkingFund: summary?.sinkingFund ?? 0,
    repairFund: summary?.repairFund ?? 0,
    otherCharges: summary?.otherCharges ?? 0,
    lateFeePerDay: summary?.lateFeePerDay ?? 0,
    lateFeeAmount: summary?.lateFeeAmount ?? 0,
    recurringLateFeeAmount: summary?.recurringLateFeeAmount ?? 0,
  };
}

function normalizeBillingConfigForm(value: BillingConfigFormState) {
  return {
    baseAmount: Number(value.baseAmount || 0),
    waterCharge: Number(value.waterCharge || 0),
    parkingCharge: Number(value.parkingCharge || 0),
    sinkingFund: Number(value.sinkingFund || 0),
    repairFund: Number(value.repairFund || 0),
    otherCharges: Number(value.otherCharges || 0),
    lateFeePerDay: Number(value.lateFeePerDay || 0),
    lateFeeAmount: Number(value.lateFeeAmount || 0),
    recurringLateFeeAmount: Number(value.recurringLateFeeAmount || 0),
  };
}

function buildCustomBillingForm(mode: CustomBillingMode = 'OPENING_BALANCE'): CustomBillingFormState {
  return {
    mode,
    flatId: '',
    title: mode === 'OPENING_BALANCE' ? 'Opening Balance' : '',
    description: '',
    notes: '',
    amount: '',
  };
}

function getBillPeriodLabel(bill: Pick<MaintenanceBill, 'month' | 'year' | 'appliesToMonth' | 'appliesToYear'>) {
  const month = bill.appliesToMonth ?? bill.month;
  const year = bill.appliesToYear ?? bill.year;
  return month && year ? `${getMonthName(month)} ${year}` : null;
}

function getBillDisplayTitle(bill: MaintenanceBill) {
  if (bill.title) return bill.title;
  if (bill.billKind === 'OPENING_BALANCE') return 'Opening Balance';
  if (bill.billKind === 'SPECIAL') return 'Special Bill';
  return getBillPeriodLabel(bill) || 'Maintenance Bill';
}

function getBillKindLabel(billKind?: BillKind) {
  switch (billKind) {
    case 'OPENING_BALANCE':
      return 'Opening Balance';
    case 'SPECIAL':
      return 'Special';
    default:
      return 'Maintenance';
  }
}

function getBillLineItems(bill: MaintenanceBill): MaintenanceBillLineItem[] {
  if (bill.lineItems?.length) return bill.lineItems;
  return [
    { id: `${bill.id}-base`, billId: bill.id, label: 'Base Maintenance', category: 'MAINTENANCE_COMPONENT' as const, amount: bill.baseAmount, sortOrder: 0 },
    { id: `${bill.id}-water`, billId: bill.id, label: 'Water Charge', category: 'MAINTENANCE_COMPONENT' as const, amount: bill.waterCharge, sortOrder: 1 },
    { id: `${bill.id}-parking`, billId: bill.id, label: 'Parking Charge', category: 'MAINTENANCE_COMPONENT' as const, amount: bill.parkingCharge, sortOrder: 2 },
    { id: `${bill.id}-sinking`, billId: bill.id, label: 'Sinking Fund', category: 'MAINTENANCE_COMPONENT' as const, amount: bill.sinkingFund, sortOrder: 3 },
    { id: `${bill.id}-repair`, billId: bill.id, label: 'Repair Fund', category: 'MAINTENANCE_COMPONENT' as const, amount: bill.repairFund, sortOrder: 4 },
    { id: `${bill.id}-other`, billId: bill.id, label: 'Other Charges', category: 'OTHER' as const, amount: bill.otherCharges, sortOrder: 5 },
    { id: `${bill.id}-late`, billId: bill.id, label: 'Late Fee', category: 'OTHER' as const, amount: bill.lateFee, sortOrder: 6 },
  ].filter((item) => item.amount > 0);
}

export default function BillingPage() {
  const [month, setMonth] = useState(currentDate.getMonth() + 1);
  const [year, setYear] = useState(currentDate.getFullYear());
  const [statusFilter, setStatusFilter] = useState<BillingStatusFilter>('ALL');
  const [billKindFilter, setBillKindFilter] = useState<BillingKindFilter>('ALL');
  const [showGenerate, setShowGenerate] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showCustomBilling, setShowCustomBilling] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showBillDetails, setShowBillDetails] = useState(false);
  const [selectedBill, setSelectedBill] = useState<MaintenanceBill | null>(null);
  const [generationResult, setGenerationResult] = useState<BillingGenerationResult | null>(null);
  const [configForm, setConfigForm] = useState<BillingConfigFormState>(buildConfigForm());
  const [customBillingForm, setCustomBillingForm] = useState<CustomBillingFormState>(buildCustomBillingForm());
  const [selectedBillIds, setSelectedBillIds] = useState<string[]>([]);
  const [paymentAmount, setPaymentAmount] = useState('');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const txnStatusCheckRef = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const { user, viewMode } = useAuthStore();
  const ownerViewActive = isOwnerViewActive(user, viewMode);
  const isFinancialAdmin = user?.role === 'SUPER_ADMIN' || (['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER'] as string[]).includes(user?.role || '');
  const residentBillingView = ownerViewActive || user?.role === 'OWNER' || user?.role === 'TENANT';
  const ownerFacingBillingView = residentBillingView;
  const shouldApplyMonthYear = ownerFacingBillingView ? false : isFinancialAdmin && (billKindFilter === 'ALL' || billKindFilter === 'MAINTENANCE');
  const billsBaseKey = ['bills', user?.id || 'anonymous', user?.societyId || 'no-society'];
  const billsQueryKey = [
    ...billsBaseKey,
    ownerViewActive ? 'owner-view' : isFinancialAdmin ? 'admin' : 'resident',
    ownerViewActive ? user?.flat?.id || 'no-flat' : 'role-scope',
    ownerFacingBillingView ? 'ALL' : billKindFilter,
    shouldApplyMonthYear ? month : 'all-months',
    shouldApplyMonthYear ? year : 'all-years',
  ];
  const configBaseKey = ['billing-config', user?.id || 'anonymous', user?.societyId || 'no-society'];

  const billsEndpoint = (() => {
    if (ownerFacingBillingView) {
      return ownerViewActive ? '/billing?ownerView=true' : '/billing';
    }

    if (ownerViewActive) {
      const params = new URLSearchParams({ ownerView: 'true' });
      if (billKindFilter !== 'ALL') params.set('billKind', billKindFilter);
      return `/billing?${params.toString()}`;
    }

    const params = new URLSearchParams();
    if (shouldApplyMonthYear) {
      params.set('month', String(month));
      params.set('year', String(year));
    }
    if (billKindFilter !== 'ALL') {
      params.set('billKind', billKindFilter);
    }

    const query = params.toString();
    return query ? `/billing?${query}` : '/billing';
  })();
  const pendingStatuses = new Set(['PENDING', 'OVERDUE', 'PARTIAL']);

  const { data: bills = [], isLoading } = useQuery<MaintenanceBill[]>({
    queryKey: billsQueryKey,
    queryFn: async () => (await api.get(billsEndpoint)).data,
    enabled: !!user,
  });

  const { data: societySettings } = useQuery<SocietyBillingSettings>({
    queryKey: ['society-settings-billing', user?.societyId || 'no-society'],
    queryFn: async () => (await api.get('/settings/society-settings')).data,
    enabled: !!user,
    retry: false,
  });

  const { data: ownerSummary } = useQuery<OwnerBillingSummary>({
    queryKey: ['owner-billing-summary', user?.id || 'anonymous', user?.societyId || 'no-society', month, year],
    queryFn: async () => (await api.get(`/billing/owner-summary?month=${month}&year=${year}`)).data,
    enabled: !!user && ownerFacingBillingView,
  });

  const { data: flatOptions = [] } = useQuery<FlatOption[]>({
    queryKey: ['flat-options', user?.societyId || 'no-society'],
    queryFn: async () => (await api.get('/flats/options')).data,
    enabled: isFinancialAdmin && !ownerFacingBillingView,
  });

  const scopedBills = ownerFacingBillingView
    ? bills
    : isFinancialAdmin
    ? bills
    : bills.filter((bill) => pendingStatuses.has(bill.status));
  const displayedBills = statusFilter === 'ALL' ? scopedBills : scopedBills.filter((bill) => bill.status === statusFilter);
  const selectableBillIds = displayedBills.filter((bill) => bill.status !== 'PAID').map((bill) => bill.id);
  const selectableBillIdsKey = selectableBillIds.join(',');
  const manualBillSelectionEnabled = societySettings?.manualBillSelection !== false;
  const totalOutstanding = Number((ownerFacingBillingView ? bills : displayedBills).reduce((sum, bill) => sum + Math.max(0, bill.totalAmount - bill.paidAmount), 0).toFixed(2));
  const residentFlatId = bills[0]?.flatId;
  const statusFilterLabel = billingStatusOptions.find((option) => option.value === statusFilter)?.label || 'All Status';
  const billKindFilterLabel = billingKindOptions.find((option) => option.value === billKindFilter)?.label || 'All Bills';
  const billingDescription = ownerFacingBillingView
    ? 'Review monthly dues, payment history, and the amount currently payable.'
    : 'Track maintenance generation, collections, and pending balances across the society.';
  const attachableBills = bills.filter((bill) => bill.billKind !== 'OPENING_BALANCE');

  useEffect(() => {
    const selectable = new Set(selectableBillIds);
    setSelectedBillIds((prev) => {
      const next = prev.filter((id) => selectable.has(id));
      if (next.length === prev.length && next.every((id, idx) => id === prev[idx])) {
        return prev;
      }
      return next;
    });
  }, [selectableBillIdsKey]);

  const toggleBillSelection = (billId: string, checked: boolean) => {
    setSelectedBillIds((prev) => {
      if (checked) return prev.includes(billId) ? prev : [...prev, billId];
      return prev.filter((id) => id !== billId);
    });
  };

  const toggleSelectAll = (checked: boolean) => {
    setSelectedBillIds(checked ? selectableBillIds : []);
  };

  const { data: configSummary, isLoading: isConfigLoading } = useQuery<MaintenanceConfigSummary>({
    queryKey: configBaseKey,
    queryFn: async () => (await api.get('/billing/config/summary')).data,
    enabled: isFinancialAdmin,
  });

  const openConfigModal = () => {
    setConfigForm(buildConfigForm(configSummary));
    setShowConfig(true);
  };

  const openCustomBillingModal = (mode: CustomBillingMode = 'OPENING_BALANCE') => {
    setCustomBillingForm(buildCustomBillingForm(mode));
    setShowCustomBilling(true);
  };

  const configMutation = useMutation({
    mutationFn: (data: BillingConfigFormState) => api.post('/billing/config', { ...normalizeBillingConfigForm(data), societyId: user?.societyId }),
    onSuccess: () => {
      toast.success('Monthly maintenance settings saved');
      queryClient.invalidateQueries({ queryKey: configBaseKey });
      setShowConfig(false);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save maintenance settings'),
  });

  const customBillingMutation = useMutation({
    mutationFn: (form: CustomBillingFormState) => {
      const payload: Record<string, unknown> = {
        mode: form.mode,
        amount: Number(form.amount),
        flatId: form.flatId,
        title: form.title || undefined,
        description: form.description || undefined,
        notes: form.notes || undefined,
      };

      return api.post('/billing/custom', payload);
    },
    onSuccess: () => {
      toast.success('Custom billing saved');
      queryClient.invalidateQueries({ queryKey: billsBaseKey });
      queryClient.invalidateQueries({ queryKey: ['owner-billing-summary'] });
      setShowCustomBilling(false);
      setCustomBillingForm(buildCustomBillingForm());
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save custom billing'),
  });

  const generateMutation = useMutation({
    mutationFn: (data: { societyId: string; month: number; year: number }) => api.post('/billing/generate', data),
    onSuccess: (res) => {
      const result = res.data as BillingGenerationResult;
      setGenerationResult(result);
      toast.success(result.message || `Generated ${result.generatedCount} bills`);
      if (result.errors?.length) {
        toast.error(`Skipped ${result.errors.length} flats. Review the details below.`);
      }
      queryClient.invalidateQueries({ queryKey: billsBaseKey });
      setShowGenerate(false);
    },
    onError: (e: any) => {
      const result = e.response?.data as BillingGenerationResult | undefined;
      if (result) {
        setGenerationResult(result);
      }
      toast.error(result?.error || 'Failed to generate bills');
    },
  });

  const reminderMutation = useMutation({
    mutationFn: () => api.post('/notifications/maintenance-reminders/send', { dueInDays: 3 }),
    onSuccess: (res) => {
      const billCount = res.data?.billCount || 0;
      const pushCount = res.data?.sentCount || 0;
      const emailCount = res.data?.emailSentCount || 0;

      toast.success(
        billCount > 0
          ? `Payment reminders sent: ${emailCount} email(s), ${pushCount} push notification(s)`
          : 'No pending payment reminders were due'
      );
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to send payment reminders'),
  });

  const totalBilled = displayedBills.reduce((s, b) => s + b.totalAmount, 0);
  const totalCollected = displayedBills.reduce((s, b) => s + b.paidAmount, 0);
  const paidCount = displayedBills.filter((b) => b.status === 'PAID').length;
  const pendingCount = displayedBills.filter((b) => b.status === 'PENDING' || b.status === 'OVERDUE' || b.status === 'PARTIAL').length;
  const canGenerateBills = !!user?.societyId && !!configSummary?.isConfigured;

  const txnId = searchParams.get('txnId');

  const confirmPhonePeStatus = async (paymentRef: string, updateUrl: boolean) => {
    const maxAttempts = 10;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { data } = await api.get(`/payments/status/${paymentRef}`);
        const status = data?.status;

        if (status === 'SUCCESS') {
          toast.success('Payment successful. Bill status updated.');
          queryClient.invalidateQueries({ queryKey: billsBaseKey });

          if (updateUrl) {
            const nextParams = new URLSearchParams(window.location.search);
            nextParams.delete('txnId');
            nextParams.set('payment', 'success');
            setSearchParams(nextParams, { replace: true });
          }

          return 'SUCCESS';
        }

        if (status === 'FAILED') {
          toast.error('Payment failed. Please try again.');

          if (updateUrl) {
            const nextParams = new URLSearchParams(window.location.search);
            nextParams.delete('txnId');
            nextParams.set('payment', 'failed');
            setSearchParams(nextParams, { replace: true });
          }

          return 'FAILED';
        }
      } catch (error: any) {
        if (attempt === maxAttempts) {
          toast.error(error.response?.data?.error || 'Unable to confirm payment status right now');
        }
      }

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    return 'PENDING';
  };

  const handleNativePhonePeCheckout = async (payload: any) => {
    const merchantId = payload?.sdkContext?.merchantId;
    const environment = payload?.sdkContext?.environment === 'PRODUCTION' ? 'RELEASE' : 'SANDBOX';

    if (!merchantId || !payload?.orderId || !payload?.token || !payload?.merchantTransId) {
      toast.error('PhonePe SDK order details are incomplete');
      return;
    }

    try {
      console.info('[PhonePe] init SDK', { merchantId, environment, orderId: payload.orderId, merchantTransId: payload.merchantTransId });

      await initPhonePeSdk({
        merchantId,
        flowId: payload.merchantTransId,
        environment,
        enableLogging: environment !== 'RELEASE',
        appId: null,
      });

      console.info('[PhonePe] starting checkout', { orderId: payload.orderId });

      const result = await startPhonePeCheckout({
        orderId: payload.orderId,
        token: payload.token,
      });

      console.info('[PhonePe] checkout result', {
        ok: result?.ok,
        state: result?.state,
        resultCode: result?.resultCode,
        transactionId: result?.transactionId,
      });

      if (!result?.ok) {
        console.warn('[PhonePe] checkout not ok — state:', result?.state);
        toast.error('Payment was not completed. Please try again.');
        return;
      }

      // Primary path: call sdk-confirm which trusts the SDK result and handles sandbox delays
      console.info('[PhonePe] calling sdk-confirm', { merchantTransId: payload.merchantTransId, transactionId: result.transactionId, state: result.state });
      try {
        const { data: confirmData } = await api.post('/payments/phonepe/sdk-confirm', {
          merchantTransId: payload.merchantTransId,
          transactionId: result.transactionId,
          state: result.state,
        });
        console.info('[PhonePe] sdk-confirm response', confirmData);

        if (confirmData?.status === 'SUCCESS') {
          toast.success('Payment successful. Bill status updated.');
          queryClient.invalidateQueries({ queryKey: billsBaseKey });
          return;
        }
      } catch (confirmErr: any) {
        const errStatus = confirmErr?.response?.status;
        const errData = confirmErr?.response?.data;
        console.error('[PhonePe] sdk-confirm error', { status: errStatus, data: errData });

        // If PhonePe explicitly said FAILED, don't fall through to polling
        if (errStatus === 400 && errData?.status === 'FAILED') {
          toast.error('Payment failed according to PhonePe. Please contact support.');
          return;
        }
      }

      // Fallback: poll status endpoint if sdk-confirm had a network/server error
      console.info('[PhonePe] falling back to status polling');
      await confirmPhonePeStatus(payload.merchantTransId, false);
    } catch (err: any) {
      console.error('[PhonePe] native checkout error', err);
      toast.error(err?.message || 'PhonePe payment failed. Please try again.');
    }
  };

  const handlePhonePePay = async (billId: string) => {
    try {
      const { data } = await api.post('/payments/phonepe/initiate', {
        billId,
        nativeSdk: isNativeAndroid() || isNativeIos(),
      });

      if (data?.nativeSdk) {
        // Native checkout handles its own errors and toasts internally
        await handleNativePhonePeCheckout(data);
        return;
      }

      if (data?.redirectUrl) {
        window.location.href = data.redirectUrl;
        return;
      }

      toast.error('Failed to get payment URL');
    } catch (error: any) {
      // Only catches server-side initiation errors, not native plugin errors
      const msg = error.response?.data?.error;
      console.error('[PhonePe] initiate error', { status: error.response?.status, msg, raw: error.message });
      toast.error(msg || error.message || 'Payment initiation failed');
    }
  };

  const handlePhonePeBulkPay = async (billIds: string[]) => {
    try {
      if (billIds.length < 2) {
        toast.error('Select at least 2 bills for bulk payment');
        return;
      }

      const { data } = await api.post('/payments/phonepe/initiate-bulk', {
        billIds,
        nativeSdk: isNativeAndroid() || isNativeIos(),
      });

      if (data?.nativeSdk) {
        // Native checkout handles its own errors and toasts internally
        await handleNativePhonePeCheckout(data);
        return;
      }

      if (data?.redirectUrl) {
        window.location.href = data.redirectUrl;
        return;
      }

      toast.error('Failed to get bulk payment URL');
    } catch (error: any) {
      // Only catches server-side initiation errors, not native plugin errors
      const msg = error.response?.data?.error;
      console.error('[PhonePe] bulk initiate error', { status: error.response?.status, msg, raw: error.message });
      toast.error(msg || error.message || 'Bulk payment initiation failed');
    }
  };

  const handlePhonePeAmountPay = async () => {
    try {
      const amount = Number(paymentAmount);
      if (!residentFlatId) {
        toast.error('No payable flat found for this account');
        return;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        toast.error('Enter a valid amount');
        return;
      }

      const { data } = await api.post('/payments/phonepe/initiate-amount', {
        flatId: residentFlatId,
        amount,
        nativeSdk: isNativeAndroid() || isNativeIos(),
      });

      if (data?.nativeSdk) {
        await handleNativePhonePeCheckout(data);
        return;
      }

      if (data?.redirectUrl) {
        window.location.href = data.redirectUrl;
        return;
      }

      toast.error('Failed to get payment URL');
    } catch (error: any) {
      const msg = error.response?.data?.error;
      console.error('[PhonePe] amount initiate error', { status: error.response?.status, msg, raw: error.message });
      toast.error(msg || error.message || 'Payment initiation failed');
    }
  };

  useEffect(() => {
    if (!txnId || txnStatusCheckRef.current === txnId) return;

    txnStatusCheckRef.current = txnId;
    let isCancelled = false;

    const checkStatus = async () => {
      if (!isCancelled) {
        await confirmPhonePeStatus(txnId, true);
      }
    };

    checkStatus();

    return () => {
      isCancelled = true;
    };
  }, [txnId, queryClient, setSearchParams]);

  if (isLoading || (isFinancialAdmin && isConfigLoading)) return <PageLoader />;

  return (
    <div className="space-y-6 md:space-y-7">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[2rem] font-bold tracking-tight text-on-surface">Billing</h1>
          <p className="mt-1 max-w-2xl text-sm text-on-surface-variant">{billingDescription}</p>
        </div>

        <div className="flex flex-wrap gap-3 lg:justify-end">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-800"
            onClick={() => navigate(ownerViewActive ? '/payments/history?ownerView=true' : '/payments/history')}
          >
            <History className="h-4 w-4" />
            History
          </button>
          {isFinancialAdmin && !ownerViewActive ? (
            <>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                onClick={() => openCustomBillingModal('OPENING_BALANCE')}
              >
                <Plus className="h-4 w-4" />
                Add Bill
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg border border-blue-600 bg-white px-4 py-2 text-sm font-semibold text-blue-600 transition-colors hover:bg-blue-50"
                onClick={() => navigate('/payments/report')}
              >
                <FileBarChart2 className="h-4 w-4" />
                Report
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                onClick={() => reminderMutation.mutate()}
                disabled={reminderMutation.isPending}
              >
                <BellRing className="h-4 w-4" />
                {reminderMutation.isPending ? 'Sending...' : 'Remind'}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => setShowGenerate(true)}
                disabled={!canGenerateBills}
              >
                <Plus className="h-4 w-4" />
                Generate
              </button>
            </>
          ) : null}
        </div>
      </section>

      {isFinancialAdmin && !ownerViewActive ? (
        <section className="rounded-[1.25rem] border border-outline-variant/60 bg-surface-container-lowest p-4 shadow-[0_4px_14px_rgba(15,23,42,0.03)] md:p-5">
          {configSummary?.isConfigured ? (
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Monthly Maintenance</p>
                <p className="mt-1 text-sm text-on-surface-variant">Global rate applied across all flat types in this society.</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[520px] lg:flex-1">
                <div className="rounded-xl border border-outline-variant/50 bg-surface-container-low px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Monthly Total</p>
                  <p className="mt-1 text-xl font-bold text-primary">{formatCurrency(configSummary.totalMonthlyAmount)}</p>
                </div>
                <div className="rounded-xl border border-outline-variant/50 bg-surface-container-low px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Base Amount</p>
                  <p className="mt-1 text-lg font-semibold text-on-surface">{formatCurrency(configSummary.baseAmount)}</p>
                </div>
                <div className="rounded-xl border border-outline-variant/50 bg-surface-container-low px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant">Due Day</p>
                  <p className="mt-1 text-lg font-semibold text-on-surface">{societySettings?.dueDay ?? 10}th of every month</p>
                </div>
              </div>

              <button
                type="button"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 lg:self-start"
                onClick={openConfigModal}
              >
                Configure
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Monthly Maintenance</p>
                <p className="mt-1 text-sm text-on-surface-variant">Set the monthly maintenance amount before generating bills.</p>
              </div>
              <button
                type="button"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                onClick={openConfigModal}
              >
                Configure
              </button>
            </div>
          )}

          {generationResult ? (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-outline-variant/40 pt-3 text-sm">
              <p className="font-semibold text-on-surface">{generationResult.error || generationResult.message || 'Generation result'}</p>
              <p className="text-on-surface-variant">
                Generated {generationResult.generatedCount} of {generationResult.totalFlats} eligible bills.
              </p>
              {generationResult.errors?.length ? <p className="text-xs text-error">{generationResult.errors.length} issue(s) need review.</p> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {ownerFacingBillingView ? (
          <>
            <div className="rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-4 shadow-[0_6px_16px_rgba(15,23,42,0.03)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-on-surface-variant">Total Outstanding</p>
              <p className="mt-2 text-xl font-bold text-primary sm:text-2xl">{formatCurrency(ownerSummary?.outstandingAmount || 0)}</p>
            </div>
            <div className="rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-4 shadow-[0_6px_16px_rgba(15,23,42,0.03)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-on-surface-variant">Advance Balance</p>
              <p className="mt-2 text-xl font-bold text-emerald-700 sm:text-2xl">{formatCurrency(ownerSummary?.advanceAmount || 0)}</p>
            </div>
            <div className="rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-4 shadow-[0_6px_16px_rgba(15,23,42,0.03)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-on-surface-variant">{getMonthName(month)} Due</p>
              <p className="mt-2 text-xl font-bold text-warning sm:text-2xl">{formatCurrency(ownerSummary?.monthDueAmount || 0)}</p>
            </div>
            <div className="rounded-2xl border border-error/30 bg-surface-container-lowest p-4 shadow-[0_6px_16px_rgba(15,23,42,0.03)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-on-surface-variant">Amount To Pay</p>
              <p className="mt-2 text-xl font-bold text-error sm:text-2xl">{formatCurrency(ownerSummary?.netPayableAmount || 0)}</p>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-2xl border-l-4 border-l-primary border border-outline-variant/60 bg-surface-container-lowest p-4 shadow-[0_6px_16px_rgba(15,23,42,0.03)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-on-surface-variant">Total Billed</p>
              <p className="mt-2 text-xl font-bold text-primary sm:text-2xl">{formatCurrency(totalBilled)}</p>
            </div>
            <div className="rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-4 shadow-[0_6px_16px_rgba(15,23,42,0.03)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-on-surface-variant">Collected</p>
              <p className="mt-2 text-xl font-bold text-emerald-700 sm:text-2xl">{formatCurrency(totalCollected)}</p>
            </div>
            <div className="rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-4 shadow-[0_6px_16px_rgba(15,23,42,0.03)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-on-surface-variant">Paid</p>
              <p className="mt-2 text-xl font-bold text-on-surface sm:text-2xl">{paidCount} flats</p>
            </div>
            <div className="rounded-2xl border-l-4 border-l-error border border-outline-variant/60 bg-surface-container-lowest p-4 shadow-[0_6px_16px_rgba(15,23,42,0.03)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-on-surface-variant">Pending</p>
              <p className="mt-2 text-xl font-bold text-error sm:text-2xl">{pendingCount} flats</p>
            </div>
          </>
        )}
      </section>

      <section className="overflow-hidden rounded-[1.5rem] border border-outline-variant/70 bg-surface-container-lowest shadow-[0_8px_24px_rgba(15,23,42,0.03)]">
        <div className="flex flex-col gap-4 border-b border-outline-variant/60 bg-surface-container-low/60 p-4 md:flex-row md:items-center md:justify-between md:px-5">
          <div className="flex flex-wrap items-center gap-2">
            {!ownerFacingBillingView ? (
              <>
                <select className="select w-36 rounded-xl bg-surface-container-lowest text-sm" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                  {Array.from({ length: 12 }, (_, index) => (
                    <option key={index + 1} value={index + 1}>{getMonthName(index + 1)}</option>
                  ))}
                </select>
                <select className="select w-24 rounded-xl bg-surface-container-lowest text-sm" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                  {yearOptions.map((optionYear) => (
                    <option key={optionYear} value={optionYear}>{optionYear}</option>
                  ))}
                </select>
              </>
            ) : null}
            {!ownerFacingBillingView ? (
              <select className="select w-44 rounded-xl bg-surface-container-lowest text-sm" value={billKindFilter} onChange={(e) => setBillKindFilter(e.target.value as BillingKindFilter)}>
                {billingKindOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            ) : null}
            <select className="select w-36 rounded-xl bg-surface-container-lowest text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as BillingStatusFilter)}>
              {billingStatusOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          {ownerFacingBillingView ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="input w-44 rounded-xl bg-surface-container-lowest"
                type="number"
                min={1}
                step="0.01"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                placeholder={`Pay up to ${formatCurrency(totalOutstanding)}`}
              />
              <button className="btn-primary text-xs px-3 py-2" onClick={handlePhonePeAmountPay}>
                <CreditCard className="h-4 w-4" /> Pay Amount
              </button>
            </div>
          ) : (
            <p className="text-sm text-on-surface-variant">
              Showing {displayedBills.length} bill{displayedBills.length === 1 ? '' : 's'}
              {shouldApplyMonthYear ? ` for ${getMonthName(month)} ${year}` : ` in ${billKindFilterLabel}`}
            </p>
          )}
        </div>

        {displayedBills.length === 0 ? (
          <div className="p-5 md:p-6">
            <EmptyState
              icon={Receipt}
              title="No bills found"
              description={
                ownerFacingBillingView
                  ? `No ${statusFilterLabel.toLowerCase()} bills found for this account.`
                  : shouldApplyMonthYear
                  ? `No ${statusFilterLabel.toLowerCase()} bills for ${getMonthName(month)} ${year}.`
                  : `No ${statusFilterLabel.toLowerCase()} ${billKindFilterLabel.toLowerCase()} found.`
              }
              action={isFinancialAdmin && !ownerViewActive ? (
                <button className="btn-primary" onClick={() => (canGenerateBills ? setShowGenerate(true) : openConfigModal())}>
                  {canGenerateBills ? 'Generate Bills' : 'Set Maintenance Amount'}
                </button>
              ) : undefined}
            />
          </div>
        ) : (
          <>
            <div className="space-y-3 p-4 sm:hidden">
              {displayedBills.map((bill) => {
                const activeOwner = bill.flat?.owner?.isActive === false ? null : bill.flat?.owner;
                return (
                  <div key={bill.id} className="overflow-hidden rounded-2xl border border-outline-variant/60 bg-surface-container-lowest">
                    <div className="flex items-start justify-between gap-3 px-4 py-4">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-on-surface">
                          {ownerFacingBillingView ? getBillDisplayTitle(bill) : <>{bill.flat?.flatNumber}<span className="ml-1 text-xs font-normal text-on-surface-variant">{bill.flat?.block?.name}</span></>}
                        </p>
                        <p className="mt-1 text-xs text-on-surface-variant">
                          {ownerFacingBillingView
                            ? `${getBillPeriodLabel(bill) ? `${getBillPeriodLabel(bill)} · ` : ''}Due ${formatDate(bill.dueDate)}`
                            : `${activeOwner?.name || '—'}${getBillPeriodLabel(bill) ? ` · ${getBillPeriodLabel(bill)}` : ''}`}
                        </p>
                        <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-outline">{getBillKindLabel(bill.billKind)}</p>
                      </div>
                      <span className={cn('badge shrink-0', getStatusColor(bill.status))}>{bill.status}</span>
                    </div>

                    <div className="grid grid-cols-3 gap-3 border-t border-outline-variant/40 bg-surface-container-low/50 px-4 py-3 text-xs">
                      <div>
                        <span className="block text-outline">Total</span>
                        <span className="font-semibold text-on-surface">{formatCurrency(bill.totalAmount)}</span>
                      </div>
                      <div>
                        <span className="block text-outline">Paid</span>
                        <span className="font-semibold text-emerald-700">{formatCurrency(bill.paidAmount)}</span>
                      </div>
                      <div>
                        <span className="block text-outline">Due</span>
                        <span className="font-semibold text-error">{formatCurrency(bill.totalAmount - bill.paidAmount)}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 px-4 py-3">
                      <button
                        className="btn-sm btn-secondary"
                        onClick={() => { setSelectedBill(bill); setShowBillDetails(true); }}
                      >
                        View
                      </button>
                      {bill.status !== 'PAID' ? (
                        <>
                          {!ownerFacingBillingView && isFinancialAdmin ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-600"
                              onClick={() => { setSelectedBill(bill); setShowPayment(true); }}
                            >
                              <Banknote className="h-3 w-3" /> Record
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800"
                            onClick={() => handlePhonePePay(bill.id)}
                          >
                            <CreditCard className="h-3 w-3" /> Pay
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="table-container hidden rounded-none bg-transparent shadow-none sm:block">
              <table className="min-w-[980px]">
                <thead>
                  <tr>
                    <th>Month</th>
                    {!ownerFacingBillingView ? <th>Flat</th> : null}
                    {!ownerFacingBillingView ? <th>Owner</th> : null}
                    {ownerFacingBillingView ? <th>Due Date</th> : null}
                    <th>Total</th>
                    <th>Paid</th>
                    <th>Balance</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedBills.map((bill) => {
                    const activeOwner = bill.flat?.owner?.isActive === false ? null : bill.flat?.owner;
                    return (
                      <tr key={bill.id}>
                        <td>
                          <div>
                            <p className="whitespace-nowrap text-sm font-medium text-on-surface">{getBillDisplayTitle(bill)}</p>
                            {getBillPeriodLabel(bill) ? <p className="text-xs text-on-surface-variant">{getBillPeriodLabel(bill)}</p> : null}
                            {ownerFacingBillingView ? <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-outline">{getBillKindLabel(bill.billKind)}</p> : null}
                          </div>
                        </td>
                        {!ownerFacingBillingView ? (
                          <td>
                            <div>
                              <p className="font-medium text-primary">{bill.flat?.flatNumber}</p>
                              <p className="text-xs text-on-surface-variant">{bill.flat?.block?.name}</p>
                              <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-outline">{getBillKindLabel(bill.billKind)}</p>
                            </div>
                          </td>
                        ) : null}
                        {!ownerFacingBillingView ? (
                          <td>
                            <p className="text-sm text-on-surface">{activeOwner?.name || '-'}</p>
                            <p className="text-xs text-on-surface-variant">{activeOwner?.phone}</p>
                          </td>
                        ) : null}
                        {ownerFacingBillingView ? <td className="whitespace-nowrap text-sm text-on-surface">{formatDate(bill.dueDate)}</td> : null}
                        <td className="whitespace-nowrap font-medium text-on-surface">{formatCurrency(bill.totalAmount)}</td>
                        <td className="whitespace-nowrap font-medium text-emerald-700">{formatCurrency(bill.paidAmount)}</td>
                        <td className="whitespace-nowrap font-medium text-error">{formatCurrency(bill.totalAmount - bill.paidAmount)}</td>
                        <td><span className={cn('badge', getStatusColor(bill.status))}>{bill.status}</span></td>
                        <td>
                          <div className="flex min-w-[220px] gap-2">
                            <button
                              className="btn-sm btn-outline"
                              onClick={() => { setSelectedBill(bill); setShowBillDetails(true); }}
                            >
                              View
                            </button>
                            {bill.status !== 'PAID' ? (
                              <>
                                {!ownerFacingBillingView && isFinancialAdmin ? (
                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-600"
                                    onClick={() => { setSelectedBill(bill); setShowPayment(true); }}
                                  >
                                    <Banknote className="h-3 w-3" /> Record
                                  </button>
                                ) : null}
                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800"
                                    onClick={() => handlePhonePePay(bill.id)}
                                  >
                                  <CreditCard className="h-3 w-3" /> {ownerFacingBillingView ? 'Pay' : 'PhonePe'}
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Generate Bills Modal */}
      <Modal isOpen={showGenerate} onClose={() => setShowGenerate(false)} title="Generate Monthly Bills">
        <div className="space-y-4">
          <p className="text-sm text-on-surface-variant">
            This will generate maintenance bills for all occupied flats based on the configured rates.
          </p>
          {!canGenerateBills ? (
            <div className="rounded-xl border border-warning/20 bg-warning-container p-4 text-sm text-on-warning-container">
              Set the monthly maintenance amount before generating bills.
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Month</label>
              <select className="select" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>{getMonthName(i + 1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Year</label>
              <select className="select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button className="btn-secondary" onClick={() => setShowGenerate(false)}>Cancel</button>
            <button
              className="btn-primary"
              onClick={() => {
                if (!user?.societyId) {
                  toast.error('Society information is missing for this account.');
                  return;
                }
                if (!canGenerateBills) {
                  toast.error('Set the monthly maintenance amount before generating bills.');
                  return;
                }
                generateMutation.mutate({ societyId: user.societyId, month, year });
              }}
              disabled={generateMutation.isPending || !canGenerateBills}
            >
              {generateMutation.isPending ? 'Generating...' : 'Generate Bills'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showConfig} onClose={() => setShowConfig(false)} title="Set Monthly Maintenance Amount">
        <ConfigureBillingForm
          value={configForm}
          showLateFeeFields={societySettings?.lateFeeEnabled !== false}
          lateFeeMode={societySettings?.lateFeeMode ?? 'PER_DAY'}
          recurringLateFeeFrequency={societySettings?.recurringLateFeeFrequency ?? 'MONTHLY'}
          onChange={setConfigForm}
          onSubmit={() => configMutation.mutate(configForm)}
          isPending={configMutation.isPending}
        />
      </Modal>

      <Modal isOpen={showCustomBilling} onClose={() => setShowCustomBilling(false)} title="Add Flat Billing">
        <UnifiedBillingForm
          value={customBillingForm}
          flats={flatOptions}
          onChange={setCustomBillingForm}
          onSubmit={() => customBillingMutation.mutate(customBillingForm)}
          isPending={customBillingMutation.isPending}
        />
      </Modal>

      {/* Record Payment Modal */}
      <Modal isOpen={showPayment} onClose={() => setShowPayment(false)} title="Record Payment">
        {selectedBill && (
          <RecordPaymentForm
            bill={selectedBill}
            onSuccess={() => { setShowPayment(false); queryClient.invalidateQueries({ queryKey: billsBaseKey }); }}
          />
        )}
      </Modal>

      <Modal isOpen={showBillDetails} onClose={() => setShowBillDetails(false)} title="Bill Details">
        {selectedBill ? <BillDetailsContent bill={selectedBill} /> : null}
      </Modal>
    </div>
  );
}

function BillDetailsContent({ bill }: { bill: MaintenanceBill }) {
  const balance = Math.max(0, bill.totalAmount - bill.paidAmount);
  const chargeItems = getBillLineItems(bill);

  const chargeSubtotal = chargeItems.reduce((sum, item) => sum + item.amount, 0);
  const billPeriod = getBillPeriodLabel(bill);

  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-xl bg-surface-container-low p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-on-surface">{getBillDisplayTitle(bill)}</p>
            <p className="text-on-surface-variant">{billPeriod ? `${billPeriod} · ` : ''}Due {formatDate(bill.dueDate)}</p>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-outline">{getBillKindLabel(bill.billKind)}</p>
          </div>
          <span className={cn('badge', getStatusColor(bill.status))}>{bill.status}</span>
        </div>
      </div>

      <div className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">Bill Charges</p>
        <div className="mt-3 space-y-2">
          {chargeItems.map((item) => (
            <SummaryRow key={item.label} label={item.label} value={formatCurrency(item.amount)} />
          ))}
        </div>
        {chargeItems.length > 1 ? (
          <div className="mt-3 border-t border-outline-variant/10 pt-3">
            <SummaryRow label="Charges Total" value={formatCurrency(chargeSubtotal)} emphasized />
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">Payment Summary</p>
        <div className="mt-3 space-y-2">
          <SummaryRow label="Total Amount" value={formatCurrency(bill.totalAmount)} emphasized />
          <SummaryRow label="Paid Amount" value={formatCurrency(bill.paidAmount)} />
          <SummaryRow label="Balance Due" value={formatCurrency(balance)} emphasized />
        </div>
      </div>
    </div>
  );
}

function UnifiedBillingForm({
  value,
  flats,
  onChange,
  onSubmit,
  isPending,
}: {
  value: CustomBillingFormState;
  flats: FlatOption[];
  onChange: (value: CustomBillingFormState) => void;
  onSubmit: () => void;
  isPending: boolean;
}) {
  const openingBalanceMode = value.mode === 'OPENING_BALANCE';

  const setField = <K extends keyof CustomBillingFormState>(field: K, fieldValue: CustomBillingFormState[K]) => {
    if (field === 'mode') {
      const nextMode = fieldValue as CustomBillingMode;
      const nextForm = buildCustomBillingForm(nextMode);
      nextForm.flatId = value.flatId;
      onChange(nextForm);
      return;
    }

    onChange({ ...value, [field]: fieldValue });
  };

  const handleSubmit = () => {
    if (!value.flatId) {
      toast.error('Select a flat');
      return;
    }
    if (!value.amount || Number(value.amount) <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    onSubmit();
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="label">Billing Mode</label>
        <select className="select" value={value.mode} onChange={(e) => setField('mode', e.target.value as CustomBillingMode)}>
          {customBillingModeOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="label">Flat</label>
        <select className="select" value={value.flatId} onChange={(e) => setField('flatId', e.target.value)}>
          <option value="">Select flat</option>
          {flats.map((flat) => (
            <option key={flat.id} value={flat.id}>{`${flat.blockName} • ${flat.flatNumber}${flat.residentName ? ` • ${flat.residentName}` : ''}`}</option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Title</label>
          <input className="input" value={value.title} onChange={(e) => setField('title', e.target.value)} placeholder={openingBalanceMode ? 'Opening Balance' : 'Special Bill Title'} />
        </div>
        <div>
          <label className="label">Amount</label>
          <input className="input" type="number" min={1} step="0.01" value={value.amount} onChange={(e) => setField('amount', e.target.value)} placeholder="0.00" />
        </div>
      </div>

      <div>
        <label className="label">Description</label>
        <input className="input" value={value.description} onChange={(e) => setField('description', e.target.value)} placeholder="Short description for residents and admins" />
      </div>

      <div>
        <label className="label">Notes</label>
        <textarea className="input min-h-[96px]" value={value.notes} onChange={(e) => setField('notes', e.target.value)} placeholder="Internal notes or migration reference" />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button className="btn-secondary" type="button" disabled={isPending} onClick={handleSubmit}>
          {isPending ? 'Saving...' : 'Save Billing'}
        </button>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-sm text-on-surface-variant">{label}</p>
      <p className={cn('text-right text-on-surface', emphasized ? 'font-semibold' : 'font-medium')}>{value}</p>
    </div>
  );
}

function ConfigureBillingForm({
  value,
  showLateFeeFields,
  lateFeeMode,
  recurringLateFeeFrequency,
  onChange,
  onSubmit,
  isPending,
}: {
  value: BillingConfigFormState;
  showLateFeeFields: boolean;
  lateFeeMode: SocietyBillingSettings['lateFeeMode'];
  recurringLateFeeFrequency: SocietyBillingSettings['recurringLateFeeFrequency'];
  onChange: (value: BillingConfigFormState) => void;
  onSubmit: () => void;
  isPending: boolean;
}) {
  const totalMonthlyAmount =
    Number(value.baseAmount || 0) +
    Number(value.waterCharge || 0) +
    Number(value.parkingCharge || 0) +
    Number(value.sinkingFund || 0) +
    Number(value.repairFund || 0) +
    Number(value.otherCharges || 0);

  const updateNumberField = (field: keyof BillingConfigFormState, rawValue: string) => {
    onChange({ ...value, [field]: rawValue === '' ? '' : Number(rawValue) });
  };

  const lateFeeTypeLabel = lateFeeMode === 'ONE_TIME_PER_BILL'
    ? 'One-Time Per Bill'
    : lateFeeMode === 'RECURRING'
      ? `Recurring Late Fee (${recurringLateFeeFrequency === 'DAILY' ? 'Daily' : 'Monthly'})`
      : 'Per Day';

  const lateFeeAmountLabel = lateFeeMode === 'ONE_TIME_PER_BILL'
    ? 'One-Time Late Fee Amount'
    : lateFeeMode === 'RECURRING'
      ? recurringLateFeeFrequency === 'DAILY'
        ? 'Recurring Late Fee Per Day'
        : 'Recurring Late Fee Per Month'
      : 'Late Fee Per Day';

  const lateFeeField: keyof BillingConfigFormState = lateFeeMode === 'ONE_TIME_PER_BILL'
    ? 'lateFeeAmount'
    : lateFeeMode === 'RECURRING'
      ? 'recurringLateFeeAmount'
      : 'lateFeePerDay';

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="space-y-4"
    >
      <div className="rounded-xl bg-surface-container-low p-4">
        <p className="text-sm font-medium text-on-surface">Total monthly bill per flat</p>
        <p className="mt-2 text-2xl font-semibold text-on-surface">{formatCurrency(totalMonthlyAmount)}</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Base Maintenance Amount</label>
          <input type="number" min={0} className="input" value={value.baseAmount} onChange={(e) => updateNumberField('baseAmount', e.target.value)} required />
        </div>
        <div>
          <label className="label">Water Charge</label>
          <input type="number" min={0} className="input" value={value.waterCharge} onChange={(e) => updateNumberField('waterCharge', e.target.value)} />
        </div>
        <div>
          <label className="label">Parking Charge</label>
          <input type="number" min={0} className="input" value={value.parkingCharge} onChange={(e) => updateNumberField('parkingCharge', e.target.value)} />
        </div>
        <div>
          <label className="label">Sinking Fund</label>
          <input type="number" min={0} className="input" value={value.sinkingFund} onChange={(e) => updateNumberField('sinkingFund', e.target.value)} />
        </div>
        <div>
          <label className="label">Repair Fund</label>
          <input type="number" min={0} className="input" value={value.repairFund} onChange={(e) => updateNumberField('repairFund', e.target.value)} />
        </div>
        <div>
          <label className="label">Other Charges</label>
          <input type="number" min={0} className="input" value={value.otherCharges} onChange={(e) => updateNumberField('otherCharges', e.target.value)} />
        </div>
        {showLateFeeFields ? (
          <>
            <div>
              <label className="label">Late Fee Type</label>
              <input className="input" value={lateFeeTypeLabel} disabled />
            </div>
            <div>
              <label className="label">{lateFeeAmountLabel}</label>
              <input
                type="number"
                min={0}
                className="input"
                value={value[lateFeeField]}
                onChange={(e) => updateNumberField(lateFeeField, e.target.value)}
              />
            </div>
          </>
        ) : null}
      </div>

      <div className="flex justify-end gap-3 pt-4">
        <button type="submit" className="btn-primary" disabled={isPending}>
          {isPending ? 'Saving...' : 'Save Amount'}
        </button>
      </div>
    </form>
  );
}

function RecordPaymentForm({ bill, onSuccess }: { bill: MaintenanceBill; onSuccess: () => void }) {
  const [amount, setAmount] = useState(String(bill.totalAmount - bill.paidAmount));
  const [method, setMethod] = useState('CASH');
  const [receiptNo, setReceiptNo] = useState('');

  const mutation = useMutation({
    mutationFn: (data: any) => api.post(`/billing/${bill.id}/pay`, data),
    onSuccess: () => { toast.success('Payment recorded!'); onSuccess(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); mutation.mutate({ amount: Number(amount), method, receiptNo }); }}
      className="space-y-4"
    >
      <div className="p-3 bg-surface-container-low rounded-lg text-sm">
        <p><strong>Flat:</strong> {bill.flat?.flatNumber}</p>
        <p><strong>Total:</strong> {formatCurrency(bill.totalAmount)} | <strong>Paid:</strong> {formatCurrency(bill.paidAmount)} | <strong>Due:</strong> {formatCurrency(bill.totalAmount - bill.paidAmount)}</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Amount</label>
          <input type="number" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} min={1} max={bill.totalAmount - bill.paidAmount} required />
        </div>
        <div>
          <label className="label">Method</label>
          <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="CASH">Cash</option>
            <option value="CHEQUE">Cheque</option>
            <option value="BANK_TRANSFER">Bank Transfer</option>
            <option value="UPI_OTHER">UPI (Other)</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">Receipt No (Optional)</label>
          <input className="input" value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-3 pt-4">
        <button type="submit" className="btn-success" disabled={mutation.isPending}>
          {mutation.isPending ? 'Recording...' : 'Record Payment'}
        </button>
      </div>
    </form>
  );
}

