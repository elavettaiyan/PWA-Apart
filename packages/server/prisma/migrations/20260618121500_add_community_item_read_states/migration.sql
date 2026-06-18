CREATE TABLE "community_item_read_states" (
    "itemType" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_item_read_states_pkey" PRIMARY KEY ("itemType", "itemId", "userId")
);

CREATE INDEX "community_item_read_states_userId_idx" ON "community_item_read_states"("userId");
CREATE INDEX "community_item_read_states_itemType_userId_readAt_idx" ON "community_item_read_states"("itemType", "userId", "readAt");

ALTER TABLE "community_item_read_states"
ADD CONSTRAINT "community_item_read_states_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
