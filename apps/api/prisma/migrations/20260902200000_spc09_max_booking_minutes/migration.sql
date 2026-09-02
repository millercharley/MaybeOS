-- SPC-09: a room can cap how long a single booking runs.
--
-- Null means no cap, which is what every existing room gets: a cap invented on
-- their behalf would start refusing bookings co-ops are making today.
ALTER TABLE "rooms"
  ADD COLUMN IF NOT EXISTS "maxBookingMinutes" INTEGER;
