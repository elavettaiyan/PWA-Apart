-- CreateTable
CREATE TABLE "push_notification_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "lastRegisteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_notification_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "push_notification_devices_userId_idx" ON "push_notification_devices"("userId");

-- CreateIndex
CREATE INDEX "push_notification_devices_societyId_idx" ON "push_notification_devices"("societyId");

-- CreateIndex
CREATE INDEX "push_notification_devices_token_idx" ON "push_notification_devices"("token");

-- CreateIndex
CREATE UNIQUE INDEX "push_notification_devices_userId_societyId_token_key" ON "push_notification_devices"("userId", "societyId", "token");

-- AddForeignKey
ALTER TABLE "push_notification_devices" ADD CONSTRAINT "push_notification_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_notification_devices" ADD CONSTRAINT "push_notification_devices_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;