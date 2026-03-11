import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date));
}

export function getMonthName(month: number): string {
  return new Date(2024, month - 1).toLocaleString('en-IN', { month: 'long' });
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    PAID: 'badge-success',
    SUCCESS: 'badge-success',
    RESOLVED: 'badge-success',
    CLOSED: 'badge-neutral',
    PENDING: 'badge-warning',
    INITIATED: 'badge-warning',
    OPEN: 'badge-info',
    IN_PROGRESS: 'badge-info',
    PARTIAL: 'badge-warning',
    OVERDUE: 'badge-danger',
    FAILED: 'badge-danger',
    REJECTED: 'badge-danger',
    URGENT: 'badge-danger',
    HIGH: 'badge-warning',
    MEDIUM: 'badge-info',
    LOW: 'badge-neutral',
  };
  return colors[status] || 'badge-neutral';
}

export function getFlatTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    ONE_BHK: '1 BHK',
    TWO_BHK: '2 BHK',
    THREE_BHK: '3 BHK',
    FOUR_BHK: '4 BHK',
    STUDIO: 'Studio',
    PENTHOUSE: 'Penthouse',
    SHOP: 'Shop',
    OTHER: 'Other',
  };
  return labels[type] || type;
}
