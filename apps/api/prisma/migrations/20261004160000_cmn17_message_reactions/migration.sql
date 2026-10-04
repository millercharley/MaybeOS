-- CMN-17: an emoji on any message.
--
-- Charley: "Make sure people can leave an emoji reaction on any message."
--
-- Posts in the Commons already had reactions. Messages in a conversation did
-- not, and neither did comments — so "any" is two new tables.
--
-- Their own tables rather than a nullable parent on `reactions`: a
-- polymorphic parent cannot carry a foreign key, and without one a deleted
-- message leaves its reactions behind forever. Three small tables that each
-- delete with their parent beat one clever one that does not.

CREATE TABLE IF NOT EXISTS "thread_message_reactions" (
  "id"        TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "emoji"     TEXT NOT NULL,
  CONSTRAINT "thread_message_reactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "comment_reactions" (
  "id"        TEXT NOT NULL,
  "commentId" TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "emoji"     TEXT NOT NULL,
  CONSTRAINT "comment_reactions_pkey" PRIMARY KEY ("id")
);

-- One of each emoji per person per message. Pressing again removes it, and
-- this is what makes a double-tap idempotent rather than two hearts.
CREATE UNIQUE INDEX IF NOT EXISTS "thread_message_reactions_messageId_userId_emoji_key"
  ON "thread_message_reactions" ("messageId", "userId", "emoji");
CREATE INDEX IF NOT EXISTS "thread_message_reactions_messageId_idx"
  ON "thread_message_reactions" ("messageId");
CREATE UNIQUE INDEX IF NOT EXISTS "comment_reactions_commentId_userId_emoji_key"
  ON "comment_reactions" ("commentId", "userId", "emoji");
CREATE INDEX IF NOT EXISTS "comment_reactions_commentId_idx"
  ON "comment_reactions" ("commentId");

DO $$ BEGIN
  ALTER TABLE "thread_message_reactions" ADD CONSTRAINT "thread_message_reactions_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "thread_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "thread_message_reactions" ADD CONSTRAINT "thread_message_reactions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_commentId_fkey"
    FOREIGN KEY ("commentId") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "thread_message_reactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "comment_reactions"        ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "thread_message_reactions" FROM anon, authenticated;
REVOKE ALL ON "comment_reactions"        FROM anon, authenticated;
