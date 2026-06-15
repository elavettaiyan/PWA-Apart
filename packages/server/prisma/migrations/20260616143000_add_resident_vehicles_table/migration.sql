CREATE TYPE "VehicleType" AS ENUM ('TWO_WHEELER', 'THREE_WHEELER', 'FOUR_WHEELER');

CREATE TABLE "resident_vehicles" (
    "id" TEXT NOT NULL,
    "type" "VehicleType" NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "ownerId" TEXT,
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resident_vehicles_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "resident_vehicles_ownerId_idx" ON "resident_vehicles"("ownerId");
CREATE INDEX "resident_vehicles_tenantId_idx" ON "resident_vehicles"("tenantId");
CREATE INDEX "resident_vehicles_registrationNumber_idx" ON "resident_vehicles"("registrationNumber");

ALTER TABLE "resident_vehicles"
ADD CONSTRAINT "resident_vehicles_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "resident_vehicles"
ADD CONSTRAINT "resident_vehicles_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
