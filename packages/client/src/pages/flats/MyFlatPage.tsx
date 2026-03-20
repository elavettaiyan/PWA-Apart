import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, User, Phone, Mail, Home, Calendar } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate, getMonthName, getStatusColor, cn } from '../../lib/utils';
import { PageLoader } from '../../components/ui/Loader';
import type { MaintenanceBill, PaymentMethod } from '../../types';

export default function MyFlatPage() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);

  const { data: flat, isLoading, error } = useQuery<any>({
    queryKey: ['my-flat', selectedYear],
    queryFn: async () => (await api.get(`/flats/my-flat?year=${selectedYear}`)).data,
  });

  const yearOptions = useMemo(
    () => Array.from({ length: 6 }, (_, index) => currentYear - index),
    [currentYear],
  );

  if (isLoading) return <PageLoader />;

  if (error || !flat) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-500">
        <Building2 className="w-12 h-12 mb-4 text-gray-300" />
        <h2 className="text-lg font-semibold text-gray-700">No Flat Found</h2>
        <p className="text-sm mt-1">Your account is not linked to any flat. Contact your admin.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Flat</h1>
          <p className="text-sm text-gray-500 mt-1">
            {flat.block?.name} - {flat.flatNumber}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Flat Details */}
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Home className="w-5 h-5 text-primary-500" /> Flat Details
          </h2>
          <div className="space-y-3 text-sm">
            <Row label="Flat Number" value={flat.flatNumber} />
            <Row label="Block" value={flat.block?.name} />
            <Row label="Society" value={flat.block?.society?.name} />
            <Row label="Floor" value={flat.floor} />
            <Row label="BHK Type" value={flat.bhkType?.replace('_', ' ')} />
            <Row label="Area" value={`${flat.area} sq.ft.`} />
            <Row label="Status" value={flat.occupancyStatus} />
          </div>
        </div>

        {/* Owner / Tenant Info */}
        <div className="space-y-6">
          {flat.owner && (
            <div className="card p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <User className="w-5 h-5 text-blue-500" /> Owner
              </h2>
              <div className="space-y-3 text-sm">
                <Row label="Name" value={flat.owner.name} />
                <Row label="Phone" value={flat.owner.phone} icon={<Phone className="w-3.5 h-3.5" />} />
                <Row label="Email" value={flat.owner.email} icon={<Mail className="w-3.5 h-3.5" />} />
              </div>
            </div>
          )}

          {flat.tenant && (
            <div className="card p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <User className="w-5 h-5 text-teal-500" /> Tenant
              </h2>
              <div className="space-y-3 text-sm">
                <Row label="Name" value={flat.tenant.name} />
                <Row label="Phone" value={flat.tenant.phone} icon={<Phone className="w-3.5 h-3.5" />} />
                <Row label="Email" value={flat.tenant.email} icon={<Mail className="w-3.5 h-3.5" />} />
                <Row label="Lease Start" value={formatDate(flat.tenant.leaseStartDate)} icon={<Calendar className="w-3.5 h-3.5" />} />
                {flat.tenant.leaseEndDate && (
                  <Row label="Lease End" value={formatDate(flat.tenant.leaseEndDate)} icon={<Calendar className="w-3.5 h-3.5" />} />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bill Summary */}
      {flat.bills && flat.bills.length > 0 && (
        <div className="mt-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-gray-900">Bill Summary</h2>
            <select className="select w-32" value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}>
              {yearOptions.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Due Date</th>
                  <th>Amount</th>
                  <th>Paid</th>
                  <th>Balance</th>
                  <th>Payment Date</th>
                  <th>Payment Mode</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {flat.bills.map((bill: MaintenanceBill) => {
                  const latestPayment = bill.payments?.[0];

                  return (
                  <tr key={bill.id}>
                    <td className="font-medium">{getMonthName(bill.month)} {bill.year}</td>
                    <td>{formatDate(bill.dueDate)}</td>
                    <td>{formatCurrency(bill.totalAmount)}</td>
                    <td className="text-emerald-600">{formatCurrency(bill.paidAmount)}</td>
                    <td className="text-red-600">{formatCurrency(bill.totalAmount - bill.paidAmount)}</td>
                    <td>{latestPayment?.paidAt ? formatDate(latestPayment.paidAt) : '—'}</td>
                    <td>{latestPayment ? getPaymentMethodLabel(latestPayment.method) : '—'}</td>
                    <td>
                      <span className={cn('badge', getStatusColor(bill.status))}>
                        {bill.status}
                      </span>
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {flat.bills && flat.bills.length === 0 && (
        <div className="mt-6 card p-6 text-sm text-gray-500">
          No bill transactions found for {selectedYear}.
        </div>
      )}
    </div>
  );
}

function getPaymentMethodLabel(method: PaymentMethod) {
  const labels: Record<PaymentMethod, string> = {
    PHONEPE: 'PhonePe',
    CASH: 'Cash',
    CHEQUE: 'Cheque',
    BANK_TRANSFER: 'Bank Transfer',
    UPI_OTHER: 'UPI',
  };

  return labels[method] || method;
}

function Row({ label, value, icon }: { label: string; value: string | number | null | undefined; icon?: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900 flex items-center gap-1.5">
        {icon} {value || '—'}
      </span>
    </div>
  );
}
