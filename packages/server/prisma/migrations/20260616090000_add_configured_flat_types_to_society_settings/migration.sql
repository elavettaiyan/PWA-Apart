ALTER TABLE "society_settings"
ADD COLUMN "configuredFlatTypes" "FlatType"[] DEFAULT ARRAY[]::"FlatType"[];

UPDATE "society_settings"
SET "configuredFlatTypes" = ARRAY[]::"FlatType"[]
WHERE "configuredFlatTypes" IS NULL;

ALTER TABLE "society_settings"
ALTER COLUMN "configuredFlatTypes" SET NOT NULL;