-- PLT-06: a membership that is ending says so.
--
-- Stripe's Billing Portal cancels *at period end*, so a member who cancels
-- keeps an `active` subscription until the month they paid for runs out. That
-- mapping was already right — what was missing was any way to say it. Nothing
-- stored `cancel_at_period_end`, so the member's Billing page told somebody who
-- had just cancelled "Active — your dues are paid and up to date", and the
-- admin's member list showed a paying member who was in fact leaving.
--
-- Found by cancelling a real subscription (2026-09-09). No amount of reading
-- would have shown it: every status mapping in the code is correct.
--
-- `IF NOT EXISTS` because production took this through the Supabase connector
-- first, per the deploy rule, and dev may have caught a partial write while the
-- connector was timing out.
ALTER TABLE "user_orgs" ADD COLUMN IF NOT EXISTS "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "user_orgs" ADD COLUMN IF NOT EXISTS "currentPeriodEnd" TIMESTAMP(3);
