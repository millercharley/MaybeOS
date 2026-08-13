-- IMP-15: the ticket-purchase touchpoint, and the fatigue budget it spends.
--
-- D-021 calls the fatigue budget the load-bearing constraint of ImpactOS:
-- one micro-question per member per 30 days across all touchpoints, dismissal
-- widening the gap, three dismissals moving a member to an annual check-in.

CREATE TYPE "Touchpoint" AS ENUM ('TICKET_PURCHASE', 'BOOKING', 'POST_EVENT', 'COMMONS');

-- Null means the question belongs to a survey answered in one sitting rather
-- than to a moment, so every existing question is unaffected.
ALTER TABLE "survey_questions"
  ADD COLUMN IF NOT EXISTS "touchpoint" "Touchpoint";

-- Per membership, not per user: orgs are firewalled, and one co-op's questions
-- must not spend another's budget.
ALTER TABLE "user_orgs"
  ADD COLUMN IF NOT EXISTS "lastAskedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "askDismissals" INTEGER NOT NULL DEFAULT 0;
