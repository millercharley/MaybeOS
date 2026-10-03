-- SPC-26: an event occupies rooms, plural.
--
-- Charley: "how to tie rooms to events?" — and, in the same breath, "the
-- member might need to also reserve a room(s)" and "on all events, list the
-- rooms being used".
--
-- `Event.bookingId` has held this since EVT-05, one booking per event, which
-- cannot say that a gig uses the Attic and the Salon. The link moves to the
-- reservation: a booking is for at most one event, an event has as many
-- reservations as it needs, and "the rooms being used" is a list rather than
-- a field.
--
-- SetNull on delete, not Cascade. Deleting an event must not quietly release
-- the rooms — the co-op still held them, and whether to give them back is
-- somebody's decision rather than a side effect.
--
-- Backfilled from `Event.bookingId`, which stays for now: it is read in
-- several places and is correct for every event that has one.
--
-- Idempotent: production takes this through the Supabase connector before the
-- code ships, and dev through `prisma migrate deploy`.

ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "eventId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_eventId_fkey') THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "bookings_eventId_fkey"
      FOREIGN KEY ("eventId") REFERENCES "events"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "bookings_eventId_idx" ON "bookings" ("eventId");

UPDATE "bookings" b
SET "eventId" = e."id"
FROM "events" e
WHERE e."bookingId" = b."id" AND b."eventId" IS NULL;
