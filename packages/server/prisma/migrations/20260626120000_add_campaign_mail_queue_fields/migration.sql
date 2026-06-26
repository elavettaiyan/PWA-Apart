-- Add queued campaign mail processing fields
CREATE TYPE "CampaignMailStatus" AS ENUM (
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'COMPLETED_WITH_ERRORS',
  'FAILED'
);

ALTER TABLE "crm_campaign_history"
ADD COLUMN "status" "CampaignMailStatus" NOT NULL DEFAULT 'COMPLETED',
ADD COLUMN "resolvedRecipients" TEXT,
ADD COLUMN "processingStartedAt" TIMESTAMP(3),
ADD COLUMN "completedAt" TIMESTAMP(3),
ADD COLUMN "lastErrorMessage" TEXT;

UPDATE "crm_campaign_history"
SET
  "status" = CASE
    WHEN "failedCount" > 0 THEN 'COMPLETED_WITH_ERRORS'::"CampaignMailStatus"
    ELSE 'COMPLETED'::"CampaignMailStatus"
  END,
  "resolvedRecipients" = COALESCE("requestedRecipients", '[]'),
  "completedAt" = "createdAt";

CREATE INDEX "crm_campaign_history_status_createdAt_idx"
ON "crm_campaign_history"("status", "createdAt");
