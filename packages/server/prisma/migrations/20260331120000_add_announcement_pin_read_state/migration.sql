-- AlterTable
ALTER TABLE "announcement_broadcasts"
ADD COLUMN "isPinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "pinnedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "announcement_read_states" (
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_read_states_pkey" PRIMARY KEY ("announcementId","userId")
);

-- CreateIndex
CREATE INDEX "announcement_broadcasts_societyId_isPinned_createdAt_idx" ON "announcement_broadcasts"("societyId", "isPinned", "createdAt");

-- CreateIndex
CREATE INDEX "announcement_read_states_userId_idx" ON "announcement_read_states"("userId");

-- AddForeignKey
ALTER TABLE "announcement_read_states" ADD CONSTRAINT "announcement_read_states_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "announcement_broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_read_states" ADD CONSTRAINT "announcement_read_states_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;