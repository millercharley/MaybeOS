-- Files members attach to a post, a comment or an event.
--
-- The row records what was uploaded and what it belongs to; the bytes live in
-- the private `attachments` bucket in the same Supabase project as this
-- database, so a file and the row referencing it can never drift into
-- different accounts.
--
-- Exactly one of postId / commentId / eventId is set. Enforced by a check
-- constraint rather than left to the service, because an attachment belonging
-- to two things at once — or to nothing — is not a state any code should have
-- to reason about later.
CREATE TABLE IF NOT EXISTS "attachments" (
  "id"         TEXT NOT NULL,
  "orgId"      TEXT NOT NULL,
  "uploaderId" TEXT NOT NULL,
  "postId"     TEXT,
  "commentId"  TEXT,
  "eventId"    TEXT,
  -- Object key inside the bucket, always `<orgId>/<uuid>.<ext>`. Unique so a
  -- path cannot be claimed twice by two rows.
  "path"       TEXT NOT NULL,
  "fileName"   TEXT NOT NULL,
  "mimeType"   TEXT NOT NULL,
  "sizeBytes"  INTEGER NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attachments_one_owner" CHECK (
    (("postId" IS NOT NULL)::int + ("commentId" IS NOT NULL)::int + ("eventId" IS NOT NULL)::int) = 1
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "attachments_path_key" ON "attachments"("path");
CREATE INDEX IF NOT EXISTS "attachments_orgId_idx" ON "attachments"("orgId");
CREATE INDEX IF NOT EXISTS "attachments_postId_idx" ON "attachments"("postId");
CREATE INDEX IF NOT EXISTS "attachments_commentId_idx" ON "attachments"("commentId");
CREATE INDEX IF NOT EXISTS "attachments_eventId_idx" ON "attachments"("eventId");

-- Deleting what an attachment belongs to takes the row with it. The object in
-- the bucket is removed by the service on the same path; a failure there
-- orphans a file rather than leaving a row pointing at nothing.
ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_orgId_fkey" FOREIGN KEY ("orgId")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "attachments_uploaderId_fkey" FOREIGN KEY ("uploaderId")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "attachments_postId_fkey" FOREIGN KEY ("postId")
    REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "attachments_commentId_fkey" FOREIGN KEY ("commentId")
    REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "attachments_eventId_fkey" FOREIGN KEY ("eventId")
    REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SEC-09: a table created later does not inherit the org-wide RLS, and arrives
-- with it disabled. Enabled with no policies, which denies every role that does
-- not bypass it — the API connects as `postgres`, which does.
ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;
