CREATE TABLE "society_role_menu_configs" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "visibleMenuIds" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "society_role_menu_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "society_role_menu_configs_societyId_role_key" ON "society_role_menu_configs"("societyId", "role");
CREATE INDEX "society_role_menu_configs_societyId_idx" ON "society_role_menu_configs"("societyId");

ALTER TABLE "society_role_menu_configs"
ADD CONSTRAINT "society_role_menu_configs_societyId_fkey"
FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;