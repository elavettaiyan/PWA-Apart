-- ============================================================
-- RUN THIS IN SUPABASE SQL EDITOR
-- Step 1: Drop old tables from previous project
-- Step 2: Create all ApartEase tables
-- ============================================================

-- STEP 1: Drop old tables
DROP TABLE IF EXISTS "MaintenanceRequest" CASCADE;
DROP TABLE IF EXISTS "Announcement" CASCADE;
DROP TABLE IF EXISTS "Apartment" CASCADE;
DROP TABLE IF EXISTS "Payment" CASCADE;
DROP TABLE IF EXISTS "User" CASCADE;

-- STEP 2: Create enums
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'OWNER', 'TENANT');
CREATE TYPE "FlatType" AS ENUM ('ONE_BHK', 'TWO_BHK', 'THREE_BHK', 'FOUR_BHK', 'STUDIO', 'PENTHOUSE', 'SHOP', 'OTHER');
CREATE TYPE "BillStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'OVERDUE');
CREATE TYPE "PaymentStatus" AS ENUM ('INITIATED', 'SUCCESS', 'FAILED', 'REFUNDED');
CREATE TYPE "PaymentMethod" AS ENUM ('PHONEPE', 'CASH', 'CHEQUE', 'BANK_TRANSFER', 'UPI_OTHER');
CREATE TYPE "PaymentGateway" AS ENUM ('PHONEPE');
CREATE TYPE "PaymentGatewayEnv" AS ENUM ('UAT', 'PRODUCTION');
CREATE TYPE "ComplaintStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REJECTED');
CREATE TYPE "ComplaintPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE "ExpenseCategory" AS ENUM ('MAINTENANCE', 'REPAIR', 'SALARY', 'ELECTRICITY', 'WATER', 'SECURITY', 'CLEANING', 'GARDENING', 'LIFT', 'SINKING_FUND', 'INSURANCE', 'LEGAL', 'EVENTS', 'OTHER');

