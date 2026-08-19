-- MEM-06: the fields an existing community arrives with.
--
-- Importing a co-op from Circle turned up four things MaybeOS had nowhere to
-- put. Three sit on the membership rather than the account, for the reason
-- `bio`, `tags` and `links` already do (D-020): orgs are firewalled, and what
-- somebody tells one co-op is not consent to tell another.
ALTER TABLE "user_orgs" ADD COLUMN IF NOT EXISTS "headline" TEXT;
ALTER TABLE "user_orgs" ADD COLUMN IF NOT EXISTS "location" TEXT;

-- Nullable on purpose, three-valued: true opted in, false opted out, NULL
-- never asked. A default of false would record 300 people as having declined
-- something nobody put to them, and a default of true would manufacture
-- consent — which is the one thing a marketing opt-in must never do.
ALTER TABLE "user_orgs" ADD COLUMN IF NOT EXISTS "emailOptIn" BOOLEAN;

-- The avatar as MaybeOS holds it, rather than as somebody else's CDN lends it.
-- An imported avatar URL points at the community platform being left behind
-- and dies with that account, so the bytes are copied into MaybeOS's own
-- private bucket and this records where. `avatarUrl` still holds an external
-- URL when that is all there is; a path here wins.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatarPath" TEXT;
