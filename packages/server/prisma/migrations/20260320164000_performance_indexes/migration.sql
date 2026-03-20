CREATE INDEX IF NOT EXISTS "blocks_societyId_name_idx" ON "blocks"("societyId", "name");

CREATE INDEX IF NOT EXISTS "flats_blockId_isOccupied_idx" ON "flats"("blockId", "isOccupied");

CREATE INDEX IF NOT EXISTS "owners_userId_idx" ON "owners"("userId");
CREATE INDEX IF NOT EXISTS "owners_email_idx" ON "owners"("email");

CREATE INDEX IF NOT EXISTS "tenants_userId_idx" ON "tenants"("userId");
CREATE INDEX IF NOT EXISTS "tenants_email_idx" ON "tenants"("email");

CREATE INDEX IF NOT EXISTS "users_activeSocietyId_idx" ON "users"("activeSocietyId");

CREATE INDEX IF NOT EXISTS "maintenance_bills_flatId_status_idx" ON "maintenance_bills"("flatId", "status");
CREATE INDEX IF NOT EXISTS "maintenance_bills_year_month_idx" ON "maintenance_bills"("year", "month");
CREATE INDEX IF NOT EXISTS "maintenance_bills_status_idx" ON "maintenance_bills"("status");
CREATE INDEX IF NOT EXISTS "maintenance_bills_dueDate_idx" ON "maintenance_bills"("dueDate");

CREATE INDEX IF NOT EXISTS "payments_status_paidAt_idx" ON "payments"("status", "paidAt");
CREATE INDEX IF NOT EXISTS "payments_notes_idx" ON "payments"("notes");

CREATE INDEX IF NOT EXISTS "complaints_societyId_status_idx" ON "complaints"("societyId", "status");
CREATE INDEX IF NOT EXISTS "complaints_createdById_status_idx" ON "complaints"("createdById", "status");

CREATE INDEX IF NOT EXISTS "expenses_societyId_expenseDate_idx" ON "expenses"("societyId", "expenseDate");
CREATE INDEX IF NOT EXISTS "expenses_societyId_category_idx" ON "expenses"("societyId", "category");