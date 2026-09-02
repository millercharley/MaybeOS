-- SPC-07: a room points at a chosen calendar, not at whoever connected it.
--
-- `googleCalendarId` has existed since SpaceOS was built and nothing ever set
-- it, so every read fell through to 'primary' — the personal calendar of the
-- organiser who happened to click Connect. Their dentist appointment would
-- have blocked the Attic, and the Attic's bookings would have appeared in
-- their own diary. Null now means "connected, no calendar chosen yet", which
-- is a state the admin is shown rather than one the code guesses past.
ALTER TABLE "rooms"
  ADD COLUMN IF NOT EXISTS "googleCalendarName" TEXT,
  ADD COLUMN IF NOT EXISTS "googleAccountEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "googleConnectedAt" TIMESTAMP(3);
