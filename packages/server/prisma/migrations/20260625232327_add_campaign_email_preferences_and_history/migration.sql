-- AlterTable
ALTER TABLE "users" ADD COLUMN     "unsubscribedFromCampaignEmails" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "crm_campaign_history" (
    "id" TEXT NOT NULL,
    "performedById" TEXT NOT NULL,
    "targetMode" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "intendedRecipientCount" INTEGER NOT NULL,
    "recipientCount" INTEGER NOT NULL,
    "sentCount" INTEGER NOT NULL,
    "failedCount" INTEGER NOT NULL,
    "skippedCount" INTEGER NOT NULL,
    "skippedReason" TEXT,
    "requestedRecipients" TEXT,
    "failedRecipients" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_campaign_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_campaign_history_performedById_idx" ON "crm_campaign_history"("performedById");

-- CreateIndex
CREATE INDEX "crm_campaign_history_createdAt_idx" ON "crm_campaign_history"("createdAt");

-- AddForeignKey
ALTER TABLE "crm_campaign_history" ADD CONSTRAINT "crm_campaign_history_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
