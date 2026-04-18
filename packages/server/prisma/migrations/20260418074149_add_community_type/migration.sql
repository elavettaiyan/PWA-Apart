-- CreateEnum
CREATE TYPE "CommunityType" AS ENUM ('APARTMENT', 'VILLA', 'GATED_COMMUNITY', 'TOWNSHIP');

-- AlterTable
ALTER TABLE "societies" ADD COLUMN     "communityType" "CommunityType" NOT NULL DEFAULT 'APARTMENT',
ADD COLUMN     "totalUnits" INTEGER;
