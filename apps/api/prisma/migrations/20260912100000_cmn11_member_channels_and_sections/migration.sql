-- CMN-11: members can open a channel, channels carry an emoji, and channels
-- file under named sections.
--
-- Three separate things, one migration, because they are one feature of the
-- Commons sidebar and shipping the columns apart would mean two deploys where
-- the UI knows about a column the database does not have.
--
-- `memberChannelsEnabled` is off for every existing co-op, which keeps today's
-- behaviour exactly: only admins create channels until somebody turns it on.
--
-- A section is filing, not ownership: `channels.sectionId` is SET NULL on
-- delete, so removing a section ungroups its channels rather than taking the
-- conversations with it. Same reasoning for `createdById` — a member leaving
-- the co-op must not delete the channel they started.
--
-- Row-level security on the new table and no grants to anon or authenticated,
-- matching every other application table. The API connects as the table owner.
--
-- Idempotent: production takes this through the Supabase connector before the
-- code ships, and dev through `prisma migrate deploy`.

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "memberChannelsEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "channel_sections" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "channel_sections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "channel_sections_orgId_name_key" ON "channel_sections"("orgId", "name");
CREATE INDEX IF NOT EXISTS "channel_sections_orgId_position_idx" ON "channel_sections"("orgId", "position");

DO $$ BEGIN
  ALTER TABLE "channel_sections"
    ADD CONSTRAINT "channel_sections_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "emoji" TEXT;
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "sectionId" TEXT;
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "createdById" TEXT;

CREATE INDEX IF NOT EXISTS "channels_sectionId_idx" ON "channels"("sectionId");

DO $$ BEGIN
  ALTER TABLE "channels"
    ADD CONSTRAINT "channels_sectionId_fkey"
    FOREIGN KEY ("sectionId") REFERENCES "channel_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "channels"
    ADD CONSTRAINT "channels_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "channel_sections" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "channel_sections" FROM anon, authenticated;
