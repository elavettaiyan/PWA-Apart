import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wallet, Plus, Trash2, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { getApiBaseUrl } from '../../lib/platform';
import { formatCurrency, formatDate } from '../../lib/utils';
import { PageLoader, EmptyState } from '../../components/ui/Loader';
import Modal from '../../components/ui/Modal';
import type { Expense, ExpenseCategory, ExpenseListResponse } from '../../types';

const CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'REPAIR', label: 'Repair' },
  { value: 'SALARY', label: 'Salary' },
  { value: 'ELECTRICITY', label: 'Electricity' },
  { value: 'WATER', label: 'Water' },
  { value: 'SECURITY', label: 'Security' },
  { value: 'CLEANING', label: 'Cleaning' },
  { value: 'GARDENING', label: 'Gardening' },
  { value: 'LIFT', label: 'Lift' },
  { value: 'SINKING_FUND', label: 'Sinking Fund' },
  { value: 'INSURANCE', label: 'Insurance' },
  { value: 'LEGAL', label: 'Legal' },
  { value: 'EVENTS', label: 'Events' },
  { value: 'OTHER', label: 'Other' },
];

const ADD_EXPENSE_CATEGORIES = CATEGORIES.filter((category) => category.value !== 'MAINTENANCE');

const MONTH_OPTIONS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function getCurrentAccountingPeriod() {
  const now = new Date();
  return {
    accountingMonth: now.getMonth() + 1,
    accountingYear: now.getFullYear(),
  };
}

function getAccountingPeriodFromDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return getCurrentAccountingPeriod();
  }

  return {
    accountingMonth: parsed.getMonth() + 1,
    accountingYear: parsed.getFullYear(),
  };
}

function formatAccountingPeriodLabel(month: number, year: number) {
  return `${MONTH_OPTIONS[month - 1]} ${year}`;
}

export default function ExpensesPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');
  const currentPeriod = getCurrentAccountingPeriod();
  const [accountingMonth, setAccountingMonth] = useState(currentPeriod.accountingMonth);
  const [accountingYear, setAccountingYear] = useState(currentPeriod.accountingYear);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<ExpenseListResponse>({
    queryKey: ['expenses', accountingMonth, accountingYear, categoryFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        month: String(accountingMonth),
        year: String(accountingYear),
      });
      if (categoryFilter) params.set('category', categoryFilter);
      return (await api.get(`/expenses?${params.toString()}`)).data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/expenses/${id}`),
    onSuccess: () => {
      toast.success('Expense deleted');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  if (isLoading) return <PageLoader />;

  const expenses = data?.expenses || [];
  const total = data?.total || 0;
  const selectedPeriodLabel = data?.selectedPeriod?.label || formatAccountingPeriodLabel(accountingMonth, accountingYear);
  const yearOptions = Array.from({ length: 6 }, (_, index) => currentPeriod.accountingYear - 2 + index);

  return (
    <div>
      <div className="page-header">
        <div>
          <p className="section-label mb-2">Financial Ledger</p>
          <h1 className="page-title">Expenses</h1>
          <p className="text-sm text-on-surface-variant mt-1">Track and manage society expenses by accounting month</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" /> Add Expense
        </button>
      </div>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div>
            <label className="label">Accounting Month</label>
            <select className="select w-full sm:w-44" value={accountingMonth} onChange={(e) => setAccountingMonth(Number(e.target.value))}>
              {MONTH_OPTIONS.map((monthLabel, index) => (
                <option key={monthLabel} value={index + 1}>{monthLabel}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Accounting Year</label>
            <select className="select w-full sm:w-32" value={accountingYear} onChange={(e) => setAccountingYear(Number(e.target.value))}>
              {yearOptions.map((yearOption) => (
                <option key={yearOption} value={yearOption}>{yearOption}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Category</label>
            <select
              className="select w-full sm:w-48"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">All Categories</option>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        </div>
        <div className="rounded-2xl border border-outline-variant/15 bg-white px-4 py-3 text-sm text-on-surface-variant">
          Viewing expenses booked for <span className="font-semibold text-on-surface">{selectedPeriodLabel}</span>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-gradient-to-br from-[#171C3F] to-[#2A3060] rounded-2xl p-5 text-white">
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary-fixed-dim/70">Total Expenses</p>
          <p className="text-2xl font-extrabold editorial-title mt-1">{formatCurrency(total)}</p>
          <p className="mt-1 text-xs text-primary-fixed-dim/80">{selectedPeriodLabel}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Entries</p>
          <p className="stat-value">{expenses.length}</p>
        </div>
        {data?.summary?.slice(0, 2).map((s) => (
          <div key={s.category} className="stat-card">
            <p className="stat-label">{s.category.replace('_', ' ')}</p>
            <p className="text-lg font-bold text-on-surface-variant">{formatCurrency(s._sum?.amount || 0)}</p>
          </div>
        ))}
      </div>

      {/* Expenses Table */}
      {expenses.length === 0 ? (
        <EmptyState icon={Wallet} title="No expenses" description={`No expenses recorded for ${selectedPeriodLabel}`} />
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Actual Date</th>
                <th>Booked For</th>
                <th>Category</th>
                <th>Description</th>
                <th>Vendor</th>
                <th>Amount</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((expense) => (
                <tr key={expense.id}>
                  <td className="text-sm">{formatDate(expense.expenseDate)}</td>
                  <td className="text-sm text-on-surface-variant">{formatAccountingPeriodLabel(expense.accountingMonth, expense.accountingYear)}</td>
                  <td>
                    <span className="badge badge-info">{expense.category.replace('_', ' ')}</span>
                  </td>
                  <td className="text-sm max-w-[200px] truncate">{expense.description}</td>
                  <td className="text-sm text-on-surface-variant">{expense.vendor || '-'}</td>
                  <td className="font-semibold text-rose-900">{formatCurrency(expense.amount)}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      {expense.receiptUrl && (
                        <a
                          href={expense.receiptUrl.startsWith('data:') ? expense.receiptUrl : `${getApiBaseUrl().replace('/api', '')}${expense.receiptUrl}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 text-primary hover:text-primary/80 hover:bg-primary/5 rounded-lg"
                          title="View receipt"
                        >
                          <FileText className="w-4 h-4" />
                        </a>
                      )}
                      <button
                        className="p-1.5 text-error/60 hover:text-error hover:bg-error-container rounded-lg"
                        onClick={() => {
                          if (confirm('Delete this expense?')) deleteMutation.mutate(expense.id);
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Expense Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Add Expense" size="md">
        <AddExpenseForm
          onSuccess={() => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['expenses'] });
          }}
        />
      </Modal>
    </div>
  );
}

