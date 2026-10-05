-- PUB-05: where "View all events" goes.
--
-- Charley: "Make sure the View all events link takes the user to a public view
-- of events at the community. Ask the admin for the link on the Join Page tab
-- in the Admin Settings. If the URL entry is left blank, show a single page of
-- events that do not require a logged in user to view, RSVP, and buy tickets."
--
-- Null is the normal case: the link then goes to the page MaybeOS hosts at
-- /orgs/<slug>/events. A co-op with a calendar of their own sends people there.
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "publicEventsUrl" TEXT;
