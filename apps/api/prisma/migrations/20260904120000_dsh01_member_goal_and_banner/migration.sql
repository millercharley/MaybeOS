-- DSH-01: what a co-op can put on its members' dashboard.
--
-- Both nullable with no default: a co-op that has set neither shows neither,
-- which is the honest state. A goal MaybeOS invented would be a claim about
-- what somebody else's co-op is for.
ALTER TABLE "organizations" ADD COLUMN "memberGoal" INTEGER;
ALTER TABLE "organizations" ADD COLUMN "bannerUrl" TEXT;
