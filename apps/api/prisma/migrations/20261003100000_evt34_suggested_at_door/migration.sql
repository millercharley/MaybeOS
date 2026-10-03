-- EVT-34: what an event suggests at the door.
--
-- Charley: "many events have a suggested fee but not hard cost and do not
-- sell tickets in advance." `hasCost` already recorded that there was
-- something to pay; nothing recorded how much.
--
-- Optional even when `hasCost` is set, because plenty of events ask for
-- something without naming a figure — and "pay what you can, suggested $10"
-- is a different offer from "pay what you can".
--
-- Not a price. Nobody is turned away for not paying it, and MaybeOS never
-- collects it: that is what the ticket price is for.
--
-- Idempotent: production takes this through the Supabase connector before the
-- code ships, and dev through `prisma migrate deploy`.

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "suggestedCents" INTEGER;
