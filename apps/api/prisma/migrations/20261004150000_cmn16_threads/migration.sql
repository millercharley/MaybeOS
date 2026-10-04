-- CMN-16: conversations with more than two people in them.
--
-- Charley: "the user can type in one or more members, select that member or
-- members from the search list... This can be a group message thread or an
-- individual DM thread."
--
-- `direct_messages` held a sender and a receiver, so a conversation was a pair
-- and a third person had nowhere to go. A one-to-one is now a thread with two
-- participants: same object, same screen, same unread count, and the only
-- difference between a DM and a group is how many people are in it.

CREATE TABLE IF NOT EXISTS "message_threads" (
  "id"             TEXT NOT NULL,
  "orgId"          TEXT NOT NULL,
  "createdById"    TEXT,
  "title"          TEXT,
  -- Every participant's id, sorted and joined. This is what makes "message
  -- these three again" land in the thread that already exists rather than
  -- opening a second one beside it.
  "participantKey" TEXT NOT NULL,
  "lastMessageAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_threads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "thread_participants" (
  "id"         TEXT NOT NULL,
  "threadId"   TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "lastReadAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "thread_participants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "thread_messages" (
  "id"        TEXT NOT NULL,
  "threadId"  TEXT NOT NULL,
  "senderId"  TEXT NOT NULL,
  "body"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "thread_messages_pkey" PRIMARY KEY ("id")
);

-- One thread per set of people per co-op. The tenant is in the key because
-- two people who share two co-ops hold two conversations (CMN-08).
CREATE UNIQUE INDEX IF NOT EXISTS "message_threads_orgId_participantKey_key"
  ON "message_threads" ("orgId", "participantKey");
CREATE INDEX IF NOT EXISTS "message_threads_orgId_lastMessageAt_idx"
  ON "message_threads" ("orgId", "lastMessageAt");
CREATE UNIQUE INDEX IF NOT EXISTS "thread_participants_threadId_userId_key"
  ON "thread_participants" ("threadId", "userId");
-- The badge's query: every thread this person is in.
CREATE INDEX IF NOT EXISTS "thread_participants_userId_idx"
  ON "thread_participants" ("userId");
CREATE INDEX IF NOT EXISTS "thread_messages_threadId_createdAt_idx"
  ON "thread_messages" ("threadId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "thread_participants" ADD CONSTRAINT "thread_participants_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "message_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "thread_participants" ADD CONSTRAINT "thread_participants_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "message_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_senderId_fkey"
    FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- New tables are closed by default like every other (SEC-03).
ALTER TABLE "message_threads"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "thread_participants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "thread_messages"     ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "message_threads"     FROM anon, authenticated;
REVOKE ALL ON "thread_participants" FROM anon, authenticated;
REVOKE ALL ON "thread_messages"     FROM anon, authenticated;

-- ── Carry the existing conversations over ───────────────────────────
--
-- One thread per (org, pair), the pair sorted so that A→B and B→A are the
-- same conversation. `direct_messages` is left in place afterwards, dormant:
-- it is no longer read, and dropping a table to tidy up is how a mistake
-- becomes unrecoverable.
INSERT INTO "message_threads" ("id", "orgId", "participantKey", "lastMessageAt", "createdAt")
SELECT
  gen_random_uuid()::text,
  d."orgId",
  LEAST(d."senderId", d."receiverId") || ',' || GREATEST(d."senderId", d."receiverId"),
  MAX(d."createdAt"),
  MIN(d."createdAt")
FROM "direct_messages" d
GROUP BY d."orgId", LEAST(d."senderId", d."receiverId"), GREATEST(d."senderId", d."receiverId")
ON CONFLICT ("orgId", "participantKey") DO NOTHING;

INSERT INTO "thread_participants" ("id", "threadId", "userId", "lastReadAt", "createdAt")
SELECT DISTINCT ON (t."id", u."userId")
  gen_random_uuid()::text,
  t."id",
  u."userId",
  -- Read up to the newest message they have already opened. Null when they
  -- have opened none, which correctly leaves the whole thread unread.
  (
    SELECT MAX(d2."readAt") FROM "direct_messages" d2
    WHERE d2."orgId" = t."orgId" AND d2."receiverId" = u."userId"
      AND LEAST(d2."senderId", d2."receiverId") || ',' || GREATEST(d2."senderId", d2."receiverId") = t."participantKey"
  ),
  t."createdAt"
FROM "message_threads" t
CROSS JOIN LATERAL (
  SELECT split_part(t."participantKey", ',', 1) AS "userId"
  UNION ALL
  SELECT split_part(t."participantKey", ',', 2)
) u
ON CONFLICT ("threadId", "userId") DO NOTHING;

INSERT INTO "thread_messages" ("id", "threadId", "senderId", "body", "createdAt")
SELECT
  gen_random_uuid()::text,
  t."id",
  d."senderId",
  d."body",
  d."createdAt"
FROM "direct_messages" d
JOIN "message_threads" t
  ON t."orgId" = d."orgId"
 AND t."participantKey" = LEAST(d."senderId", d."receiverId") || ',' || GREATEST(d."senderId", d."receiverId")
WHERE NOT EXISTS (
  SELECT 1 FROM "thread_messages" m
  WHERE m."threadId" = t."id" AND m."senderId" = d."senderId" AND m."createdAt" = d."createdAt"
);
