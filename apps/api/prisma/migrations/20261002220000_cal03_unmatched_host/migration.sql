-- CAL-03: an imported event remembers who ran it, member or not.
--
-- A co-op importing years of its own Google Calendar brings events hosted by
-- people who have since left. The importer matched the Google organiser to a
-- membership and, finding none, wrote `hostId: null` — so a decade of a
-- community's evenings arrived with nobody's name on them. Room reservations
-- were worse: `bookings.userId` is required, so every unmatched reservation
-- was filed under the co-op's first organiser, producing a booking history
-- that says one person held every room for years.
--
-- The organiser's name and address now travel with the row. The name is what
-- the event shows; the address is matched and never shown, and is how
-- somebody who rejoins finds the evenings they ran — on the day they rejoin,
-- the same way an imported cap-table line finds its holder.
--
-- Idempotent: production takes this through the Supabase connector before the
-- code ships, and dev through `prisma migrate deploy`.

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "hostEmail" TEXT;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "hostName" TEXT;

ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "bookedForEmail" TEXT;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "bookedForName" TEXT;

-- Matching on the way in when somebody joins is a lookup per membership, so
-- it gets an index rather than a sequential scan of every event a co-op has.
CREATE INDEX IF NOT EXISTS "events_hostEmail_idx" ON "events" ("orgId", "hostEmail");
CREATE INDEX IF NOT EXISTS "bookings_bookedForEmail_idx" ON "bookings" ("bookedForEmail");
