import { Navigate, useSearchParams } from 'react-router-dom';

/**
 * PhonePe redirects here after payment completion.
 * Forwards to /billing with txnId preserved so BillingPage can check payment status.
 */
export default function PaymentStatusRedirect() {
  const [searchParams] = useSearchParams();
  const txnId = searchParams.get('txnId');

  const target = txnId ? `/billing?txnId=${encodeURIComponent(txnId)}` : '/billing';
  return <Navigate to={target} replace />;
}
