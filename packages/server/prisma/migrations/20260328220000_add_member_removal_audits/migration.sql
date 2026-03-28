-- CreateTable
CREATE TABLE "member_removal_audits" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "targetUserId" TEXT,
    "targetRole" TEXT NOT NULL,
    "deletedByUserId" TEXT NOT NULL,
    "deletedByRole" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "ownerId" TEXT,
    "tenantId" TEXT,
    "flatId" TEXT,
    "snapshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_removal_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "member_removal_audits_societyId_idx" ON "member_removal_audits"("societyId");

-- CreateIndex
CREATE INDEX "member_removal_audits_targetUserId_idx" ON "member_removal_audits"("targetUserId");

-- CreateIndex
CREATE INDEX "member_removal_audits_deletedByUserId_idx" ON "member_removal_audits"("deletedByUserId");

-- AddForeignKey
ALTER TABLE "member_removal_audits" ADD CONSTRAINT "member_removal_audits_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;