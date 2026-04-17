ALTER TABLE "payment_gateway_configs"
ADD COLUMN "clientId" TEXT,
ADD COLUMN "clientSecret" TEXT,
ADD COLUMN "clientVersion" INTEGER NOT NULL DEFAULT 1;