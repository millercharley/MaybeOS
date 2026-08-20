-- IMP-21: the spine the PRD is built on — mission, goals, indicators, plan.
--
-- Everything shipped so far was the collection layer. There was no model for
-- what a co-op is trying to do, so nothing collected could be connected to it:
-- ImpactOS could report a belonging score and never say why that co-op cared.

CREATE TYPE "MeasurementPlanStatus" AS ENUM ('DRAFT', 'APPROVED');

-- Three to five, in the co-op's own words. The mission itself already lives on
-- `organizations.mission`.
CREATE TABLE IF NOT EXISTS "goals" (
  "id"          TEXT NOT NULL,
  "orgId"       TEXT NOT NULL,
  "title"       TEXT NOT NULL,
  "description" TEXT,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  -- Archived rather than deleted: a goal a co-op pursued for a year is part of
  -- what its report says, and deleting it would silently rewrite the past.
  "archivedAt"  TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "goals_orgId_idx" ON "goals"("orgId");

ALTER TABLE "goals"
  ADD CONSTRAINT "goals_orgId_fkey" FOREIGN KEY ("orgId")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- What measures a goal. `category` is the same string the questions and the
-- aggregation already use, which is what lets a goal inherit a figure rather
-- than needing its own parallel collection.
CREATE TABLE IF NOT EXISTS "indicators" (
  "id"        TEXT NOT NULL,
  "goalId"    TEXT NOT NULL,
  "category"  TEXT NOT NULL,
  "label"     TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "indicators_pkey" PRIMARY KEY ("id")
);

-- One indicator per category per goal. The same category measuring one goal
-- twice would double-count it in every figure drawn from that goal.
CREATE UNIQUE INDEX IF NOT EXISTS "indicators_goalId_category_key"
  ON "indicators"("goalId", "category");

ALTER TABLE "indicators"
  ADD CONSTRAINT "indicators_goalId_fkey" FOREIGN KEY ("goalId")
    REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The approval itself. One per co-op, holding whether the goals and indicators
-- as they now stand have actually been agreed to — because a plan that changes
-- after approval is not an approved plan.
CREATE TABLE IF NOT EXISTS "measurement_plans" (
  "id"           TEXT NOT NULL,
  "orgId"        TEXT NOT NULL,
  "status"       "MeasurementPlanStatus" NOT NULL DEFAULT 'DRAFT',
  "approvedAt"   TIMESTAMP(3),
  "approvedById" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "measurement_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "measurement_plans_orgId_key"
  ON "measurement_plans"("orgId");

ALTER TABLE "measurement_plans"
  ADD CONSTRAINT "measurement_plans_orgId_fkey" FOREIGN KEY ("orgId")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nulled rather than cascaded: an organiser leaving must not erase the record
-- of who approved what the co-op measures.
ALTER TABLE "measurement_plans"
  ADD CONSTRAINT "measurement_plans_approvedById_fkey" FOREIGN KEY ("approvedById")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- `expenses.goalKey` was a plain string with a comment saying it becomes a
-- foreign key once goals are modelled (IMP-16). They are now, and no expense
-- row exists in either database, so this is the free moment to do it.
ALTER TABLE "expenses" DROP COLUMN IF EXISTS "goalKey";
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "goalId" TEXT;

-- SetNull, not Cascade: deleting a goal must not delete the co-op's record of
-- money it spent.
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_goalId_fkey" FOREIGN KEY ("goalId")
    REFERENCES "goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX IF EXISTS "expenses_orgId_goalKey_idx";
CREATE INDEX IF NOT EXISTS "expenses_orgId_goalId_idx" ON "expenses"("orgId", "goalId");

-- SEC-09: new tables arrive with RLS disabled and must enable it explicitly.
-- No policies, which denies every role that does not bypass RLS — the intent,
-- since MaybeOS never reaches these through Supabase's Data API.
ALTER TABLE "goals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "indicators" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "measurement_plans" ENABLE ROW LEVEL SECURITY;
