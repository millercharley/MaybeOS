-- URGENT: production is missing organizations."allowPublicJoin".
--
-- MEM-03 shipped the public-join toggle and its code, and the production
-- database never got the column. Every query that reads a whole organization
-- row therefore fails in production:
--
--   GET /api/orgs/by-slug/maybeitsfate                  -> 500
--   GET /api/public/events/maybeitsfate/<event-slug>    -> 500
--
-- so MaybeItsFate's public page and its public event pages are broken. The
-- web pages themselves return 200 because they are client-rendered shells;
-- the failure appears once the data fetch runs.
--
-- Found by OPS-04, comparing dev and prod column by column: 293 columns
-- against 292, and this is the one. Every other table, column and enum
-- matches exactly.
--
-- DEFAULT false is deliberate and matches the schema. MaybeItsFate stays
-- invitation-only after this runs — applying it does not open the doors to
-- the public, it restores the control that decides.

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "allowPublicJoin" BOOLEAN NOT NULL DEFAULT false;
