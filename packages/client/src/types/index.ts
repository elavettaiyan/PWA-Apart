// ─── USER & AUTH ────────────────────────────────────────

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'SECRETARY' | 'JOINT_SECRETARY' | 'TREASURER' | 'OWNER' | 'TENANT' | 'SERVICE_STAFF';

// Role group helpers
export const SOCIETY_ADMINS: Role[] = ['ADMIN', 'SECRETARY'];
export const SOCIETY_MANAGERS: Role[] = ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY'];
export const FINANCIAL_ROLES: Role[] = ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER'];
export const RESIDENT_ROLES: Role[] = ['OWNER', 'TENANT'];
export const ALL_SOCIETY_ROLES: Role[] = ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER', 'OWNER', 'TENANT', 'SERVICE_STAFF'];

export type NavigationMenuId =
  | 'dashboard'
  | 'flats'
  | 'my-flat'
  | 'billing'
  | 'complaints'
  | 'gate-management'
  | 'entry-activity'
  | 'expenses'
  | 'reports'
  | 'settings';

export type ConfigurableMenuRole = 'ADMIN' | 'SECRETARY' | 'JOINT_SECRETARY' | 'TREASURER' | 'OWNER' | 'TENANT';

export interface RoleMenuVisibilityItem {
  id: NavigationMenuId;
  label: string;
  href: string;
  allowed: boolean;
  mandatory: boolean;
  enabled: boolean;
  defaultEnabled: boolean;
  selectable: boolean;
}

export interface RoleMenuVisibilityConfig {
  role: ConfigurableMenuRole;
  roleLabel: string;
  mandatoryMenuIds: NavigationMenuId[];
  defaultMenuIds: NavigationMenuId[];
  visibleMenuIds: NavigationMenuId[];
  menuItems: RoleMenuVisibilityItem[];
}

export interface MenuVisibilityResponse {
  societyId: string;
  configurableRoles: RoleMenuVisibilityConfig[];
}

export interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: Role;
  specialization?: string | null;
  societyId?: string;
  activeSocietyId?: string;
  societies?: Array<{ id: string; name: string; role?: Role }>;
  flat?: Flat;
  mustChangePassword?: boolean;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  premiumLifecycle?: {
    stage: 'CURRENT' | 'WARNING' | 'OVERDUE_RECOVERY' | 'ROLE_LOGIN_BLOCKED' | 'ARCHIVED';
    message: string;
    overdueStartedAt?: string | null;
    loginBlockedAt?: string | null;
    archiveAt?: string | null;
  } | null;
}

// ─── SOCIETY ────────────────────────────────────────────

export interface Society {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  registrationNo?: string;
  totalBlocks: number;
  totalFlats: number;
}

// ─── BLOCK ──────────────────────────────────────────────

export interface Block {
  id: string;
  name: string;
  floors: number;
  societyId: string;
  society?: { id: string; name: string };
  _count?: { flats: number };
}

// ─── FLAT ───────────────────────────────────────────────

export type FlatType = 'ONE_BHK' | 'TWO_BHK' | 'THREE_BHK' | 'FOUR_BHK' | 'STUDIO' | 'PENTHOUSE' | 'SHOP' | 'OTHER';

export interface Flat {
  id: string;
  flatNumber: string;
  floor: number;
  type: FlatType;
  areaSqFt?: number;
  blockId: string;
  isOccupied: boolean;
  block?: Block & { society?: { id: string; name: string } };
  owner?: Owner;
  tenant?: Tenant;
  bills?: MaintenanceBill[];
  complaints?: Complaint[];
  visitors?: Visitor[];
  deliveries?: Delivery[];
}

export interface FlatOption {
  id: string;
  flatNumber: string;
  floor: number;
  blockName: string;
  residentName?: string | null;
}

// ─── OWNER ──────────────────────────────────────────────

export interface Owner {
  id: string;
  name: string;
  email?: string;
  phone: string;
  altPhone?: string;
  aadharNo?: string;
  panNo?: string;
  flatId: string;
  moveInDate?: string;
  userId?: string;
}

// ─── TENANT ─────────────────────────────────────────────

export interface Tenant {
  id: string;
  name: string;
  email?: string;
  phone: string;
  flatId: string;
  leaseStart: string;
  leaseEnd?: string;
  rentAmount?: number;
  deposit?: number;
  isActive: boolean;
}

// ─── MAINTENANCE ────────────────────────────────────────

export type BillStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE';

