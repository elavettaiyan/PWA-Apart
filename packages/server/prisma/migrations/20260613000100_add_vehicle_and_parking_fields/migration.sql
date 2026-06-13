CREATE TYPE "ParkingType" AS ENUM ('NONE', 'OPEN', 'COVERED');

ALTER TABLE "flats"
ADD COLUMN "parkingType" "ParkingType" NOT NULL DEFAULT 'NONE',
ADD COLUMN "parkingSlotNumber" TEXT;

ALTER TABLE "owners"
ADD COLUMN "carNumber" TEXT,
ADD COLUMN "twoWheelerNumber" TEXT;

ALTER TABLE "tenants"
ADD COLUMN "carNumber" TEXT,
ADD COLUMN "twoWheelerNumber" TEXT;