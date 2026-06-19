CREATE TYPE "ComplaintActivityType" AS ENUM ('CREATED', 'STATUS_CHANGED', 'ASSIGNED', 'COMMENT_ADDED', 'RESOLUTION_ADDED');

CREATE TABLE "complaint_activities" (
  "id" TEXT NOT NULL,
  "complaintId" TEXT NOT NULL,
  "actorId" TEXT,
  "actorName" TEXT NOT NULL,
  "type" "ComplaintActivityType" NOT NULL,
  "message" TEXT NOT NULL,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "complaint_activities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "complaint_activities_complaintId_idx" ON "complaint_activities"("complaintId");
CREATE INDEX "complaint_activities_actorId_idx" ON "complaint_activities"("actorId");
CREATE INDEX "complaint_activities_complaintId_createdAt_idx" ON "complaint_activities"("complaintId", "createdAt");

ALTER TABLE "complaint_activities"
ADD CONSTRAINT "complaint_activities_complaintId_fkey"
FOREIGN KEY ("complaintId") REFERENCES "complaints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "complaint_activities"
ADD CONSTRAINT "complaint_activities_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "complaint_activities" ("id", "complaintId", "actorId", "actorName", "type", "message", "metadata", "createdAt")
SELECT
  gen_random_uuid()::text,
  c."id",
  c."createdById",
  COALESCE(u."name", 'Unknown User'),
  'CREATED'::"ComplaintActivityType",
  'Complaint created',
  json_build_object(
    'status', c."status",
    'priority', c."priority",
    'category', c."category"
  )::text,
  c."createdAt"
FROM "complaints" c
LEFT JOIN "users" u ON u."id" = c."createdById";