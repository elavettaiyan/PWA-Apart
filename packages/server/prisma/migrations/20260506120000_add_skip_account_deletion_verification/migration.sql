ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "skipAccountDeletionVerification" BOOLEAN NOT NULL DEFAULT false;
