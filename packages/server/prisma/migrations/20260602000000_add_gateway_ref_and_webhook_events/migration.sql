-- Add gatewayRefId (PhonePe providerReferenceId / UTR) to payments
ALTER TABLE "payments" ADD COLUMN "gatewayRefId" TEXT;
CREATE INDEX "payments_gateway_ref_id_idx" ON "payments"("gatewayRefId");

-- Create WebhookEvent idempotency log
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "merchantTransId" TEXT,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "webhook_events_source_eventKey_key" ON "webhook_events"("source", "eventKey");
CREATE INDEX "webhook_events_merchant_trans_id_idx" ON "webhook_events"("merchantTransId");
