-- Add mustChangePassword, passwordResetToken, passwordResetExpiry to users table
-- Run this in Supabase SQL Editor

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordResetToken" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordResetExpiry" TIMESTAMP(3);

-- Add unique index on passwordResetToken
CREATE UNIQUE INDEX IF NOT EXISTS "users_passwordResetToken_key" ON "users"("passwordResetToken");
