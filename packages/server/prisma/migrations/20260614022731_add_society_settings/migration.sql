-- CreateTable
CREATE TABLE "society_settings" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "lateFeeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "partialPaymentAllowed" BOOLEAN NOT NULL DEFAULT true,
    "advancePaymentAllowed" BOOLEAN NOT NULL DEFAULT true,
    "autoAdjustAdvance" BOOLEAN NOT NULL DEFAULT true,
    "forceOldestDueSettlement" BOOLEAN NOT NULL DEFAULT true,
    "manualBillSelection" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "society_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "society_settings_societyId_key" ON "society_settings"("societyId");

-- CreateIndex
CREATE INDEX "society_settings_societyId_idx" ON "society_settings"("societyId");

-- AddForeignKey
ALTER TABLE "society_settings" ADD CONSTRAINT "society_settings_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
