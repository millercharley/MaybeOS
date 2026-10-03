-- EVT-32: a creator, and co-hosts.
--
-- `hostId` could only name one person, and a co-op's events are rarely one
-- person's: a workshop has somebody teaching and somebody on the door. The
-- second of them had no way to correct a time or see who was coming.
--
-- `createdById` is the other half. The host starts as whoever made the event
-- and can be handed on — so without recording the creator, handing an event
-- over took the creator's own ability to fix it with them, and an organiser
-- making an event on a member's behalf lost it the moment they set the host.
--
-- Backfilled from `hostId`, which is what the creator was until now.
--
-- Idempotent: production takes this through the Supabase connector before the
-- code ships, and dev through `prisma migrate deploy`.

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "createdById" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_createdById_fkey'
  ) THEN
    ALTER TABLE "events"
      ADD CONSTRAINT "events_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

UPDATE "events" SET "createdById" = "hostId"
WHERE "createdById" IS NULL AND "hostId" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "event_co_hosts" (
  "id"        TEXT NOT NULL,
  "eventId"   TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "addedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "event_co_hosts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "event_co_hosts_eventId_userId_key"
  ON "event_co_hosts" ("eventId", "userId");
CREATE INDEX IF NOT EXISTS "event_co_hosts_userId_idx" ON "event_co_hosts" ("userId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_co_hosts_eventId_fkey') THEN
    ALTER TABLE "event_co_hosts"
      ADD CONSTRAINT "event_co_hosts_eventId_fkey"
      FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_co_hosts_userId_fkey') THEN
    ALTER TABLE "event_co_hosts"
      ADD CONSTRAINT "event_co_hosts_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Row-level security, like every other table here (SEC-09). The API is the
-- only thing that reads it, through the service role.
ALTER TABLE "event_co_hosts" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "event_co_hosts" FROM anon, authenticated;
