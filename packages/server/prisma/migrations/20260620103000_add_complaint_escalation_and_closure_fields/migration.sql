CREATE TYPE "ComplaintEscalationLevel" AS ENUM ('MANAGER', 'PRESIDENT');

ALTER TYPE "ComplaintActivityType" ADD VALUE 'ESCALATED';
ALTER TYPE "ComplaintActivityType" ADD VALUE 'CLOSURE_CONFIRMED';

ALTER TABLE "complaints"
ADD COLUMN "closureRequestedAt" TIMESTAMP(3),
ADD COLUMN "residentConfirmedAt" TIMESTAMP(3),
ADD COLUMN "closedAt" TIMESTAMP(3);

CREATE TABLE "complaint_escalations" (
  "id" TEXT NOT NULL,
  "complaintId" TEXT NOT NULL,
  "escalatedById" TEXT NOT NULL,
  "escalatedToId" TEXT NOT NULL,
  "targetLevel" "ComplaintEscalationLevel" NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "complaint_escalations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "complaint_escalations_complaintId_idx" ON "complaint_escalations"("complaintId");
CREATE INDEX "complaint_escalations_escalatedById_idx" ON "complaint_escalations"("escalatedById");
CREATE INDEX "complaint_escalations_escalatedToId_idx" ON "complaint_escalations"("escalatedToId");
CREATE INDEX "complaint_escalations_complaintId_createdAt_idx" ON "complaint_escalations"("complaintId", "createdAt");

ALTER TABLE "complaint_escalations"
ADD CONSTRAINT "complaint_escalations_complaintId_fkey"
FOREIGN KEY ("complaintId") REFERENCES "complaints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "complaint_escalations"
ADD CONSTRAINT "complaint_escalations_escalatedById_fkey"
FOREIGN KEY ("escalatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "complaint_escalations"
ADD CONSTRAINT "complaint_escalations_escalatedToId_fkey"
FOREIGN KEY ("escalatedToId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "complaints"
SET "closedAt" = "resolvedAt"
WHERE "status" = 'CLOSED' AND "closedAt" IS NULL;

UPDATE "complaints"
SET "residentConfirmedAt" = "closedAt"
WHERE "status" = 'CLOSED' AND "residentConfirmedAt" IS NULL;