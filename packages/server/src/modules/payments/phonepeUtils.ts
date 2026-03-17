import crypto from 'crypto';
import type { BillStatus } from '@prisma/client';

export function generateChecksum(payload: string, endpoint: string, saltKey: string, saltIndex: number): string {
  const data = payload + endpoint + saltKey;
  const sha256 = crypto.createHash('sha256').update(data).digest('hex');
  return `${sha256}###${saltIndex}`;
}

// PhonePe callback checksum formats vary by integration docs/versions.
// Accept both the current and legacy format to avoid dropping valid callbacks.
export function verifyCallbackChecksum(responseBase64: string, receivedChecksum: string, saltKey: string, saltIndex: number): boolean {
  const canonical = `${crypto.createHash('sha256').update(responseBase64 + saltKey).digest('hex')}###${saltIndex}`;
  if (canonical === receivedChecksum) return true;

  const legacy = generateChecksum(responseBase64, '/pg/v1/pay', saltKey, saltIndex);
  return legacy === receivedChecksum;
}

export function calculateBillPaymentUpdate(currentPaidAmount: number, billTotalAmount: number, paymentAmount: number): {
  newPaidAmount: number;
  newStatus: BillStatus;
} {
  const newPaidAmount = currentPaidAmount + paymentAmount;
  const newStatus: BillStatus = newPaidAmount >= billTotalAmount ? 'PAID' : 'PARTIAL';
  return { newPaidAmount, newStatus };
}
