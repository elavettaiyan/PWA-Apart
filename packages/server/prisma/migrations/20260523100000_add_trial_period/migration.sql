-- AlterTable
ALTER TABLE "societies" ADD COLUMN "trialStartedAt" TIMESTAMP(3),
ADD COLUMN "trialEndsAt" TIMESTAMP(3);

-- Backfill existing societies: give them a trial that already started at creation
-- and ended 30 days later (so they don't suddenly get a trial popup)
UPDATE "societies"
SET "trialStartedAt" = "createdAt",
    "trialEndsAt"    = "createdAt" + INTERVAL '30 days'
WHERE "trialStartedAt" IS NULL;
