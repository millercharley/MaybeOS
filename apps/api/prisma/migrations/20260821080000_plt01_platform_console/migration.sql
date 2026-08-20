-- PLT-01: the super-admin console.

-- Suspension, not deletion. What happens to a suspended co-op's *data* is a
-- decision Charley has not taken (retain or delete), and this deliberately
-- does not take it for him: suspending stops access and changes nothing else,
-- so whichever way that decision goes, nothing here has to be undone.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "suspendedReason" TEXT;

-- "Provide MaybeOS for free, except ticket sales" (Charley, 2026-08-19).
--
-- Its own flag rather than a plan, because the plan does double duty: it sets
-- both what a co-op is billed *and* MaybeOS's cut per ticket. Comping a co-op
-- by moving it to FREE would triple its members' ticket fees, which is the
-- opposite of a gift. With this, a comped co-op is set to whatever plan it
-- should *have* — and pays nothing for it, while its ticket fee follows that
-- plan as normal.
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "billingWaived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "billingWaivedReason" TEXT;

-- The console lists co-ops newest-first and filters the suspended ones.
CREATE INDEX IF NOT EXISTS "organizations_createdAt_idx" ON "organizations"("createdAt");
