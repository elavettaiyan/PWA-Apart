-- Add Razorpay as a selectable maintenance payment gateway.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'RAZORPAY';
ALTER TYPE "PaymentGateway" ADD VALUE IF NOT EXISTS 'RAZORPAY';

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "gatewayOrderId" TEXT,
  ADD COLUMN IF NOT EXISTS "gatewayPaymentId" TEXT,
  ADD COLUMN IF NOT EXISTS "gatewayResponse" TEXT;

ALTER TABLE "payment_gateway_configs"
  ADD COLUMN IF NOT EXISTS "keyId" TEXT,
  ADD COLUMN IF NOT EXISTS "keySecret" TEXT,
  ADD COLUMN IF NOT EXISTS "webhookSecret" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "payments_gatewayOrderId_key" ON "payments"("gatewayOrderId");
CREATE UNIQUE INDEX IF NOT EXISTS "payments_gatewayPaymentId_key" ON "payments"("gatewayPaymentId");
CREATE INDEX IF NOT EXISTS "payments_gatewayOrderId_idx" ON "payments"("gatewayOrderId");
CREATE INDEX IF NOT EXISTS "payments_gatewayPaymentId_idx" ON "payments"("gatewayPaymentId");