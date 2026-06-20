CREATE TABLE "late_fee_job_runs" (
  "id" TEXT NOT NULL,
  "societyId" TEXT NOT NULL,
  "triggerSource" TEXT NOT NULL,
  "triggeredByUserId" TEXT,
  "success" BOOLEAN NOT NULL DEFAULT true,
  "billsScannedCount" INTEGER NOT NULL DEFAULT 0,
  "updatedBillsCount" INTEGER NOT NULL DEFAULT 0,
  "failedBillsCount" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "late_fee_job_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "late_fee_job_runs_societyId_startedAt_idx" ON "late_fee_job_runs"("societyId", "startedAt");
CREATE INDEX "late_fee_job_runs_triggeredByUserId_idx" ON "late_fee_job_runs"("triggeredByUserId");
CREATE INDEX "late_fee_job_runs_success_idx" ON "late_fee_job_runs"("success");

ALTER TABLE "late_fee_job_runs"
ADD CONSTRAINT "late_fee_job_runs_societyId_fkey"
FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "late_fee_job_runs"
ADD CONSTRAINT "late_fee_job_runs_triggeredByUserId_fkey"
FOREIGN KEY ("triggeredByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;