-- SPC-23: a room hold the co-op made is not somebody's booking.
--
-- MaybeItsFate's calendar import produced 3,017 room reservations and filed
-- every single one under c@maybeitsfate.com, because that is the account the
-- co-op's automation creates its calendar entries with. Charley opened his
-- member dashboard to a My Bookings list containing the entire history of
-- eight rooms.
--
-- `bookings.userId` is required and the row has to hold the room — the rooms
-- page must be honest about what is free — so the fix is not to detach it but
-- to stop it claiming to be a person's. A hold is the co-op's: it blocks the
-- room, it appears to organisers, and it is in nobody's My Bookings.
--
-- Set on the way in from now on; the existing rows are marked by the data fix
-- that follows this migration, which is scoped to imported bookings alone.
--
-- Idempotent: production takes this through the Supabase connector before the
-- code ships, and dev through `prisma migrate deploy`.

ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "isCoopHold" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "bookings_userId_coopHold_idx" ON "bookings" ("userId", "isCoopHold");
