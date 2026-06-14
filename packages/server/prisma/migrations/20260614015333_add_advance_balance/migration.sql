-- CreateTable
CREATE TABLE "advance_balances" (
    "id" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advance_balances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "advance_balances_flatId_idx" ON "advance_balances"("flatId");

-- CreateIndex
CREATE INDEX "advance_balances_societyId_idx" ON "advance_balances"("societyId");

-- AddForeignKey
ALTER TABLE "advance_balances" ADD CONSTRAINT "advance_balances_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
