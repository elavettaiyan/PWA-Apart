CREATE UNIQUE INDEX "maintenance_bills_maintenance_month_unique"
ON "maintenance_bills"("flatId", "month", "year")
WHERE "billKind" = 'MAINTENANCE';

CREATE UNIQUE INDEX "maintenance_bills_opening_balance_flat_unique"
ON "maintenance_bills"("flatId")
WHERE "billKind" = 'OPENING_BALANCE';