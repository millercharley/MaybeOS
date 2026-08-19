-- A room says whether it is bookable at any hour, instead of it being inferred.
--
-- `validateAvailability` returned early when a room had no availability rules,
-- so "always open" and "nobody has set the hours yet" were the same state and
-- produced the same answer: bookable at 3am on a Sunday. A co-op that adds a
-- room and has not got to the opening hours has, without knowing it, published
-- it around the clock.
--
-- The flag makes the open case deliberate. Unchecked with no rules now means
-- not bookable, which is the safe reading of an unfinished room.

ALTER TABLE "rooms"
  ADD COLUMN IF NOT EXISTS "alwaysAvailable" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: any room that exists today is bookable at any hour, because that is
-- what having no rules meant until now. Turning them off underneath a co-op
-- would cancel a capability nobody asked to lose.
UPDATE "rooms" r
  SET "alwaysAvailable" = true
  WHERE NOT EXISTS (
    SELECT 1 FROM "availability_rules" a WHERE a."roomId" = r.id
  );
