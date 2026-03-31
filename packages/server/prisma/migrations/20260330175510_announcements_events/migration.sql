/*
  Warnings:

  - Added the required column `updatedAt` to the `announcement_broadcasts` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('SCHEDULED', 'CANCELLED', 'COMPLETED');

-- AlterTable
ALTER TABLE "announcement_broadcasts" ADD COLUMN     "images" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "society_events" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "place" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "status" "EventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "imageUrls" TEXT,
    "reminderMinutes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "society_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "society_event_reminders" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "reminderMinutesBefore" INTEGER NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "society_event_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "society_events_societyId_idx" ON "society_events"("societyId");

-- CreateIndex
CREATE INDEX "society_events_createdById_idx" ON "society_events"("createdById");

-- CreateIndex
CREATE INDEX "society_events_status_idx" ON "society_events"("status");

-- CreateIndex
CREATE INDEX "society_events_startAt_idx" ON "society_events"("startAt");

-- CreateIndex
CREATE INDEX "society_events_societyId_startAt_idx" ON "society_events"("societyId", "startAt");

-- CreateIndex
CREATE INDEX "society_event_reminders_eventId_idx" ON "society_event_reminders"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "society_event_reminders_eventId_reminderMinutesBefore_key" ON "society_event_reminders"("eventId", "reminderMinutesBefore");

-- AddForeignKey
ALTER TABLE "society_events" ADD CONSTRAINT "society_events_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "society_events" ADD CONSTRAINT "society_events_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "society_event_reminders" ADD CONSTRAINT "society_event_reminders_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "society_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
