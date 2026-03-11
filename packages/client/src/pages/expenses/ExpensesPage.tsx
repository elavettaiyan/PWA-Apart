import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wallet, Plus, Trash2, Receipt } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { PageLoader, EmptyState } from '../../components/ui/Loader';
import Modal from '../../components/ui/Modal';
import type { Expense, ExpenseCategory } from '../../types';

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

export default function ExpensesPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{
    expenses: Expense[];
    summary: any[];
    total: number;
  }>({
    queryKey: ['expenses', categoryFilter],
    queryFn: async () => {
      const params = categoryFilter ? `?category=${categoryFilter}` : '';
      return (await api.get(`/expenses${params}`)).data;
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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Expenses</h1>
          <p className="text-sm text-gray-500 mt-1">Track and manage society expenses</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" /> Add Expense
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="stat-card">
          <p className="stat-label">Total Expenses</p>
          <p className="text-xl font-bold text-red-600">{formatCurrency(total)}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Entries</p>
          <p className="stat-value">{expenses.length}</p>
        </div>
        {data?.summary?.slice(0, 2).map((s: any) => (
          <div key={s.category} className="stat-card">
            <p className="stat-label">{s.category.replace('_', ' ')}</p>
            <p className="text-lg font-bold text-gray-700">{formatCurrency(s._sum?.amount || 0)}</p>
          </div>
        ))}
      </div>

      {/* Category Filter */}
      <div className="mb-4">
        <select
          className="select w-48"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      {/* Expenses Table */}
      {expenses.length === 0 ? (
        <EmptyState icon={Wallet} title="No expenses" description="No expenses recorded yet" />
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Date</th>
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
                  <td>
                    <span className="badge badge-info">{expense.category.replace('_', ' ')}</span>
                  </td>
                  <td className="text-sm max-w-[200px] truncate">{expense.description}</td>
                  <td className="text-sm text-gray-500">{expense.vendor || '-'}</td>
                  <td className="font-semibold text-red-600">{formatCurrency(expense.amount)}</td>
                  <td>
                    <button
                      className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                      onClick={() => {
                        if (confirm('Delete this expense?')) deleteMutation.mutate(expense.id);
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
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
  const [form, setForm] = useState({
    category: 'MAINTENANCE' as ExpenseCategory,
    amount: '',
    description: '',
    vendor: '',
    expenseDate: new Date().toISOString().split('T')[0],
  });

  const mutation = useMutation({
    mutationFn: (data: any) => api.post('/expenses', data),
    onSuccess: () => { toast.success('Expense added!'); onSuccess(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); mutation.mutate(form); }}
      className="space-y-4"
    >
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Category</label>
          <select className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ExpenseCategory })}>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
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
          <label className="label">Date</label>
          <input type="date" className="input" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} required />
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
