/*
  Warnings:

  - A unique constraint covering the columns `[flatId]` on the table `advance_balances` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "BillKind" AS ENUM ('MAINTENANCE', 'OPENING_BALANCE', 'SPECIAL');

-- CreateEnum
CREATE TYPE "BillLineItemCategory" AS ENUM ('MAINTENANCE_COMPONENT', 'OPENING_BALANCE', 'FINE', 'DAMAGE', 'COMMON_ITEM_BREAKAGE', 'OTHER');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'ADVANCE';

-- DropIndex
DROP INDEX "maintenance_bills_flatId_month_year_key";

-- AlterTable
ALTER TABLE "maintenance_bills" ADD COLUMN     "appliesToMonth" INTEGER,
ADD COLUMN     "appliesToYear" INTEGER,
ADD COLUMN     "billKind" "BillKind" NOT NULL DEFAULT 'MAINTENANCE',
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "title" TEXT,
ALTER COLUMN "month" DROP NOT NULL,
ALTER COLUMN "year" DROP NOT NULL;

-- CreateTable
CREATE TABLE "maintenance_bill_line_items" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" "BillLineItemCategory" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_bill_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "maintenance_bill_line_items_billId_sortOrder_idx" ON "maintenance_bill_line_items"("billId", "sortOrder");

-- CreateIndex
CREATE INDEX "maintenance_bill_line_items_category_idx" ON "maintenance_bill_line_items"("category");

-- CreateIndex
CREATE UNIQUE INDEX "advance_balances_flatId_key" ON "advance_balances"("flatId");

-- CreateIndex
CREATE INDEX "maintenance_bills_flatId_billKind_idx" ON "maintenance_bills"("flatId", "billKind");

-- AddForeignKey
ALTER TABLE "maintenance_bill_line_items" ADD CONSTRAINT "maintenance_bill_line_items_billId_fkey" FOREIGN KEY ("billId") REFERENCES "maintenance_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;
