-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalActionType" AS ENUM ('TENANT_REGISTRATION', 'TENANT_PROFILE_CHANGE');

-- CreateEnum
CREATE TYPE "ApprovalAuditAction" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "approval_configs" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "actionType" "ApprovalActionType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "approverRoles" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "actionType" "ApprovalActionType" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "rejectedById" TEXT,
    "flatId" TEXT,
    "tenantId" TEXT,
    "relatedUserId" TEXT,
    "requesterComment" TEXT,
    "decisionComment" TEXT,
    "pendingData" JSONB NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_audit_logs" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "action" "ApprovalAuditAction" NOT NULL,
    "actorId" TEXT,
    "comment" TEXT,
    "snapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "approval_configs_societyId_actionType_key" ON "approval_configs"("societyId", "actionType");

-- CreateIndex
CREATE INDEX "approval_configs_societyId_idx" ON "approval_configs"("societyId");

-- CreateIndex
CREATE INDEX "approval_requests_societyId_idx" ON "approval_requests"("societyId");

-- CreateIndex
CREATE INDEX "approval_requests_status_idx" ON "approval_requests"("status");

-- CreateIndex
CREATE INDEX "approval_requests_actionType_idx" ON "approval_requests"("actionType");

-- CreateIndex
CREATE INDEX "approval_requests_requestedById_idx" ON "approval_requests"("requestedById");

-- CreateIndex
CREATE INDEX "approval_requests_approvedById_idx" ON "approval_requests"("approvedById");

-- CreateIndex
CREATE INDEX "approval_requests_rejectedById_idx" ON "approval_requests"("rejectedById");

-- CreateIndex
CREATE INDEX "approval_requests_flatId_idx" ON "approval_requests"("flatId");

-- CreateIndex
CREATE INDEX "approval_requests_tenantId_idx" ON "approval_requests"("tenantId");

-- CreateIndex
CREATE INDEX "approval_requests_societyId_status_createdAt_idx" ON "approval_requests"("societyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "approval_audit_logs_approvalRequestId_idx" ON "approval_audit_logs"("approvalRequestId");

-- CreateIndex
CREATE INDEX "approval_audit_logs_actorId_idx" ON "approval_audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "approval_audit_logs_createdAt_idx" ON "approval_audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "approval_configs" ADD CONSTRAINT "approval_configs_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_relatedUserId_fkey" FOREIGN KEY ("relatedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_audit_logs" ADD CONSTRAINT "approval_audit_logs_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_audit_logs" ADD CONSTRAINT "approval_audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;