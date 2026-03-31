import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Receipt, Plus, CreditCard, Banknote, Calendar, BellRing } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency, getStatusColor, getMonthName, cn } from '../../lib/utils';
import { PageLoader, EmptyState } from '../../components/ui/Loader';
import Modal from '../../components/ui/Modal';
import { useAuthStore } from '../../store/authStore';
import type { BillingGenerationResult, MaintenanceBill, MaintenanceConfigSummary } from '../../types';

const currentDate = new Date();
const yearOptions = Array.from({ length: 5 }, (_, index) => currentDate.getFullYear() - 1 + index);

type BillingConfigFormState = {
  baseAmount: number | '';
  waterCharge: number | '';
  parkingCharge: number | '';
  sinkingFund: number | '';
  repairFund: number | '';
  otherCharges: number | '';
  lateFeePerDay: number | '';
  dueDay: number | '';
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
    dueDay: summary?.dueDay ?? 10,
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
    dueDay: Number(value.dueDay || 0),
  };
}

export default function BillingPage() {
  const [month, setMonth] = useState(currentDate.getMonth() + 1);
  const [year, setYear] = useState(currentDate.getFullYear());
  const [applyMonthYearFilter, setApplyMonthYearFilter] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [selectedBill, setSelectedBill] = useState<MaintenanceBill | null>(null);
  const [generationResult, setGenerationResult] = useState<BillingGenerationResult | null>(null);
  const [configForm, setConfigForm] = useState<BillingConfigFormState>(buildConfigForm());
  const [selectedBillIds, setSelectedBillIds] = useState<string[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const txnStatusCheckRef = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'SUPER_ADMIN' || (['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER'] as string[]).includes(user?.role || '');
  const shouldApplyMonthYear = isAdmin || applyMonthYearFilter;
  const billsBaseKey = ['bills', user?.id || 'anonymous', user?.societyId || 'no-society'];
  const billsQueryKey = [
    ...billsBaseKey,
    isAdmin ? 'admin' : 'resident',
    shouldApplyMonthYear ? month : 'all-months',
    shouldApplyMonthYear ? year : 'all-years',
  ];
  const configBaseKey = ['billing-config', user?.id || 'anonymous', user?.societyId || 'no-society'];

  const billsEndpoint = shouldApplyMonthYear
    ? `/billing?month=${month}&year=${year}`
    : '/billing';
  const pendingStatuses = new Set(['PENDING', 'OVERDUE', 'PARTIAL']);

  const { data: bills = [], isLoading } = useQuery<MaintenanceBill[]>({
    queryKey: billsQueryKey,
    queryFn: async () => (await api.get(billsEndpoint)).data,
    enabled: !!user,
  });

  const displayedBills = isAdmin
    ? bills.filter((bill) => bill.month === month && bill.year === year)
    : bills.filter((bill) => pendingStatuses.has(bill.status));
  const selectableBillIds = displayedBills.filter((bill) => bill.status !== 'PAID').map((bill) => bill.id);
  const selectableBillIdsKey = selectableBillIds.join(',');
  const selectedCount = selectedBillIds.length;

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
    enabled: isAdmin,
  });

  const openConfigModal = () => {
    setConfigForm(buildConfigForm(configSummary));
    setShowConfig(true);
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

  useEffect(() => {
    if (!txnId || txnStatusCheckRef.current === txnId) return;

    txnStatusCheckRef.current = txnId;
    let isCancelled = false;

    const checkStatus = async () => {
      const maxAttempts = 6;

      for (let attempt = 1; attempt <= maxAttempts && !isCancelled; attempt++) {
        try {
          const { data } = await api.get(`/payments/status/${txnId}`);
          const status = data?.status;

          if (status === 'SUCCESS') {
            toast.success('Payment successful. Bill status updated.');
            queryClient.invalidateQueries({ queryKey: billsBaseKey });

            const nextParams = new URLSearchParams(window.location.search);
            nextParams.delete('txnId');
            nextParams.set('payment', 'success');
            setSearchParams(nextParams, { replace: true });
            return;
          }

          if (status === 'FAILED') {
            toast.error('Payment failed. Please try again.');
            const nextParams = new URLSearchParams(window.location.search);
            nextParams.delete('txnId');
            nextParams.set('payment', 'failed');
            setSearchParams(nextParams, { replace: true });
            return;
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
    };

    checkStatus();

    return () => {
      isCancelled = true;
    };
  }, [txnId, queryClient, setSearchParams]);

  if (isLoading || (isAdmin && isConfigLoading)) return <PageLoader />;

  return (
    <div>
      <div className="page-header">
        <div>
          <p className="section-label mb-2">Financials</p>
          <h1 className="page-title">Maintenance Billing</h1>
          <p className="text-sm text-on-surface-variant mt-1">Generate and manage monthly maintenance bills</p>
        </div>
        {isAdmin && (
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 w-full sm:w-auto">
            <button className="btn-secondary" onClick={() => reminderMutation.mutate()} disabled={reminderMutation.isPending}>
              <BellRing className="w-4 h-4" /> {reminderMutation.isPending ? 'Sending...' : 'Send Payment Reminders'}
            </button>
            <button className="btn-secondary" onClick={openConfigModal}>
              <Calendar className="w-4 h-4" /> Set Amount
            </button>
            <button className="btn-primary" onClick={() => setShowGenerate(true)} disabled={!canGenerateBills}>
              <Plus className="w-4 h-4" /> Generate Bills
            </button>
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="grid gap-4 mb-6 md:grid-cols-[1.25fr_0.75fr]">
          <div className="rounded-2xl bg-surface-container-lowest p-5 editorial-shadow">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-on-surface">Monthly Maintenance Amount</p>
                <p className="mt-1 text-sm text-on-surface-variant">
                  Apply one shared monthly amount across all flat types in this society.
                </p>
              </div>
              <button className="btn-secondary" onClick={openConfigModal}>Configure</button>
            </div>

            {configSummary?.isConfigured ? (
              <div className="mt-4 grid gap-3 grid-cols-1 sm:grid-cols-3">
                <div className="rounded-xl bg-surface-container-low p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">Monthly Total</p>
                  <p className="mt-2 text-2xl font-semibold text-on-surface">{formatCurrency(configSummary.totalMonthlyAmount)}</p>
                </div>
                <div className="rounded-xl bg-surface-container-low p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">Base Amount</p>
                  <p className="mt-2 text-xl font-semibold text-on-surface">{formatCurrency(configSummary.baseAmount)}</p>
                </div>
                <div className="rounded-xl bg-surface-container-low p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">Due Day</p>
                  <p className="mt-2 text-xl font-semibold text-on-surface">{configSummary.dueDay}th of every month</p>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-warning/20 bg-warning-container p-4 text-sm text-on-warning-container">
                Bills cannot be generated until you set the monthly maintenance amount.
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-surface-container-lowest p-5 editorial-shadow">
            <p className="text-sm font-semibold text-on-surface">Generation Status</p>
            <p className="mt-1 text-sm text-on-surface-variant">The latest generation attempt is shown here.</p>

            {generationResult ? (
              <div className="mt-4 space-y-3 text-sm">
                <div className="rounded-xl bg-surface-container-low p-4">
                  <p className="font-medium text-on-surface">
                    {generationResult.error || generationResult.message || 'Generation result'}
                  </p>
                  <p className="mt-1 text-on-surface-variant">
                    Generated {generationResult.generatedCount} of {generationResult.totalFlats} eligible bills.
                  </p>
                </div>
                {generationResult.errors?.length ? (
                  <div className="rounded-xl border border-outline-variant/15 p-4">
                    <p className="font-medium text-on-surface">Issues</p>
                    <ul className="mt-2 space-y-2 text-on-surface-variant">
                      {generationResult.errors.slice(0, 5).map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                    {generationResult.errors.length > 5 ? (
                      <p className="mt-2 text-xs text-on-surface-variant">+ {generationResult.errors.length - 5} more</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-4 rounded-xl bg-surface-container-low p-4 text-sm text-on-surface-variant">
                No generation attempt yet for this session.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Month/Year Filter */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {!isAdmin && (
          <label className="inline-flex items-center gap-2 text-sm text-on-surface-variant">
            <input
              type="checkbox"
              checked={applyMonthYearFilter}
              onChange={(e) => setApplyMonthYearFilter(e.target.checked)}
            />
            Apply month/year filter
          </label>
        )}

        {(isAdmin || applyMonthYearFilter) && (
          <>
            <select className="select w-40" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>{getMonthName(i + 1)}</option>
              ))}
            </select>
            <select className="select w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </>
        )}

        {!isAdmin && selectedCount >= 2 && (
          <button
            className="btn-primary"
            onClick={() => handlePhonePeBulkPay(selectedBillIds)}
          >
            <CreditCard className="w-4 h-4" /> Pay Selected ({selectedCount})
          </button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <div className="stat-card">
          <p className="stat-label">Total Billed</p>
          <p className="stat-value text-base sm:text-lg">{formatCurrency(totalBilled)}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Collected</p>
          <p className="text-base sm:text-lg font-bold text-emerald-900">{formatCurrency(totalCollected)}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Paid</p>
          <p className="text-base sm:text-lg font-bold text-emerald-900">{paidCount} flats</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Pending</p>
          <p className="text-base sm:text-lg font-bold text-warning">{pendingCount} flats</p>
        </div>
      </div>

      {/* Bills Table */}
      {displayedBills.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No bills found"
          description={
            isAdmin || applyMonthYearFilter
              ? `No bills generated for ${getMonthName(month)} ${year}`
              : 'No pending dues found'
          }
          action={isAdmin ? (
            <button className="btn-primary" onClick={() => (canGenerateBills ? setShowGenerate(true) : openConfigModal())}>
              {canGenerateBills ? 'Generate Bills' : 'Set Maintenance Amount'}
            </button>
          ) : undefined}
        />
      ) : (
        <>
        {/* Mobile card view */}
        <div className="sm:hidden space-y-3">
          {displayedBills.map((bill) => (
            <div key={bill.id} className="card overflow-hidden">
              {/* Row 1 – Flat info & status */}
              <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {!isAdmin && bill.status !== 'PAID' && (
                      <input
                        type="checkbox"
                        className="shrink-0"
                        checked={selectedBillIds.includes(bill.id)}
                        onChange={(e) => toggleBillSelection(bill.id, e.target.checked)}
                      />
                    )}
                    <p className="font-semibold text-on-surface truncate">
                      {bill.flat?.flatNumber}
                      <span className="ml-1 text-xs font-normal text-on-surface-variant">{bill.flat?.block?.name}</span>
                    </p>
                  </div>
                  <p className="text-xs text-on-surface-variant mt-0.5">
                    {bill.flat?.owner?.name || '—'} &middot; {getMonthName(bill.month)} {bill.year}
                  </p>
                </div>
                <span className={cn('badge shrink-0', getStatusColor(bill.status))}>{bill.status}</span>
              </div>

              {/* Row 2 – Amounts & actions */}
              <div className="border-t border-outline-variant/10 bg-surface-container-low/60 px-4 py-3 flex items-center justify-between gap-2">
                <div className="flex gap-4 text-xs">
                  <div>
                    <span className="text-outline block">Total</span>
                    <span className="font-semibold text-on-surface">{formatCurrency(bill.totalAmount)}</span>
                  </div>
                  <div>
                    <span className="text-outline block">Paid</span>
                    <span className="font-semibold text-emerald-900">{formatCurrency(bill.paidAmount)}</span>
                  </div>
                  <div>
                    <span className="text-outline block">Due</span>
                    <span className="font-semibold text-rose-900">{formatCurrency(bill.totalAmount - bill.paidAmount)}</span>
                  </div>
                </div>
                {bill.status !== 'PAID' && (
                  <div className="flex gap-1.5 shrink-0">
                    {isAdmin && (
                      <button
                        className="btn-sm btn-success"
                        onClick={() => { setSelectedBill(bill); setShowPayment(true); }}
                      >
                        <Banknote className="w-3 h-3" /> Record
                      </button>
                    )}
                    <button
                      className="btn-sm btn-primary"
                      onClick={() => handlePhonePePay(bill.id)}
                    >
                      <CreditCard className="w-3 h-3" /> Pay
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Desktop table view */}
        <div className="hidden sm:block table-container">
          <table>
            <thead>
              <tr>
                {!isAdmin && <th>
                  <input
                    type="checkbox"
                    checked={selectableBillIds.length > 0 && selectedBillIds.length === selectableBillIds.length}
                    onChange={(e) => toggleSelectAll(e.target.checked)}
                    aria-label="Select all payable bills"
                  />
                </th>}
                <th>Month</th>
                <th>Flat</th>
                <th>Owner</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {displayedBills.map((bill) => (
                <tr key={bill.id}>
                  {!isAdmin && (
                    <td>
                      {bill.status !== 'PAID' ? (
                        <input
                          type="checkbox"
                          checked={selectedBillIds.includes(bill.id)}
                          onChange={(e) => toggleBillSelection(bill.id, e.target.checked)}
                          aria-label={`Select bill ${bill.id}`}
                        />
                      ) : null}
                    </td>
                  )}
                  <td>
                    <p className="text-sm whitespace-nowrap">{getMonthName(bill.month)} {bill.year}</p>
                  </td>
                  <td>
                    <div>
                      <p className="font-medium text-on-surface">{bill.flat?.flatNumber}</p>
                      <p className="text-xs text-on-surface-variant">{bill.flat?.block?.name}</p>
                    </div>
                  </td>
                  <td>
                    <p className="text-sm">{bill.flat?.owner?.name || '-'}</p>
                    <p className="text-xs text-on-surface-variant">{bill.flat?.owner?.phone}</p>
                  </td>
                  <td className="font-medium whitespace-nowrap">{formatCurrency(bill.totalAmount)}</td>
                  <td className="text-emerald-900 font-medium whitespace-nowrap">{formatCurrency(bill.paidAmount)}</td>
                  <td className="text-rose-900 font-medium whitespace-nowrap">{formatCurrency(bill.totalAmount - bill.paidAmount)}</td>
                  <td><span className={cn('badge', getStatusColor(bill.status))}>{bill.status}</span></td>
                  <td>
                    {bill.status !== 'PAID' && (
                      <div className="flex gap-2">
                        {isAdmin && (
                          <button
                            className="btn-sm btn-success"
                            onClick={() => { setSelectedBill(bill); setShowPayment(true); }}
                          >
                            <Banknote className="w-3 h-3" /> Record
                          </button>
                        )}
                        <button
                          className="btn-sm btn-primary"
                          onClick={() => handlePhonePePay(bill.id)}
                        >
                          <CreditCard className="w-3 h-3" /> PhonePe
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

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
          onChange={setConfigForm}
          onSubmit={() => configMutation.mutate(configForm)}
          isPending={configMutation.isPending}
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
    </div>
  );
}

function ConfigureBillingForm({
  value,
  onChange,
  onSubmit,
  isPending,
}: {
  value: BillingConfigFormState;
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
        <div>
          <label className="label">Late Fee Per Day</label>
          <input type="number" min={0} className="input" value={value.lateFeePerDay} onChange={(e) => updateNumberField('lateFeePerDay', e.target.value)} />
        </div>
        <div>
          <label className="label">Due Day</label>
          <input type="number" min={1} max={28} className="input" value={value.dueDay} onChange={(e) => updateNumberField('dueDay', e.target.value)} required />
        </div>
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

async function handlePhonePePay(billId: string) {
  try {
    const { data } = await api.post('/payments/phonepe/initiate', { billId });
    if (data.redirectUrl) {
      window.location.href = data.redirectUrl;
    } else {
      toast.error('Failed to get payment URL');
    }
  } catch (error: any) {
    toast.error(error.response?.data?.error || 'Payment initiation failed');
  }
}

async function handlePhonePeBulkPay(billIds: string[]) {
  try {
    if (billIds.length < 2) {
      toast.error('Select at least 2 bills for bulk payment');
      return;
    }

    const { data } = await api.post('/payments/phonepe/initiate-bulk', { billIds });
    if (data.redirectUrl) {
      window.location.href = data.redirectUrl;
    } else {
      toast.error('Failed to get bulk payment URL');
    }
  } catch (error: any) {
    toast.error(error.response?.data?.error || 'Bulk payment initiation failed');
  }
}
