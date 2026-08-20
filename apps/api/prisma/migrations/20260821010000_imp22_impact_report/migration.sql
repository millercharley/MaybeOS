-- IMP-22: the year-end report, which is what ImpactOS exists to produce.

CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'PUBLISHED');

CREATE TABLE IF NOT EXISTS "impact_reports" (
  "id"          TEXT NOT NULL,
  "orgId"       TEXT NOT NULL,
  "title"       TEXT NOT NULL,
  "slug"        TEXT NOT NULL,
  -- The period the figures describe, which is not the period they were
  -- written in. A report generated in January about last year is normal.
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd"   TIMESTAMP(3) NOT NULL,
  "status"      "ReportStatus" NOT NULL DEFAULT 'DRAFT',
  "publishedAt" TIMESTAMP(3),
  -- Frozen at generation, never recomputed. A report published in January
  -- that quietly reads differently in March is the worst thing this feature
  -- could do: the number a funder was sent has to stay the number they see.
  "generatedAt" TIMESTAMP(3) NOT NULL,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "impact_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "impact_reports_orgId_slug_key"
  ON "impact_reports"("orgId", "slug");
CREATE INDEX IF NOT EXISTS "impact_reports_orgId_idx" ON "impact_reports"("orgId");

ALTER TABLE "impact_reports"
  ADD CONSTRAINT "impact_reports_orgId_fkey" FOREIGN KEY ("orgId")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "impact_reports"
  ADD CONSTRAINT "impact_reports_createdById_fkey" FOREIGN KEY ("createdById")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Blocks rather than one body of prose, so an admin edits the paragraph they
-- disagree with instead of rewriting the report — and so the share of it they
-- changed is a number the product can actually see.
CREATE TABLE IF NOT EXISTS "report_blocks" (
  "id"            TEXT NOT NULL,
  "reportId"      TEXT NOT NULL,
  "sortOrder"     INTEGER NOT NULL DEFAULT 0,
  "kind"          TEXT NOT NULL,
  "heading"       TEXT,
  -- What is shown. Starts equal to `generatedBody`.
  "body"          TEXT,
  -- What MaybeOS wrote. Kept beside the edited version so a co-op can see
  -- what changed, and so "how much of this did a human rewrite" is answerable
  -- rather than asserted.
  "generatedBody" TEXT,
  "isEdited"      BOOLEAN NOT NULL DEFAULT false,
  -- The figures this block rests on, frozen: category, average, respondents,
  -- window label and dates. G5 — every figure traces to a response count and
  -- a collection window — is enforced by carrying them, not by promising them.
  "data"          JSONB,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "report_blocks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "report_blocks_reportId_sortOrder_idx"
  ON "report_blocks"("reportId", "sortOrder");

ALTER TABLE "report_blocks"
  ADD CONSTRAINT "report_blocks_reportId_fkey" FOREIGN KEY ("reportId")
    REFERENCES "impact_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SEC-09: new tables arrive with RLS disabled and must enable it explicitly.
ALTER TABLE "impact_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "report_blocks" ENABLE ROW LEVEL SECURITY;
