-- SPC-37: co-hosts on a room reservation.
--
-- Charley: "As a member, I want to add a co-host to a room reservation."
--
-- An event has had co-hosts since EVT-32 and the reservation holding its room
-- has not, so the member who books the Attic every Tuesday was the only person
-- who could move it and the only person it appeared to. Two people run the
-- evening and one of them cannot see the room is held.
--
-- It also makes `attachProblem`'s advice true in both directions. An event may
-- only claim reservations belonging to the people running it, and the refusal
-- has always read "That reservation belongs to somebody who is not running
-- this event. Add them as a co-host first." — which until now you could do to
-- the event and not to the reservation.
--
-- Nothing is backfilled: every existing reservation has exactly the one person
-- it has always had.
--
-- Idempotent: production takes this through the Supabase connector before the
-- code ships, and dev through `prisma migrate deploy`.

CREATE TABLE IF NOT EXISTS "booking_co_hosts" (
  "id"        TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "addedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_co_hosts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "booking_co_hosts_bookingId_userId_key"
  ON "booking_co_hosts" ("bookingId", "userId");
-- The reservations somebody has been added to, for their My Bookings.
CREATE INDEX IF NOT EXISTS "booking_co_hosts_userId_idx" ON "booking_co_hosts" ("userId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_co_hosts_bookingId_fkey') THEN
    ALTER TABLE "booking_co_hosts"
      ADD CONSTRAINT "booking_co_hosts_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_co_hosts_userId_fkey') THEN
    ALTER TABLE "booking_co_hosts"
      ADD CONSTRAINT "booking_co_hosts_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Row-level security, like every other table here (SEC-09). The API is the
-- only thing that reads it, through the service role.
ALTER TABLE "booking_co_hosts" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "booking_co_hosts" FROM anon, authenticated;
