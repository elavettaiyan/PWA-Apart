ALTER TABLE "societies"
ADD COLUMN "hadPremiumSubscription" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "premiumArchivedAt" TIMESTAMP(3),
ADD COLUMN "premiumArchiveReason" TEXT;

ALTER TABLE "premium_subscriptions"
ADD COLUMN "overdueStartedAt" TIMESTAMP(3),
ADD COLUMN "warningNoticeSentAt" TIMESTAMP(3),
ADD COLUMN "loginBlockedNoticeSentAt" TIMESTAMP(3),
ADD COLUMN "finalNoticeSentAt" TIMESTAMP(3);

UPDATE "societies"
SET "hadPremiumSubscription" = true
WHERE id IN (
  SELECT DISTINCT "societyId"
  FROM "premium_subscriptions"
  WHERE status IN ('ACTIVE', 'HALTED', 'CANCELLED', 'COMPLETED', 'FAILED')
);