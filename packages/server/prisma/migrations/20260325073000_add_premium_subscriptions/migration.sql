-- CreateEnum
CREATE TYPE "PremiumSubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'HALTED', 'CANCELLED', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "premium_subscriptions" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "status" "PremiumSubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "providerStatus" TEXT,
    "lockedFlatCount" INTEGER NOT NULL,
    "amountPerFlatPaise" INTEGER NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "razorpayPlanId" TEXT,
    "razorpaySubscriptionId" TEXT,
    "startDate" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "nextBillingAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "premium_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "premium_subscription_payments" (
    "id" TEXT NOT NULL,
    "premiumSubscriptionId" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "razorpayPaymentId" TEXT,
    "razorpayInvoiceId" TEXT,
    "razorpayOrderId" TEXT,
    "failureReason" TEXT,
    "rawPayload" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "premium_subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "premium_subscriptions_razorpaySubscriptionId_key" ON "premium_subscriptions"("razorpaySubscriptionId");

-- CreateIndex
CREATE INDEX "premium_subscriptions_societyId_idx" ON "premium_subscriptions"("societyId");

-- CreateIndex
CREATE INDEX "premium_subscriptions_societyId_status_idx" ON "premium_subscriptions"("societyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "premium_subscription_payments_razorpayPaymentId_key" ON "premium_subscription_payments"("razorpayPaymentId");

-- CreateIndex
CREATE INDEX "premium_subscription_payments_premiumSubscriptionId_idx" ON "premium_subscription_payments"("premiumSubscriptionId");

-- CreateIndex
CREATE INDEX "premium_subscription_payments_razorpayInvoiceId_idx" ON "premium_subscription_payments"("razorpayInvoiceId");

-- AddForeignKey
ALTER TABLE "premium_subscriptions" ADD CONSTRAINT "premium_subscriptions_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "premium_subscription_payments" ADD CONSTRAINT "premium_subscription_payments_premiumSubscriptionId_fkey" FOREIGN KEY ("premiumSubscriptionId") REFERENCES "premium_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;