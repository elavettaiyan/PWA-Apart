-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('LIFT', 'WATER_TANK', 'TOILET', 'AUDITORIUM', 'SEPTIC_TANK', 'GARDEN', 'GENERATOR', 'PUMP', 'FIRE_SAFETY', 'OTHER');

-- CreateEnum
CREATE TYPE "ServiceFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ServiceJobStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'POSTPONED', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "ServiceJobPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AssetType" NOT NULL,
    "location" TEXT,
    "blockId" TEXT,
    "description" TEXT,
    "installationDate" TIMESTAMP(3),
    "vendor" TEXT,
    "serviceContact" TEXT,
    "periodicServiceRequired" BOOLEAN NOT NULL DEFAULT false,
    "serviceFrequency" "ServiceFrequency",
    "serviceIntervalDays" INTEGER,
    "lastServiceDate" TIMESTAMP(3),
    "nextServiceDate" TIMESTAMP(3),
    "serviceVendor" TEXT,
    "serviceCost" DOUBLE PRECISION,
    "serviceNotes" TEXT,
    "images" TEXT NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastReminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_jobs" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "jobType" TEXT NOT NULL DEFAULT 'Periodic Service',
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "assignedTo" TEXT,
    "assignedToUserId" TEXT,
    "priority" "ServiceJobPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "ServiceJobStatus" NOT NULL DEFAULT 'PENDING',
    "remarks" TEXT,
    "completedDate" TIMESTAMP(3),
    "images" TEXT NOT NULL DEFAULT '[]',
    "invoiceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_history" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "serviceDate" TIMESTAMP(3) NOT NULL,
    "vendor" TEXT,
    "notes" TEXT,
    "cost" DOUBLE PRECISION,
    "images" TEXT NOT NULL DEFAULT '[]',
    "invoiceUrl" TEXT,
    "jobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assets_societyId_idx" ON "assets"("societyId");

-- CreateIndex
CREATE INDEX "assets_societyId_type_idx" ON "assets"("societyId", "type");

-- CreateIndex
CREATE INDEX "assets_societyId_blockId_idx" ON "assets"("societyId", "blockId");

-- CreateIndex
CREATE INDEX "assets_societyId_nextServiceDate_idx" ON "assets"("societyId", "nextServiceDate");

-- CreateIndex
CREATE INDEX "assets_societyId_isActive_idx" ON "assets"("societyId", "isActive");

-- CreateIndex
CREATE INDEX "service_jobs_societyId_idx" ON "service_jobs"("societyId");

-- CreateIndex
CREATE INDEX "service_jobs_assetId_idx" ON "service_jobs"("assetId");

-- CreateIndex
CREATE INDEX "service_jobs_societyId_status_idx" ON "service_jobs"("societyId", "status");

-- CreateIndex
CREATE INDEX "service_jobs_societyId_scheduledDate_idx" ON "service_jobs"("societyId", "scheduledDate");

-- CreateIndex
CREATE INDEX "service_history_assetId_idx" ON "service_history"("assetId");

-- CreateIndex
CREATE INDEX "service_history_assetId_serviceDate_idx" ON "service_history"("assetId", "serviceDate");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "blocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_jobs" ADD CONSTRAINT "service_jobs_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_jobs" ADD CONSTRAINT "service_jobs_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_jobs" ADD CONSTRAINT "service_jobs_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_history" ADD CONSTRAINT "service_history_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_history" ADD CONSTRAINT "service_history_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_history" ADD CONSTRAINT "service_history_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "service_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
