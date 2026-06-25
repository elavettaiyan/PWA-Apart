-- CreateEnum
CREATE TYPE "SurveyStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "community_surveys" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "allowMultipleVotes" BOOLEAN NOT NULL DEFAULT false,
    "status" "SurveyStatus" NOT NULL DEFAULT 'OPEN',
    "closesAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_surveys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_survey_options" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_survey_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_survey_votes" (
    "surveyId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_survey_votes_pkey" PRIMARY KEY ("surveyId","optionId","userId")
);

-- CreateIndex
CREATE INDEX "community_surveys_societyId_idx" ON "community_surveys"("societyId");

-- CreateIndex
CREATE INDEX "community_surveys_createdById_idx" ON "community_surveys"("createdById");

-- CreateIndex
CREATE INDEX "community_surveys_societyId_status_closesAt_idx" ON "community_surveys"("societyId", "status", "closesAt");

-- CreateIndex
CREATE INDEX "community_survey_options_surveyId_idx" ON "community_survey_options"("surveyId");

-- CreateIndex
CREATE INDEX "community_survey_options_surveyId_sortOrder_idx" ON "community_survey_options"("surveyId", "sortOrder");

-- CreateIndex
CREATE INDEX "community_survey_votes_surveyId_idx" ON "community_survey_votes"("surveyId");

-- CreateIndex
CREATE INDEX "community_survey_votes_optionId_idx" ON "community_survey_votes"("optionId");

-- CreateIndex
CREATE INDEX "community_survey_votes_userId_idx" ON "community_survey_votes"("userId");

-- AddForeignKey
ALTER TABLE "community_surveys" ADD CONSTRAINT "community_surveys_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_surveys" ADD CONSTRAINT "community_surveys_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_survey_options" ADD CONSTRAINT "community_survey_options_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "community_surveys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_survey_votes" ADD CONSTRAINT "community_survey_votes_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "community_surveys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_survey_votes" ADD CONSTRAINT "community_survey_votes_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "community_survey_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_survey_votes" ADD CONSTRAINT "community_survey_votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