export interface MaintenanceConfig {
  id: string;
  societyId: string;
  flatType: FlatType;
  baseAmount: number;
  waterCharge: number;
  parkingCharge: number;
  sinkingFund: number;
  repairFund: number;
  otherCharges: number;
  lateFeePerDay: number;
  dueDay: number;
}

export interface MaintenanceConfigSummary {
  societyId: string;
  isConfigured: boolean;
  baseAmount: number;
  waterCharge: number;
  parkingCharge: number;
  sinkingFund: number;
  repairFund: number;
  otherCharges: number;
  lateFeePerDay: number;
  dueDay: number;
  configuredFlatTypes: FlatType[];
  totalMonthlyAmount: number;
}

export interface BillingGenerationResult {
  message?: string;
  generatedCount: number;
  totalFlats: number;
  errors?: string[];
  error?: string;
}

export interface MaintenanceBill {
  id: string;
  flatId: string;
  month: number;
  year: number;
  baseAmount: number;
  waterCharge: number;
  parkingCharge: number;
  sinkingFund: number;
  repairFund: number;
  otherCharges: number;
  lateFee: number;
  totalAmount: number;
  paidAmount: number;
  dueDate: string;
  status: BillStatus;
  flat?: Flat;
  payments?: Payment[];
}

// ─── PAYMENT ────────────────────────────────────────────

export type PaymentStatus = 'INITIATED' | 'SUCCESS' | 'FAILED' | 'REFUNDED';
export type PaymentMethod = 'PHONEPE' | 'CASH' | 'CHEQUE' | 'BANK_TRANSFER' | 'UPI_OTHER';

export interface Payment {
  id: string;
  billId: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  transactionId?: string;
  merchantTransId?: string;
  receiptNo?: string;
  paidAt?: string;
}

// ─── COMPLAINT ──────────────────────────────────────────

export type ComplaintStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'REJECTED';
export type ComplaintPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface Complaint {
  id: string;
  societyId: string;
  flatId?: string;
  title: string;
  description: string;
  category: string;
  priority: ComplaintPriority;
  status: ComplaintStatus;
  images: string[];
  resolution?: string;
  resolvedAt?: string;
  createdAt: string;
  flat?: { flatNumber: string; block?: { name: string } };
  createdBy?: { name: string };
  assignedTo?: { name: string };
  comments?: ComplaintComment[];
  _count?: { comments: number };
}

export interface ComplaintComment {
  id: string;
  authorName: string;
  content: string;
  createdAt: string;
}

// ─── VISITORS & DELIVERIES ─────────────────────────────

export type VisitorStatus = 'ACTIVE' | 'LEFT';
export type DeliveryType = 'COURIER' | 'FOOD' | 'GROCERY' | 'MEDICINE' | 'PARCEL' | 'OTHER';

export interface EntryFlatSummary {
  id: string;
  flatNumber: string;
  block?: { name: string };
  residentName?: string | null;
}

export interface Visitor {
  id: string;
  societyId: string;
  flatId: string;
  capturedByUserId: string;
  visitorName: string;
  mobile: string;
  vehicleNumber?: string | null;
  purpose: string;
  notes?: string | null;
  photoUrl?: string | null;
  status: VisitorStatus;
  checkedInAt: string;
  checkedOutAt?: string | null;
  createdAt: string;
  flat?: EntryFlatSummary | null;
  capturedBy?: { name: string };
}

export interface Delivery {
  id: string;
  societyId: string;
  flatId: string;
  capturedByUserId: string;
  deliveryType: DeliveryType;
  deliveryPersonName: string;
  mobile?: string | null;
  companyName?: string | null;
  vehicleNumber?: string | null;
  notes?: string | null;
  photoUrl?: string | null;
  deliveredAt: string;
  createdAt: string;
  flat?: EntryFlatSummary | null;
  capturedBy?: { name: string };
}

// ─── EXPENSE ────────────────────────────────────────────

export type ExpenseCategory =
  | 'MAINTENANCE' | 'REPAIR' | 'SALARY' | 'ELECTRICITY' | 'WATER'
  | 'SECURITY' | 'CLEANING' | 'GARDENING' | 'LIFT' | 'SINKING_FUND'
  | 'INSURANCE' | 'LEGAL' | 'EVENTS' | 'OTHER';

export interface Expense {
  id: string;
  societyId: string;
  category: ExpenseCategory;
  amount: number;
  description: string;
  vendor?: string;
  receiptUrl?: string;
  expenseDate: string;
  approvedBy?: string;
}

// ─── ASSOCIATION BYLAW ──────────────────────────────────

