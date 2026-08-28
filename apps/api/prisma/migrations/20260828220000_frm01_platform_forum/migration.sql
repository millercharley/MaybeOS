-- FRM-01: MaybeOS's own forum, where every co-op's organisers meet.
--
-- A real organization rather than a bespoke feature, so it inherits channels,
-- posts, proposals and moderation for free. The flag exists only for the
-- handful of places the forum must not behave like a co-op: never billed,
-- never listed as a customer in the platform console, and never triggering
-- its own auto-join.
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "isPlatformForum" BOOLEAN NOT NULL DEFAULT false;

-- At most one. A second forum would silently split the community in half and
-- nothing else in the system would notice.
CREATE UNIQUE INDEX IF NOT EXISTS "organizations_one_platform_forum"
  ON "organizations" (("isPlatformForum")) WHERE "isPlatformForum";

-- Leaving the forum deletes the membership row, which leaves no trace — so
-- without this, founding a second co-op would drag somebody straight back
-- into a forum they had already left.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "forumOptOutAt" TIMESTAMP(3);
