-- AlterTable
ALTER TABLE "societies" ADD COLUMN     "crmNotes" TEXT,
ADD COLUMN     "crmTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "premiumOverrideUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "crm_action_logs" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "performedById" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_action_logs_societyId_idx" ON "crm_action_logs"("societyId");

-- CreateIndex
CREATE INDEX "crm_action_logs_performedById_idx" ON "crm_action_logs"("performedById");

-- AddForeignKey
ALTER TABLE "crm_action_logs" ADD CONSTRAINT "crm_action_logs_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_action_logs" ADD CONSTRAINT "crm_action_logs_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
