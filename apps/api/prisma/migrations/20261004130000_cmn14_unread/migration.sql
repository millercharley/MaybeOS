-- CMN-14: a badge saying what has not been read.
--
-- Charley: "when there's an unread message in the Commons or Messages, a red
-- bubble appears in the navigation panel with a number."
--
-- Two halves, and they were in very different states. Direct messages already
-- carried `readAt` per message, so the count only needed an index. The Commons
-- had no read state of any kind — no membership, no last-read, no per-post
-- marker — so nothing in the product could say what was new.

-- The badge's query for messages: "how many has this person not read yet".
-- Without this index that is a sequential scan of every message in the co-op,
-- run by every signed-in member every minute.
CREATE INDEX IF NOT EXISTS "direct_messages_receiverId_readAt_idx"
  ON "direct_messages" ("receiverId", "readAt");

-- How far a member has read in a channel. One row per member per channel,
-- shaped after `reactions` — the only per-user-per-object row the Commons
-- already had.
--
-- Deliberately NOT a membership: a row here grants nothing and its absence
-- denies nothing. Every member can still see every channel; this only records
-- reading.
CREATE TABLE IF NOT EXISTS "channel_reads" (
  "id"         TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "channelId"  TEXT NOT NULL,
  "lastReadAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "channel_reads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "channel_reads_userId_channelId_key"
  ON "channel_reads" ("userId", "channelId");

CREATE INDEX IF NOT EXISTS "channel_reads_userId_idx"
  ON "channel_reads" ("userId");

DO $$ BEGIN
  ALTER TABLE "channel_reads" ADD CONSTRAINT "channel_reads_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "channel_reads" ADD CONSTRAINT "channel_reads_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- New table, so it is closed by default like every other (SEC-03).
ALTER TABLE "channel_reads" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "channel_reads" FROM anon, authenticated;
