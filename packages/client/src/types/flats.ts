// Re-export flat-related types from index
export type { Block, Flat, FlatType, Owner, Tenant, FlatOption, Society } from './index';

// ─── PREMIUM STATUS ─────────────────────────────────────

export interface PremiumStatusResponse {
  isPremium: boolean;
  activeSubscription: {
    lockedFlatCount: number;
    subscriptionId: string;
  } | null;
  includedFlatCount: number;
  limit: {
    minimumRequiredFlatCount: number;
    reached: boolean;
  };
  pricing: {
    amountPerFlat: number;
  };
  trial?: {
    isOnTrial: boolean;
    trialEndsAt?: string;
  };
  scheduledAmountPaise?: number;
}

// ─── BULK UPLOAD RESULT ─────────────────────────────────

export interface BulkUploadResult {
  message: string;
  total: number;
  created: number;
  errors: number;
  results: {
    row: number;
    flatNumber: string;
    status: string;
    error?: string;
  }[];
}