-- STEP 3: Create tables
CREATE TABLE "societies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "registrationNo" TEXT,
    "totalBlocks" INTEGER NOT NULL DEFAULT 1,
    "totalFlats" INTEGER NOT NULL DEFAULT 0,
    "logo" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "societies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "blocks" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "floors" INTEGER NOT NULL DEFAULT 1,
    "societyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "blocks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "flats" (
    "id" TEXT NOT NULL,
    "flatNumber" TEXT NOT NULL,
    "floor" INTEGER NOT NULL,
    "type" "FlatType" NOT NULL DEFAULT 'TWO_BHK',
    "areaSqFt" DOUBLE PRECISION,
    "blockId" TEXT NOT NULL,
    "isOccupied" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "flats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "owners" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "altPhone" TEXT,
    "aadharNo" TEXT,
    "panNo" TEXT,
    "flatId" TEXT NOT NULL,
    "moveInDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,
    CONSTRAINT "owners_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "altPhone" TEXT,
    "aadharNo" TEXT,
    "flatId" TEXT NOT NULL,
    "leaseStart" TIMESTAMP(3) NOT NULL,
    "leaseEnd" TIMESTAMP(3),
    "rentAmount" DOUBLE PRECISION,
    "deposit" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,
    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "role" "Role" NOT NULL DEFAULT 'OWNER',
    "societyId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "maintenance_configs" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "flatType" "FlatType" NOT NULL,
    "baseAmount" DOUBLE PRECISION NOT NULL,
    "waterCharge" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "parkingCharge" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sinkingFund" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "repairFund" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "otherCharges" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lateFeePerDay" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dueDay" INTEGER NOT NULL DEFAULT 10,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "maintenance_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "maintenance_bills" (
    "id" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "baseAmount" DOUBLE PRECISION NOT NULL,
    "waterCharge" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "parkingCharge" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sinkingFund" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "repairFund" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "otherCharges" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lateFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "BillStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "maintenance_bills_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'PHONEPE',
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "transactionId" TEXT,
    "merchantTransId" TEXT,
    "phonepeResponse" TEXT,
    "receiptNo" TEXT,
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "complaints" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "flatId" TEXT,
    "createdById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" "ComplaintPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "ComplaintStatus" NOT NULL DEFAULT 'OPEN',
    "images" TEXT NOT NULL DEFAULT '[]',
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "complaint_comments" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "complaint_comments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,
    "vendor" TEXT,
    "receiptUrl" TEXT,
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "association_bylaws" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "penaltyAmount" DOUBLE PRECISION,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "association_bylaws_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_gateway_configs" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "gateway" "PaymentGateway" NOT NULL DEFAULT 'PHONEPE',
    "merchantId" TEXT NOT NULL,
    "saltKey" TEXT NOT NULL,
    "saltIndex" INTEGER NOT NULL DEFAULT 1,
    "environment" "PaymentGatewayEnv" NOT NULL DEFAULT 'UAT',
    "baseUrl" TEXT NOT NULL DEFAULT 'https://api-preprod.phonepe.com/apis/pg-sandbox',
    "redirectUrl" TEXT NOT NULL DEFAULT 'http://localhost:5173/billing?payment=done',
    "callbackUrl" TEXT NOT NULL DEFAULT 'http://localhost:4000/api/payments/phonepe/callback',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payment_gateway_configs_pkey" PRIMARY KEY ("id")
);

-- STEP 4: Create indexes
CREATE UNIQUE INDEX "societies_registrationNo_key" ON "societies"("registrationNo");
CREATE INDEX "blocks_societyId_idx" ON "blocks"("societyId");
CREATE INDEX "flats_blockId_idx" ON "flats"("blockId");
CREATE UNIQUE INDEX "flats_flatNumber_blockId_key" ON "flats"("flatNumber", "blockId");
CREATE UNIQUE INDEX "owners_flatId_key" ON "owners"("flatId");
CREATE UNIQUE INDEX "owners_userId_key" ON "owners"("userId");
CREATE UNIQUE INDEX "tenants_flatId_key" ON "tenants"("flatId");
CREATE UNIQUE INDEX "tenants_userId_key" ON "tenants"("userId");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_societyId_idx" ON "users"("societyId");
CREATE INDEX "maintenance_configs_societyId_idx" ON "maintenance_configs"("societyId");
CREATE UNIQUE INDEX "maintenance_configs_societyId_flatType_isActive_key" ON "maintenance_configs"("societyId", "flatType", "isActive");
CREATE INDEX "maintenance_bills_flatId_idx" ON "maintenance_bills"("flatId");
CREATE UNIQUE INDEX "maintenance_bills_flatId_month_year_key" ON "maintenance_bills"("flatId", "month", "year");
CREATE UNIQUE INDEX "payments_transactionId_key" ON "payments"("transactionId");
CREATE UNIQUE INDEX "payments_merchantTransId_key" ON "payments"("merchantTransId");
CREATE INDEX "payments_billId_idx" ON "payments"("billId");
CREATE INDEX "complaints_societyId_idx" ON "complaints"("societyId");
CREATE INDEX "complaints_createdById_idx" ON "complaints"("createdById");
CREATE INDEX "complaint_comments_complaintId_idx" ON "complaint_comments"("complaintId");
CREATE INDEX "expenses_societyId_idx" ON "expenses"("societyId");
CREATE INDEX "association_bylaws_societyId_idx" ON "association_bylaws"("societyId");
CREATE INDEX "payment_gateway_configs_societyId_idx" ON "payment_gateway_configs"("societyId");
CREATE UNIQUE INDEX "payment_gateway_configs_societyId_gateway_key" ON "payment_gateway_configs"("societyId", "gateway");

-- STEP 5: Add foreign keys
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "flats" ADD CONSTRAINT "flats_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "owners" ADD CONSTRAINT "owners_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "owners" ADD CONSTRAINT "owners_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "maintenance_configs" ADD CONSTRAINT "maintenance_configs_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "maintenance_bills" ADD CONSTRAINT "maintenance_bills_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_billId_fkey" FOREIGN KEY ("billId") REFERENCES "maintenance_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "complaint_comments" ADD CONSTRAINT "complaint_comments_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "complaints"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "association_bylaws" ADD CONSTRAINT "association_bylaws_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_gateway_configs" ADD CONSTRAINT "payment_gateway_configs_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- STEP 6: Create Prisma migrations table so Prisma knows migrations are applied
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" VARCHAR(36) NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY ("id")
);

INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "finished_at", "applied_steps_count")
VALUES (gen_random_uuid(), 'manual', '20260310081244_init', now(), 1);
