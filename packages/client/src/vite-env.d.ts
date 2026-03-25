/// <reference types="vite/client" />

interface RazorpayCheckoutResponse {
	razorpay_payment_id: string;
	razorpay_subscription_id: string;
	razorpay_signature: string;
}

interface RazorpayInstance {
	open: () => void;
	on: (event: string, handler: (payload: unknown) => void) => void;
}

interface Window {
	Razorpay: new (options: Record<string, unknown>) => RazorpayInstance;
}
