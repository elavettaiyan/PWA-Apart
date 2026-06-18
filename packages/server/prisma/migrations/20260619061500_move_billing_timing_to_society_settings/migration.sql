ALTER TABLE "society_settings"
ADD COLUMN "lateFeeMode" "LateFeeMode" NOT NULL DEFAULT 'PER_DAY',
ADD COLUMN "gracePeriodDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "dueDay" INTEGER NOT NULL DEFAULT 10;

UPDATE "society_settings" ss
SET
  "lateFeeMode" = mc."lateFeeMode",
  "gracePeriodDays" = mc."gracePeriodDays",
  "dueDay" = mc."dueDay"
FROM (
  SELECT DISTINCT ON ("societyId")
    "societyId",
    "lateFeeMode",
    "gracePeriodDays",
    "dueDay"
  FROM "maintenance_configs"
  WHERE "isActive" = true
  ORDER BY "societyId", "effectiveFrom" DESC, "createdAt" DESC
) mc
WHERE ss."societyId" = mc."societyId";

ALTER TABLE "maintenance_configs"
DROP COLUMN "lateFeeMode",
DROP COLUMN "gracePeriodDays",
DROP COLUMN "dueDay";