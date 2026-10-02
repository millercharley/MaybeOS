-- RCP-01: the monthly recap, and the dues payments it needs to be true.
--
-- `dues_payments` is the table MaybeOS never had. `invoice.paid` was not a
-- handled webhook, so a member's dues cleared and the database learned
-- nothing: subscription *status* was stored all along, and a status is not a
-- payment. Without it, the one figure that makes "your membership sustains
-- this" true is the one figure the recap could not state. Rows are written
-- from the webhook going forward and backfilled once from Stripe for the
-- months already gone; `stripeInvoiceId` is unique, so a redelivered event
-- and the backfill cannot both count the same money.
--
-- `monthly_recaps` holds one month per co-op, drafted on the 1st and sent by
-- an organiser. `figures` is frozen at generation and never recomputed, the
-- same bargain `impact_reports` makes.
--
-- Switches: `organizations.recapEnabled` is off for every co-op and the
-- interface only offers it on Plus and Unlimited; `recapShowMoney` lets a
-- co-op keep money out of the members' copy; `user_orgs.recapEmails` is the
-- member's own switch, with one-click unsubscribe in every send.
--
-- Row-level security on both new tables and no grants to anon or
-- authenticated, matching every other application table (SEC-09).
--
-- Idempotent: production takes this through the Supabase connector before the
-- code ships, and dev through `prisma migrate deploy`.

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "recapEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "recapDraftHour" INTEGER NOT NULL DEFAULT 8;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "recapShowMoney" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "duesBackfilledAt" TIMESTAMP(3);

ALTER TABLE "user_orgs" ADD COLUMN IF NOT EXISTS "recapEmails" BOOLEAN NOT NULL DEFAULT true;

DO $$ BEGIN
  CREATE TYPE "RecapStatus" AS ENUM ('DRAFT', 'SENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RecapComposeStatus" AS ENUM ('PENDING', 'COMPOSING', 'READY', 'SKIPPED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "dues_payments" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "userOrgId" TEXT,
  "stripeInvoiceId" TEXT NOT NULL,
  "stripeAccountId" TEXT,
  "amountCents" INTEGER NOT NULL,
  "feeCents" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "paidAt" TIMESTAMP(3) NOT NULL,
  "refundedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dues_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "dues_payments_stripeInvoiceId_key" ON "dues_payments"("stripeInvoiceId");
CREATE INDEX IF NOT EXISTS "dues_payments_orgId_paidAt_idx" ON "dues_payments"("orgId", "paidAt");

DO $$ BEGIN
  ALTER TABLE "dues_payments"
    ADD CONSTRAINT "dues_payments_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- SetNull rather than Cascade: a member leaving must not delete the record of
-- money they paid. The co-op's accounts do not change because somebody left.
DO $$ BEGIN
  ALTER TABLE "dues_payments"
    ADD CONSTRAINT "dues_payments_userOrgId_fkey"
    FOREIGN KEY ("userOrgId") REFERENCES "user_orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "monthly_recaps" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "status" "RecapStatus" NOT NULL DEFAULT 'DRAFT',
  "figures" JSONB NOT NULL,
  "note" TEXT,
  "composed" TEXT,
  "composeStatus" "RecapComposeStatus" NOT NULL DEFAULT 'PENDING',
  "composeNote" TEXT,
  "sentAt" TIMESTAMP(3),
  "sentById" TEXT,
  "sentCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "monthly_recaps_pkey" PRIMARY KEY ("id")
);

-- One recap per co-op per month, which is also what stops a scheduler running
-- every fifteen minutes from drafting the same month four times an hour.
CREATE UNIQUE INDEX IF NOT EXISTS "monthly_recaps_orgId_periodStart_key" ON "monthly_recaps"("orgId", "periodStart");

DO $$ BEGIN
  ALTER TABLE "monthly_recaps"
    ADD CONSTRAINT "monthly_recaps_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "dues_payments" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "dues_payments" FROM anon, authenticated;
ALTER TABLE "monthly_recaps" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "monthly_recaps" FROM anon, authenticated;
