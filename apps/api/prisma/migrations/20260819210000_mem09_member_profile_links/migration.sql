-- Links a member chooses to show on their profile (MEM-09).
--
-- On the membership rather than the account, for the reason D-020 and IMP-17
-- both give: orgs are firewalled, and the links somebody is willing to publish
-- to one co-op are not consent to publish them in another. A member of two
-- co-ops can show their studio shop to one and not the other.
--
-- Plain text[] rather than a table or JSON: these are a short, ordered list of
-- URLs with no attributes of their own, which is exactly what `tags` beside it
-- already is. Scheme validation happens at the API — a stored `javascript:`
-- URL rendered as a link on a page other members read is the thing to prevent,
-- and the database cannot check that.
ALTER TABLE "user_orgs"
  ADD COLUMN IF NOT EXISTS "links" TEXT[] NOT NULL DEFAULT '{}';
