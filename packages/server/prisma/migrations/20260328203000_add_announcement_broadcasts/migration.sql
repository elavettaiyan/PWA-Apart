-- CreateTable
CREATE TABLE "announcement_broadcasts" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "path" TEXT,
    "targetRoles" TEXT,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "announcement_broadcasts_societyId_idx" ON "announcement_broadcasts"("societyId");

-- CreateIndex
CREATE INDEX "announcement_broadcasts_createdById_idx" ON "announcement_broadcasts"("createdById");

-- AddForeignKey
ALTER TABLE "announcement_broadcasts" ADD CONSTRAINT "announcement_broadcasts_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_broadcasts" ADD CONSTRAINT "announcement_broadcasts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;