function AddExpenseForm({ onSuccess }: { onSuccess: () => void }) {
  const currentPeriod = getCurrentAccountingPeriod();
  const [form, setForm] = useState({
    category: 'REPAIR' as ExpenseCategory,
    amount: '',
    description: '',
    vendor: '',
    expenseDate: new Date().toISOString().split('T')[0],
    accountingMonth: currentPeriod.accountingMonth,
    accountingYear: currentPeriod.accountingYear,
  });
  const [receipt, setReceipt] = useState<File | null>(null);

  const mutation = useMutation({
    mutationFn: (formData: FormData) => api.post('/expenses', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
    onSuccess: () => { toast.success('Expense added!'); onSuccess(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const handleReceiptChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.size > 5 * 1024 * 1024) {
      toast.error('Receipt must be under 5 MB');
      return;
    }
    setReceipt(file || null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('category', form.category);
    formData.append('amount', form.amount);
    formData.append('description', form.description);
    if (form.vendor) formData.append('vendor', form.vendor);
    formData.append('expenseDate', form.expenseDate);
    formData.append('accountingMonth', String(form.accountingMonth));
    formData.append('accountingYear', String(form.accountingYear));
    if (receipt) formData.append('receipt', receipt);
    mutation.mutate(formData);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Category</label>
          <select className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ExpenseCategory })}>
            {ADD_EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Amount (₹)</label>
          <input type="number" className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required min="0.01" step="0.01" />
        </div>
        <div className="col-span-2">
          <label className="label">Description</label>
          <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required placeholder="What was this expense for?" />
        </div>
        <div>
          <label className="label">Vendor</label>
          <input className="input" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="Optional" />
        </div>
        <div>
          <label className="label">Actual Expense Date</label>
          <input
            type="date"
            className="input"
            value={form.expenseDate}
            onChange={(e) => {
              const nextExpenseDate = e.target.value;
              const nextAccountingPeriod = getAccountingPeriodFromDate(nextExpenseDate);
              setForm({
                ...form,
                expenseDate: nextExpenseDate,
                accountingMonth: nextAccountingPeriod.accountingMonth,
                accountingYear: nextAccountingPeriod.accountingYear,
              });
            }}
            required
          />
        </div>
        <div>
          <label className="label">Booked Month</label>
          <select className="select" value={form.accountingMonth} onChange={(e) => setForm({ ...form, accountingMonth: Number(e.target.value) })}>
            {MONTH_OPTIONS.map((monthLabel, index) => (
              <option key={monthLabel} value={index + 1}>{monthLabel}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Booked Year</label>
          <select className="select" value={form.accountingYear} onChange={(e) => setForm({ ...form, accountingYear: Number(e.target.value) })}>
            {Array.from({ length: 6 }, (_, index) => currentPeriod.accountingYear - 2 + index).map((yearOption) => (
              <option key={yearOption} value={yearOption}>{yearOption}</option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">Receipt (optional)</label>
          <label className="flex items-center gap-2 px-4 py-2 border-2 border-dashed border-outline-variant rounded-lg cursor-pointer hover:border-primary transition w-fit">
            <FileText className="w-4 h-4 text-outline" />
            <span className="text-sm text-on-surface-variant">{receipt ? receipt.name : 'Choose file (image or PDF, max 5 MB)'}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={handleReceiptChange} />
          </label>
          {receipt && (
            <button type="button" onClick={() => setReceipt(null)} className="text-xs text-error mt-1 hover:underline">Remove</button>
          )}
        </div>
      </div>
      <div className="flex justify-end gap-3 pt-4">
        <button type="submit" className="btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Adding...' : 'Add Expense'}
        </button>
      </div>
    </form>
  );
}
