-- Add explicit accounting period fields for finance reporting.
ALTER TABLE "expenses"
ADD COLUMN "accountingMonth" INTEGER,
ADD COLUMN "accountingYear" INTEGER;

UPDATE "expenses"
SET
  "accountingMonth" = EXTRACT(MONTH FROM "expenseDate")::INTEGER,
  "accountingYear" = EXTRACT(YEAR FROM "expenseDate")::INTEGER
WHERE "accountingMonth" IS NULL OR "accountingYear" IS NULL;

ALTER TABLE "expenses"
ALTER COLUMN "accountingMonth" SET NOT NULL,
ALTER COLUMN "accountingYear" SET NOT NULL;

CREATE INDEX "expenses_societyId_accountingYear_accountingMonth_idx"
ON "expenses"("societyId", "accountingYear", "accountingMonth");
