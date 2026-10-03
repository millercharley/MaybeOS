-- SPC-27: a co-op can require its events to name a room.
--
-- Charley: an "admin setting to turn on 'Enforce events to connect to room
-- reservation'". A co-op that runs a building wants its calendar and its room
-- sheet to agree; one that meets in a park does not.
--
-- Off by default, because off is right for most co-ops and because turning it
-- on retroactively would make every existing event invalid.
--
-- Idempotent: production takes this through the Supabase connector before the
-- code ships, and dev through `prisma migrate deploy`.

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "requireEventRoom" BOOLEAN NOT NULL DEFAULT false;
