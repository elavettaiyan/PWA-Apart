import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Receipt, Plus, CreditCard, Banknote, Calendar } from 'lucide-react';
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
  baseAmount: number;
  waterCharge: number;
  parkingCharge: number;
  sinkingFund: number;
  repairFund: number;
  otherCharges: number;
  lateFeePerDay: number;
  dueDay: number;
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

export default function BillingPage() {
  const [month, setMonth] = useState(currentDate.getMonth() + 1);
  const [year, setYear] = useState(currentDate.getFullYear());
  const [showGenerate, setShowGenerate] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [selectedBill, setSelectedBill] = useState<MaintenanceBill | null>(null);
  const [generationResult, setGenerationResult] = useState<BillingGenerationResult | null>(null);
  const [configForm, setConfigForm] = useState<BillingConfigFormState>(buildConfigForm());
  const [searchParams, setSearchParams] = useSearchParams();
  const txnStatusCheckRef = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const billsBaseKey = ['bills', user?.id || 'anonymous', user?.societyId || 'no-society'];
  const billsQueryKey = [...billsBaseKey, month, year];
  const configBaseKey = ['billing-config', user?.id || 'anonymous', user?.societyId || 'no-society'];

  const { data: bills = [], isLoading } = useQuery<MaintenanceBill[]>({
    queryKey: billsQueryKey,
    queryFn: async () => (await api.get(`/billing?month=${month}&year=${year}`)).data,
    enabled: !!user,
  });

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
    mutationFn: (data: BillingConfigFormState) => api.post('/billing/config', { ...data, societyId: user?.societyId }),
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

  const totalBilled = bills.reduce((s, b) => s + b.totalAmount, 0);
  const totalCollected = bills.reduce((s, b) => s + b.paidAmount, 0);
  const paidCount = bills.filter((b) => b.status === 'PAID').length;
  const pendingCount = bills.filter((b) => b.status === 'PENDING' || b.status === 'OVERDUE').length;
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
          <h1 className="page-title">Maintenance Billing</h1>
          <p className="text-sm text-gray-500 mt-1">Generate and manage monthly maintenance bills</p>
        </div>
        {isAdmin && (
          <div className="flex gap-3">
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
        <div className="grid gap-4 mb-6 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-gray-900">Monthly Maintenance Amount</p>
                <p className="mt-1 text-sm text-gray-500">
                  Apply one shared monthly amount across all flat types in this society.
                </p>
              </div>
              <button className="btn-secondary" onClick={openConfigModal}>Configure</button>
            </div>

            {configSummary?.isConfigured ? (
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-xl bg-gray-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Monthly Total</p>
                  <p className="mt-2 text-2xl font-semibold text-gray-900">{formatCurrency(configSummary.totalMonthlyAmount)}</p>
                </div>
                <div className="rounded-xl bg-gray-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Base Amount</p>
                  <p className="mt-2 text-xl font-semibold text-gray-900">{formatCurrency(configSummary.baseAmount)}</p>
                </div>
                <div className="rounded-xl bg-gray-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Due Day</p>
                  <p className="mt-2 text-xl font-semibold text-gray-900">{configSummary.dueDay}th of every month</p>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                Bills cannot be generated until you set the monthly maintenance amount.
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <p className="text-sm font-semibold text-gray-900">Generation Status</p>
            <p className="mt-1 text-sm text-gray-500">The latest generation attempt is shown here.</p>

            {generationResult ? (
              <div className="mt-4 space-y-3 text-sm">
                <div className="rounded-xl bg-gray-50 p-4">
                  <p className="font-medium text-gray-900">
                    {generationResult.error || generationResult.message || 'Generation result'}
                  </p>
                  <p className="mt-1 text-gray-600">
                    Generated {generationResult.generatedCount} of {generationResult.totalFlats} eligible bills.
                  </p>
                </div>
                {generationResult.errors?.length ? (
                  <div className="rounded-xl border border-gray-200 p-4">
                    <p className="font-medium text-gray-900">Issues</p>
                    <ul className="mt-2 space-y-2 text-gray-600">
                      {generationResult.errors.slice(0, 5).map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                    {generationResult.errors.length > 5 ? (
                      <p className="mt-2 text-xs text-gray-500">+ {generationResult.errors.length - 5} more</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-4 rounded-xl bg-gray-50 p-4 text-sm text-gray-500">
                No generation attempt yet for this session.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Month/Year Filter */}
      <div className="flex gap-3 mb-6">
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
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="stat-card">
          <p className="stat-label">Total Billed</p>
          <p className="stat-value text-lg">{formatCurrency(totalBilled)}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Collected</p>
          <p className="text-lg font-bold text-emerald-600">{formatCurrency(totalCollected)}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Paid</p>
          <p className="text-lg font-bold text-emerald-600">{paidCount} flats</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Pending</p>
          <p className="text-lg font-bold text-amber-600">{pendingCount} flats</p>
        </div>
      </div>

      {/* Bills Table */}
      {bills.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No bills found"
          description={`No bills generated for ${getMonthName(month)} ${year}`}
          action={isAdmin ? (
            <button className="btn-primary" onClick={() => (canGenerateBills ? setShowGenerate(true) : openConfigModal())}>
              {canGenerateBills ? 'Generate Bills' : 'Set Maintenance Amount'}
            </button>
          ) : undefined}
        />
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
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
              {bills.map((bill) => (
                <tr key={bill.id}>
                  <td>
                    <div>
                      <p className="font-medium text-gray-900">{bill.flat?.flatNumber}</p>
                      <p className="text-xs text-gray-500">{bill.flat?.block?.name}</p>
                    </div>
                  </td>
                  <td>
                    <p className="text-sm">{bill.flat?.owner?.name || '-'}</p>
                    <p className="text-xs text-gray-500">{bill.flat?.owner?.phone}</p>
                  </td>
                  <td className="font-medium">{formatCurrency(bill.totalAmount)}</td>
                  <td className="text-emerald-600 font-medium">{formatCurrency(bill.paidAmount)}</td>
                  <td className="text-red-600 font-medium">{formatCurrency(bill.totalAmount - bill.paidAmount)}</td>
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
      )}

      {/* Generate Bills Modal */}
      <Modal isOpen={showGenerate} onClose={() => setShowGenerate(false)} title="Generate Monthly Bills">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            This will generate maintenance bills for all occupied flats based on the configured rates.
          </p>
          {!canGenerateBills ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
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
    value.baseAmount +
    value.waterCharge +
    value.parkingCharge +
    value.sinkingFund +
    value.repairFund +
    value.otherCharges;

  const updateNumberField = (field: keyof BillingConfigFormState, rawValue: string) => {
    onChange({ ...value, [field]: Number(rawValue) });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="space-y-4"
    >
      <div className="rounded-xl bg-gray-50 p-4">
        <p className="text-sm font-medium text-gray-900">Total monthly bill per flat</p>
        <p className="mt-2 text-2xl font-semibold text-gray-900">{formatCurrency(totalMonthlyAmount)}</p>
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
  const [amount, setAmount] = useState(bill.totalAmount - bill.paidAmount);
  const [method, setMethod] = useState('CASH');
  const [receiptNo, setReceiptNo] = useState('');

  const mutation = useMutation({
    mutationFn: (data: any) => api.post(`/billing/${bill.id}/pay`, data),
    onSuccess: () => { toast.success('Payment recorded!'); onSuccess(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); mutation.mutate({ amount, method, receiptNo }); }}
      className="space-y-4"
    >
      <div className="p-3 bg-gray-50 rounded-lg text-sm">
        <p><strong>Flat:</strong> {bill.flat?.flatNumber}</p>
        <p><strong>Total:</strong> {formatCurrency(bill.totalAmount)} | <strong>Paid:</strong> {formatCurrency(bill.paidAmount)} | <strong>Due:</strong> {formatCurrency(bill.totalAmount - bill.paidAmount)}</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Amount</label>
          <input type="number" className="input" value={amount} onChange={(e) => setAmount(Number(e.target.value))} min={1} max={bill.totalAmount - bill.paidAmount} required />
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
