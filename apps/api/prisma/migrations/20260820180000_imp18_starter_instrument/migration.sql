-- IMP-18: what a question needs before anyone is asked it.
--
-- Three columns, all learned from writing the first real instrument.

-- A scale of 1–5 with no anchors is not a question, it is five buttons. The
-- member has to be told which end is which, and the answer only means
-- anything if everyone read the ends the same way.
ALTER TABLE "survey_questions" ADD COLUMN IF NOT EXISTS "anchorLow" TEXT;
ALTER TABLE "survey_questions" ADD COLUMN IF NOT EXISTS "anchorHigh" TEXT;

-- Which direction is good news. Belonging and loneliness are both measured
-- 1–5 and they point opposite ways, so a report that averages a category
-- without knowing this would print "loneliness 4.2" beside "belonging 4.2"
-- and read them as the same result. Cheap now, and much less cheap once a
-- year of answers exists to reinterpret.
ALTER TABLE "survey_questions"
  ADD COLUMN IF NOT EXISTS "higherIsBetter" BOOLEAN NOT NULL DEFAULT true;

-- One starter instrument per co-op, enforced rather than assumed.
--
-- Partial, so a co-op may still have as many CUSTOM surveys as it likes; a
-- plain unique on (orgId, type) would have forbidden that. Two BASELINE
-- surveys would mean two open collection windows, and an answer that could
-- belong to either is an answer that traces to neither — which is G5, the one
-- guarantee the whole report rests on.
CREATE UNIQUE INDEX IF NOT EXISTS "surveys_one_baseline_per_org"
  ON "surveys"("orgId") WHERE "type" = 'BASELINE';
