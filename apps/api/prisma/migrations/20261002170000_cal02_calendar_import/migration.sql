-- CAL-02: bringing a co-op's Google calendars in before its members arrive.
--
-- Charley: members should open MaybeOS on their first day and see the full
-- list of what is going on, not an empty events page.
--
-- Two kinds of calendar, kept apart deliberately. The **room** calendars are
-- reservations: a room being held is not a thing to attend, and importing
-- every hold as an event would put "DO NOT BOOK" in front of the whole
-- community. One named calendar — MaybeItsFate's is "MaybeItsFate Main
-- Events" — holds the things members are meant to see, and only that one
-- produces events.
--
-- `events.googleEventId` is what makes a re-run update rather than duplicate,
-- the same job the column of that name already does for a booking. Unique per
-- co-op rather than globally: two co-ops can legitimately hold the same
-- Google id if they share a calendar.
--
-- Idempotent: production takes this through the Supabase connector before the
-- code ships, and dev through `prisma migrate deploy`.

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "eventsCalendarId" TEXT;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "googleEventId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "events_orgId_googleEventId_key" ON "events"("orgId", "googleEventId");
