ALTER TYPE "LateFeeMode" ADD VALUE IF NOT EXISTS 'RECURRING';

CREATE TYPE "RecurringLateFeeFrequency" AS ENUM ('DAILY', 'MONTHLY');

ALTER TABLE "maintenance_configs"
ADD COLUMN "recurringLateFeeAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "society_settings"
ADD COLUMN "recurringLateFeeFrequency" "RecurringLateFeeFrequency" NOT NULL DEFAULT 'MONTHLY';

ALTER TABLE "maintenance_bills"
ADD COLUMN "lateFeeEnabledSnapshot" BOOLEAN,
ADD COLUMN "lateFeeModeSnapshot" "LateFeeMode",
ADD COLUMN "recurringLateFeeFrequencySnapshot" "RecurringLateFeeFrequency",
ADD COLUMN "lateFeePerDaySnapshot" DOUBLE PRECISION,
ADD COLUMN "lateFeeAmountSnapshot" DOUBLE PRECISION,
ADD COLUMN "recurringLateFeeAmountSnapshot" DOUBLE PRECISION,
ADD COLUMN "gracePeriodDaysSnapshot" INTEGER;