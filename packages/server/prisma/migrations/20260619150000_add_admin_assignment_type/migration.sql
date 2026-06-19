CREATE TYPE "AdminAssignmentType" AS ENUM ('TEMPORARY', 'PRESIDENT');

ALTER TABLE "user_society_memberships"
ADD COLUMN "adminAssignmentType" "AdminAssignmentType",
ADD COLUMN "adminAssignedAt" TIMESTAMP(3);

UPDATE "user_society_memberships"
SET
  "adminAssignmentType" = 'PRESIDENT',
  "adminAssignedAt" = COALESCE("createdAt", NOW())
WHERE "role" = 'ADMIN';