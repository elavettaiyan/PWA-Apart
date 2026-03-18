-- Add active society tracking to users
ALTER TABLE "users"
ADD COLUMN "activeSocietyId" TEXT;

-- Backfill active society with existing society association
UPDATE "users"
SET "activeSocietyId" = "societyId"
WHERE "activeSocietyId" IS NULL AND "societyId" IS NOT NULL;

-- Allow one user to be linked to multiple owner/tenant rows
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'owners_userId_key'
  ) THEN
    ALTER TABLE "owners" DROP CONSTRAINT "owners_userId_key";
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenants_userId_key'
  ) THEN
    ALTER TABLE "tenants" DROP CONSTRAINT "tenants_userId_key";
  END IF;
END $$;

-- User-to-society memberships (many-to-many)
CREATE TABLE "user_society_memberships" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "societyId" TEXT NOT NULL,
  "role" "Role" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_society_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_society_memberships_userId_societyId_key"
  ON "user_society_memberships"("userId", "societyId");

CREATE INDEX "user_society_memberships_societyId_idx"
  ON "user_society_memberships"("societyId");

ALTER TABLE "user_society_memberships"
ADD CONSTRAINT "user_society_memberships_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_society_memberships"
ADD CONSTRAINT "user_society_memberships_societyId_fkey"
FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill memberships from existing users.societyId
INSERT INTO "user_society_memberships" ("id", "userId", "societyId", "role", "createdAt")
SELECT md5(random()::text || clock_timestamp()::text || "id"), "id", "societyId", "role", CURRENT_TIMESTAMP
FROM "users"
WHERE "societyId" IS NOT NULL
ON CONFLICT ("userId", "societyId") DO NOTHING;
