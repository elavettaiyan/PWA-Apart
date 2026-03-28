-- CreateEnum
CREATE TYPE "VisitorStatus" AS ENUM ('ACTIVE', 'LEFT');

-- CreateEnum
CREATE TYPE "DeliveryType" AS ENUM ('COURIER', 'FOOD', 'GROCERY', 'MEDICINE', 'PARCEL', 'OTHER');

-- CreateTable
CREATE TABLE "visitors" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "capturedByUserId" TEXT NOT NULL,
    "visitorName" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "vehicleNumber" TEXT,
    "purpose" TEXT NOT NULL,
    "notes" TEXT,
    "photoUrl" TEXT,
    "status" "VisitorStatus" NOT NULL DEFAULT 'ACTIVE',
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "capturedByUserId" TEXT NOT NULL,
    "deliveryType" "DeliveryType" NOT NULL,
    "deliveryPersonName" TEXT NOT NULL,
    "mobile" TEXT,
    "companyName" TEXT,
    "vehicleNumber" TEXT,
    "notes" TEXT,
    "photoUrl" TEXT,
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visitors_societyId_idx" ON "visitors"("societyId");

-- CreateIndex
CREATE INDEX "visitors_flatId_idx" ON "visitors"("flatId");

-- CreateIndex
CREATE INDEX "visitors_capturedByUserId_idx" ON "visitors"("capturedByUserId");

-- CreateIndex
CREATE INDEX "visitors_societyId_status_idx" ON "visitors"("societyId", "status");

-- CreateIndex
CREATE INDEX "visitors_checkedInAt_idx" ON "visitors"("checkedInAt");

-- CreateIndex
CREATE INDEX "deliveries_societyId_idx" ON "deliveries"("societyId");

-- CreateIndex
CREATE INDEX "deliveries_flatId_idx" ON "deliveries"("flatId");

-- CreateIndex
CREATE INDEX "deliveries_capturedByUserId_idx" ON "deliveries"("capturedByUserId");

-- CreateIndex
CREATE INDEX "deliveries_societyId_deliveryType_idx" ON "deliveries"("societyId", "deliveryType");

-- CreateIndex
CREATE INDEX "deliveries_deliveredAt_idx" ON "deliveries"("deliveredAt");

-- AddForeignKey
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_capturedByUserId_fkey" FOREIGN KEY ("capturedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_capturedByUserId_fkey" FOREIGN KEY ("capturedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;