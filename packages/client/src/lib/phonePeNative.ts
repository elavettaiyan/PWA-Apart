import { registerPlugin } from '@capacitor/core';

type PhonePeEnvironment = 'SANDBOX' | 'RELEASE';

type PhonePeInitOptions = {
  merchantId: string;
  flowId: string;
  environment: PhonePeEnvironment;
  enableLogging?: boolean;
  appId?: string | null;
};

type PhonePeCheckoutOptions = {
  orderId: string;
  token: string;
};

type PhonePeCheckoutResult = {
  resultCode: number;
  ok: boolean;
  extras?: Record<string, string | null>;
};

type PhonePePaymentPlugin = {
  init(options: PhonePeInitOptions): Promise<{ success: boolean }>;
  startCheckout(options: PhonePeCheckoutOptions): Promise<PhonePeCheckoutResult>;
};

const PhonePePayment = registerPlugin<PhonePePaymentPlugin>('PhonePePayment');

export async function initPhonePeSdk(options: PhonePeInitOptions) {
  return PhonePePayment.init(options);
}

export async function startPhonePeCheckout(options: PhonePeCheckoutOptions) {
  return PhonePePayment.startCheckout(options);
}