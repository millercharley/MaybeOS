-- PLT-02: what a co-op pays MaybeOS.
--
-- The three columns already on `user_orgs` are a *member's* dues to their
-- co-op — a different transaction with different money in it. Nothing recorded
-- the co-op's own subscription to MaybeOS, which is why "paid / cancelled /
-- past due" were states that did not exist for any co-op.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "stripePlanCustomerId" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "stripePlanSubscriptionId" TEXT;

-- Matched on when a later subscription event arrives carrying no metadata of
-- ours — a hosted pricing table gives us no way to set any.
CREATE UNIQUE INDEX IF NOT EXISTS "organizations_stripePlanSubscriptionId_key"
  ON "organizations"("stripePlanSubscriptionId");

-- Set when the subscription was last seen to be in good standing, so a co-op
-- whose card fails is visible rather than silently downgraded mid-month.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "planStatus" TEXT;
