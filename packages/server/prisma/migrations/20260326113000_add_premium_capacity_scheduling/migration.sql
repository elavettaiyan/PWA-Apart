ALTER TABLE "premium_subscriptions"
ADD COLUMN "includedFlatCount" INTEGER,
ADD COLUMN "usesPerFlatQuantity" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "scheduledFlatCount" INTEGER,
ADD COLUMN "scheduledAmountPaise" INTEGER,
ADD COLUMN "scheduledChangeAt" TIMESTAMP(3),
ADD COLUMN "scheduledPlanId" TEXT;

UPDATE "premium_subscriptions"
SET "includedFlatCount" = "lockedFlatCount"
WHERE "includedFlatCount" IS NULL;

ALTER TABLE "premium_subscriptions"
ALTER COLUMN "includedFlatCount" SET NOT NULL;