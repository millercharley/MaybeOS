-- EVT-41: a host can stop selling without cancelling.
--
-- Charley: "add an option to pause ticket sales."
--
-- Distinct from the two things that already existed and are not this:
-- unpublishing hides the event from everybody, and cancelling refunds the
-- room. A pause holds the last few places back while the event stays where it
-- is and the people already coming stay coming.
ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "ticketSalesPaused" BOOLEAN NOT NULL DEFAULT false;