export interface AssociationBylaw {
  id: string;
  societyId: string;
  title: string;
  content: string;
  category: string;
  penaltyAmount?: number;
  effectiveDate: string;
  isActive: boolean;
}

// ─── REPORTS ────────────────────────────────────────────

export interface DashboardData {
  totalFlats: number;
  occupiedFlats: number;
  vacantFlats: number;
  totalOwners: number;
  totalTenants: number;
  openComplaints: number;
  pendingBills: number;
  totalCollected: number;
  totalExpenses: number;
  netBalance: number;
}

export interface CollectionReport {
  month: number;
  year: number;
  bills: MaintenanceBill[];
  summary: {
    totalBilled: number;
    totalCollected: number;
    totalPending: number;
    collectionRate: string;
    paidCount: number;
    pendingCount: number;
    partialCount: number;
    totalBills: number;
  };
}

export interface PnLReport {
  period: { from: string; to: string };
  billedIncome: {
    total: number;
    byMonth: Record<string, number>;
    byComponent: {
      baseAmount: number;
      waterCharge: number;
      parkingCharge: number;
      sinkingFund: number;
      repairFund: number;
      otherCharges: number;
      lateFee: number;
    };
  };
  collectedIncome: { total: number; byMonth: Record<string, number> };
  expenses: {
    total: number;
    byCategory: Array<{ category: string; _sum: { amount: number } }>;
    byMonth: Record<string, number>;
  };
  receivables: {
    totalOutstanding: number;
    agingBuckets: {
      current: number;
      days1To30: number;
      days31To60: number;
      days61To90: number;
      days90Plus: number;
    };
  };
  reserveFunds: {
    sinkingFundBilled: number;
    repairFundBilled: number;
    sinkingFundCollected: number;
    repairFundCollected: number;
    sinkingFundOutstanding: number;
    repairFundOutstanding: number;
  };
  netProfitLoss: number;
  cashSurplus: number;
  profitMargin: string;
}

// ─── PREMIUM SUBSCRIPTION ──────────────────────────────

export interface PremiumSubscriptionPayment {
  id: string;
  status: PaymentStatus;
  amountPaise: number;
  currency: string;
  razorpayPaymentId?: string;
  paidAt?: string;
  failureReason?: string;
}

export interface PremiumSubscription {
  id: string;
  status: 'PENDING' | 'ACTIVE' | 'HALTED' | 'CANCELLED' | 'COMPLETED' | 'FAILED';
  providerStatus?: string;
  lockedFlatCount: number;
  includedFlatCount: number;
  amountPerFlatPaise: number;
  amountPaise: number;
  currency: string;
  razorpaySubscriptionId?: string;
  usesPerFlatQuantity?: boolean;
  scheduledFlatCount?: number | null;
  scheduledAmountPaise?: number | null;
  scheduledChangeAt?: string | null;
  scheduledPlanId?: string | null;
  overdueStartedAt?: string | null;
  warningNoticeSentAt?: string | null;
  loginBlockedNoticeSentAt?: string | null;
  finalNoticeSentAt?: string | null;
  startDate?: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  nextBillingAt?: string;
  cancelledAt?: string;
  expiresAt?: string;
  notes?: string;
  payments?: PremiumSubscriptionPayment[];
}

export interface PremiumStatusResponse {
  isPremium: boolean;
  isArchived?: boolean;
  currentFlatCount: number;
  includedFlatCount: number;
  scheduledFlatCount?: number | null;
  scheduledAmountPaise?: number | null;
  scheduledChangeAt?: string | null;
  limit: {
    reached: boolean;
    reason: 'NONE' | 'FREE_TIER' | 'PREMIUM_CAPACITY';
    minimumRequiredFlatCount: number;
    remainingFlatSlots: number;
  };
  pricing: {
    amountPerFlatPaise: number;
    amountPerFlat: number;
    currency: string;
  };
  preview: {
    lockedFlatCount: number;
    amountPaise: number;
    amount: number;
    currency: string;
    message: string;
  };
  overdue: {
    isOverdue: boolean;
    stage: 'CURRENT' | 'WARNING' | 'OVERDUE_RECOVERY' | 'ROLE_LOGIN_BLOCKED' | 'ARCHIVED';
    overdueStartedAt?: string | null;
    warningEndsAt?: string | null;
    loginBlockedAt?: string | null;
    archiveAt?: string | null;
    daysOverdue: number;
    adminCanRecover: boolean;
    message?: string | null;
  };
  activeSubscription?: PremiumSubscription | null;
  latestSubscription?: PremiumSubscription | null;
}
