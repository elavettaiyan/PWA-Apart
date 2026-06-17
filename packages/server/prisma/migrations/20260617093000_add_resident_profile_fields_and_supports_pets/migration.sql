ALTER TABLE "owners"
ADD COLUMN "occupation" TEXT,
ADD COLUMN "householdAdults" INTEGER,
ADD COLUMN "householdKids" INTEGER,
ADD COLUMN "householdSeniors" INTEGER,
ADD COLUMN "pets" TEXT;

ALTER TABLE "tenants"
ADD COLUMN "occupation" TEXT,
ADD COLUMN "householdAdults" INTEGER,
ADD COLUMN "householdKids" INTEGER,
ADD COLUMN "householdSeniors" INTEGER,
ADD COLUMN "pets" TEXT;

ALTER TABLE "society_settings"
ADD COLUMN "supportsPets" BOOLEAN NOT NULL DEFAULT false;