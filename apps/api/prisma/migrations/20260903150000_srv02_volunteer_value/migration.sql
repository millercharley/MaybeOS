-- SRV-02: what an hour of service is worth, if the co-op says so.
--
-- Nullable with no default, deliberately. Turning hours into a dollar figure
-- is the co-op asserting a rate in a document a funder will read, and a number
-- MaybeOS chose — however respectable its source — would be asserted in the
-- co-op's name without anybody agreeing to it. Until this is set, ImpactOS
-- reports hours, which needs no assumption to be true.
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "volunteerHourValueCents" INTEGER;
