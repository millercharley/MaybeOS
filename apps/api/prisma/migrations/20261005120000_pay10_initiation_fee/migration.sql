-- PAY-10: a one-time fee for joining.
--
-- Charley: "Some organizations will need to charge a one-time initiation fee
-- for their memberships. Please add this as an option via Stripe Connect for
-- an admin to pair a one-time fee to a membership subscription, including
-- setting the amount."
--
-- On the tier rather than the co-op, because a co-op that charges to join
-- rarely charges the same at every level — and a tier with no fee beside one
-- that has is how a co-op keeps a way in for somebody who cannot pay it.
ALTER TABLE "membership_tiers"
  ADD COLUMN IF NOT EXISTS "initiationFeeCents" INTEGER NOT NULL DEFAULT 0;

-- Once per member, not once per tier. Moving between tiers is not joining
-- again, and a co-op that charged for it would be charging somebody for
-- changing their mind.
ALTER TABLE "user_orgs"
  ADD COLUMN IF NOT EXISTS "initiationFeePaidAt" TIMESTAMP(3);
