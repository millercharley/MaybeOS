-- EVT-15: paying a member who hosted an event and sold tickets.
--
-- Ticket money lands in the *co-op's* Stripe account (D-013, direct charges),
-- so a member host is owed money the co-op is holding. MaybeOS works out what
-- that is and records that it was paid; the co-op pays it the way it already
-- pays people. Charley, 2026-08-21: "track now, Stripe later".

CREATE TYPE "HostPayoutStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

-- Basis points, not a percentage: 2000 = 20%, and integer arithmetic means a
-- share never lands a fraction of a cent short the way a float would.
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "hostRevenueShareBps" INTEGER NOT NULL DEFAULT 10000;

-- Null means "whatever the co-op's default is". An override belongs per event
-- because "we take 20% for the room, except for the fundraiser" is a real
-- arrangement, and copying the org default onto every event would freeze
-- today's number into next year's events.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "hostRevenueShareBps" INTEGER;

CREATE TABLE IF NOT EXISTS "host_payouts" (
  "id"            TEXT NOT NULL,
  "orgId"         TEXT NOT NULL,
  "eventId"       TEXT NOT NULL,
  "hostUserId"    TEXT,
  -- The ticket money the event took, before the share is applied: face value
  -- only, since MaybeOS's fee and the co-op's own fee were added on top of the
  -- ticket price and were never the host's money.
  "grossCents"    INTEGER NOT NULL,
  "shareBps"      INTEGER NOT NULL,
  "amountCents"   INTEGER NOT NULL,
  "ticketCount"   INTEGER NOT NULL DEFAULT 0,
  "refundedCount" INTEGER NOT NULL DEFAULT 0,
  "status"        "HostPayoutStatus" NOT NULL DEFAULT 'PENDING',
  "paidAt"        TIMESTAMP(3),
  "paidById"      TEXT,
  -- How it was actually sent, in the organiser's words: "bank transfer 21 Aug",
  -- "cash at the bar". MaybeOS did not move this money and should not pretend
  -- to know how it moved.
  "note"          TEXT,
  -- Empty today and deliberately present: the Stripe transfer that pays this,
  -- when that decision is taken. A payout row written now becomes the record
  -- that transfer attaches to rather than something to migrate.
  "stripeTransferId" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "host_payouts_pkey" PRIMARY KEY ("id")
);

-- One payout per event. Two would be two people owed the same money.
CREATE UNIQUE INDEX IF NOT EXISTS "host_payouts_eventId_key" ON "host_payouts"("eventId");
CREATE INDEX IF NOT EXISTS "host_payouts_orgId_status_idx" ON "host_payouts"("orgId", "status");
CREATE INDEX IF NOT EXISTS "host_payouts_hostUserId_idx" ON "host_payouts"("hostUserId");

ALTER TABLE "host_payouts"
  ADD CONSTRAINT "host_payouts_orgId_fkey" FOREIGN KEY ("orgId")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "host_payouts"
  ADD CONSTRAINT "host_payouts_eventId_fkey" FOREIGN KEY ("eventId")
    REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SetNull on both people: a host or an organiser leaving the co-op must not
-- erase the record that money was owed and paid.
ALTER TABLE "host_payouts"
  ADD CONSTRAINT "host_payouts_hostUserId_fkey" FOREIGN KEY ("hostUserId")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "host_payouts"
  ADD CONSTRAINT "host_payouts_paidById_fkey" FOREIGN KEY ("paidById")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SEC-09: new tables arrive with RLS disabled and must enable it explicitly.
ALTER TABLE "host_payouts" ENABLE ROW LEVEL SECURITY;
