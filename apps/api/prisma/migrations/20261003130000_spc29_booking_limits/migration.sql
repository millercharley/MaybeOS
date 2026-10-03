-- SPC-29: how long a member may book a room for, and how much of it.
--
-- Charley: "admin can set the max duration of a room reservation… default 3
-- hours… system max is 24 hours", and an optional cap on the total hours one
-- member may hold in a month or a year, off by default.
--
-- The duration is a column with a default rather than a nullable setting: a
-- co-op that has never thought about it still gets three hours, which is what
-- most room use looks like, instead of unlimited. A room may still set its
-- own shorter limit, and the shorter of the two wins.
--
-- The quota is nullable, because off is a real answer and the commonest one.
-- A limit on how much of the building one member may hold is something a
-- co-op decides it needs, usually after somebody has booked the Attic every
-- Saturday for a year.
--
-- Idempotent: production takes this through the Supabase connector before the
-- code ships, and dev through `prisma migrate deploy`.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BookingQuotaPeriod') THEN
    CREATE TYPE "BookingQuotaPeriod" AS ENUM ('MONTH', 'YEAR');
  END IF;
END $$;

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "maxBookingMinutes" INTEGER NOT NULL DEFAULT 180;

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "bookingQuotaPeriod" "BookingQuotaPeriod";

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "bookingQuotaHours" INTEGER;
