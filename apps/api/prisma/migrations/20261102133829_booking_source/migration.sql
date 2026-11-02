-- SPC-36: a MaybeOS booking is tracked by its own id, not by the calendar.
--
-- MaybeOS creates a booking, pushes it to Google, and stores the returned
-- googleEventId on the row. The importer matched on that same id, found "an
-- existing row", and re-derived ownership from the calendar's weak signals.
-- 175 of MaybeItsFate's 228 native bookings had become co-op holds that way,
-- 140 upcoming and invisible to 33 members.
--
-- The default is MAYBEOS on purpose: a row of unknown origin is treated as
-- ours and left alone by the import, rather than offered up for re-ownership.
CREATE TYPE "BookingSource" AS ENUM ('MAYBEOS', 'GOOGLE');

ALTER TABLE "bookings"
  ADD COLUMN "source" "BookingSource" NOT NULL DEFAULT 'MAYBEOS';
