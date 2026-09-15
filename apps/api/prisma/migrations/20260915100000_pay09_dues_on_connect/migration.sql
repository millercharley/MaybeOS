-- PAY-09: member dues move to each co-op's own connected Stripe account, the
-- Free plan adds a flat fee to dues, and Free is capped at 100 members.
--
-- Until now a dues checkout ran on MaybeOS's own Stripe account, so a member's
-- dues were paid to MaybeOS rather than to their co-op. D-013 names that
-- as money transmission for any co-op other than MaybeItsFate. These columns
-- record which account each tier's price and each member's subscription live
-- on, so dues already on MaybeOS's account keep working while new ones go to
-- the co-op.
--
-- Additive and nullable. Null means MaybeOS's own account, which is exactly
-- where every existing row lives.
--
-- Idempotent: production takes this through the Supabase connector before the
-- code ships, and dev through `prisma migrate deploy`.

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "stripeConnectObjects" JSONB;
ALTER TABLE "membership_tiers" ADD COLUMN IF NOT EXISTS "stripeDuesAccountId" TEXT;
ALTER TABLE "user_orgs" ADD COLUMN IF NOT EXISTS "stripeDuesAccountId" TEXT;
ALTER TABLE "user_orgs" ADD COLUMN IF NOT EXISTS "duesFeeCents" INTEGER NOT NULL DEFAULT 0;
