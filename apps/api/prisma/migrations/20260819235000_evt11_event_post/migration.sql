-- An event carries a post, so members can talk about it (EVT-11).
--
-- Charley's call, 2026-08-19, choosing this over teaching Comment about events.
-- The alternative — a nullable eventId beside postId — would have given every
-- comment query and every moderation path two shapes to handle forever. This
-- way there is one comment model, one moderation surface, one notification
-- path, and `isFlagged` keeps working without knowing events exist.
--
-- Nullable because most events have no discussion, and the post is created the
-- first time one is needed rather than for every event ever made. Unique
-- because two events sharing a thread would mix two conversations.
ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "postId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "events_postId_key" ON "events"("postId");

-- Deleting the backing post detaches the thread rather than deleting the
-- event: an event with its discussion removed is recoverable, an event that
-- vanishes because a post was moderated is not.
ALTER TABLE "events"
  ADD CONSTRAINT "events_postId_fkey" FOREIGN KEY ("postId")
    REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
