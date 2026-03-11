import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Receipt, Plus, CreditCard, Banknote, Calendar } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { formatCurrency, getStatusColor, getMonthName, cn } from '../../lib/utils';
import { PageLoader, EmptyState } from '../../components/ui/Loader';
import Modal from '../../components/ui/Modal';
import { useAuthStore } from '../../store/authStore';
import type { MaintenanceBill } from '../../types';

const currentDate = new Date();

export default function BillingPage() {
  const [month, setMonth] = useState(currentDate.getMonth() + 1);
  const [year, setYear] = useState(currentDate.getFullYear());
  const [showGenerate, setShowGenerate] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [selectedBill, setSelectedBill] = useState<MaintenanceBill | null>(null);
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  const { data: bills = [], isLoading } = useQuery<MaintenanceBill[]>({
    queryKey: ['bills', month, year],
    queryFn: async () => (await api.get(`/billing?month=${month}&year=${year}`)).data,
  });

  const generateMutation = useMutation({
    mutationFn: (data: any) => api.post('/billing/generate', data),
    onSuccess: (res) => {
      toast.success(res.data.message);
      queryClient.invalidateQueries({ queryKey: ['bills'] });
      setShowGenerate(false);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const totalBilled = bills.reduce((s, b) => s + b.totalAmount, 0);
  const totalCollected = bills.reduce((s, b) => s + b.paidAmount, 0);
  const paidCount = bills.filter((b) => b.status === 'PAID').length;
  const pendingCount = bills.filter((b) => b.status === 'PENDING' || b.status === 'OVERDUE').length;

  if (isLoading) return <PageLoader />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Maintenance Billing</h1>
          <p className="text-sm text-gray-500 mt-1">Generate and manage monthly maintenance bills</p>
        </div>
        {isAdmin && (
          <button className="btn-primary" onClick={() => setShowGenerate(true)}>
            <Plus className="w-4 h-4" /> Generate Bills
          </button>
        )}
      </div>

      {/* Month/Year Filter */}
      <div className="flex gap-3 mb-6">
        <select className="select w-40" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i + 1} value={i + 1}>{getMonthName(i + 1)}</option>
          ))}
        </select>
        <select className="select w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027].map((y) => (
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
          action={isAdmin ? <button className="btn-primary" onClick={() => setShowGenerate(true)}>Generate Bills</button> : undefined}
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
                {[2024, 2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button className="btn-secondary" onClick={() => setShowGenerate(false)}>Cancel</button>
            <button
              className="btn-primary"
              onClick={() => generateMutation.mutate({ societyId: user?.societyId || bills[0]?.flat?.block?.society?.id, month, year })}
              disabled={generateMutation.isPending}
            >
              {generateMutation.isPending ? 'Generating...' : 'Generate Bills'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Record Payment Modal */}
      <Modal isOpen={showPayment} onClose={() => setShowPayment(false)} title="Record Payment">
        {selectedBill && (
          <RecordPaymentForm
            bill={selectedBill}
            onSuccess={() => { setShowPayment(false); queryClient.invalidateQueries({ queryKey: ['bills'] }); }}
          />
        )}
      </Modal>
    </div>
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
