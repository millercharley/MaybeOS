-- ImpactOS response schema (IMP-05, IMP-08, IMP-09)
--
-- Generated 2026-08-12 with `prisma migrate diff`, so this is exactly what
-- Prisma expects — not hand-written SQL that merely looks equivalent.
--
-- WHY THIS FILE EXISTS
-- Schema in this project is synced with `prisma db push` rather than
-- `prisma migrate` (OPS-04), so there is no migrations folder for it to live
-- in. It is committed anyway because it has to be applied to production by
-- hand, and a migration nobody can review is worse than one nobody automated.
--
-- SAFE TO RUN ON PRODUCTION AS-IS. Verified against prod on 2026-08-12:
-- 0 rows in `surveys`, 0 in `survey_responses`, so both DROP COLUMNs and the
-- NOT NULL `windowId` touch nothing. Prod does hold 1 organization and 2 users;
-- this migration does not reference either table.
--
-- NOT SAFE on any database that already holds survey responses: the NOT NULL
-- `windowId` has nothing to backfill from. Dev hit exactly that, and was reset
-- and re-seeded rather than backfilled, because every row there comes from
-- `npm run db:seed`.
--
-- ORDER OF OPERATIONS: apply this BEFORE deploying the code that expects it.
-- Every ImpactOS endpoint queries these tables, so deploying first means 500s
-- until this runs.

-- CreateEnum
CREATE TYPE "SurveyQuestionType" AS ENUM ('SCALE', 'NUMBER', 'CHOICE', 'TEXT');

-- AlterTable
ALTER TABLE "survey_responses" DROP COLUMN "answers",
ADD COLUMN     "windowId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "surveys" DROP COLUMN "questions";

-- CreateTable
CREATE TABLE "survey_questions" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "text" TEXT NOT NULL,
    "type" "SurveyQuestionType" NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_windows" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "opensAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closesAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_answers" (
    "id" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "category" TEXT,
    "numericValue" DOUBLE PRECISION,
    "textValue" TEXT,
    "choiceValue" TEXT,

    CONSTRAINT "survey_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "survey_questions_surveyId_idx" ON "survey_questions"("surveyId");

-- CreateIndex
CREATE UNIQUE INDEX "survey_questions_surveyId_key_version_key" ON "survey_questions"("surveyId", "key", "version");

-- CreateIndex
CREATE INDEX "collection_windows_surveyId_idx" ON "collection_windows"("surveyId");

-- CreateIndex
CREATE UNIQUE INDEX "collection_windows_surveyId_label_key" ON "collection_windows"("surveyId", "label");

-- CreateIndex
CREATE INDEX "survey_answers_questionId_idx" ON "survey_answers"("questionId");

-- CreateIndex
CREATE INDEX "survey_answers_category_idx" ON "survey_answers"("category");

-- CreateIndex
CREATE UNIQUE INDEX "survey_answers_responseId_questionId_key" ON "survey_answers"("responseId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "survey_responses_windowId_userId_key" ON "survey_responses"("windowId", "userId");

-- AddForeignKey
ALTER TABLE "survey_questions" ADD CONSTRAINT "survey_questions_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_windows" ADD CONSTRAINT "collection_windows_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "collection_windows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_answers" ADD CONSTRAINT "survey_answers_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "survey_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_answers" ADD CONSTRAINT "survey_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "survey_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
