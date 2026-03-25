type RazorpayCheckoutResponse = {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
};

type RazorpayCheckoutOptions = {
  key: string;
  subscriptionId: string;
  name: string;
  description: string;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
  notes?: Record<string, string>;
  onSuccess: (response: RazorpayCheckoutResponse) => void;
  onDismiss?: () => void;
};

const CHECKOUT_SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

let scriptPromise: Promise<void> | null = null;

export function loadRazorpayCheckout() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Razorpay checkout is only available in the browser'));
  }

  if (window.Razorpay) {
    return Promise.resolve();
  }

  if (scriptPromise) {
    return scriptPromise;
  }

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${CHECKOUT_SCRIPT_SRC}"]`);
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Failed to load Razorpay checkout')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = CHECKOUT_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Razorpay checkout'));
    document.body.appendChild(script);
  });

  return scriptPromise;
}

export async function openRazorpaySubscriptionCheckout(options: RazorpayCheckoutOptions) {
  await loadRazorpayCheckout();

  const instance = new window.Razorpay({
    key: options.key,
    subscription_id: options.subscriptionId,
    name: options.name,
    description: options.description,
    prefill: options.prefill,
    notes: options.notes,
    theme: { color: '#05213a' },
    modal: {
      ondismiss: options.onDismiss,
    },
    handler: options.onSuccess,
  });

  instance.open();
  return instance;
}