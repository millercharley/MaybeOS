-- CAL-13: let the calendar sync run itself.
--
-- An import only ever happened when an admin pressed the button, which is how
-- the Attic stayed booked after its Google entry was deleted: nothing was
-- wrong with the sync, nothing had run it.
ALTER TABLE "organizations"
  ADD COLUMN "calendarSyncCursor" JSONB,
  ADD COLUMN "calendarSyncedAt"   TIMESTAMP(3),
  ADD COLUMN "calendarSyncError"  TEXT;
