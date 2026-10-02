-- MEM-17: a co-op writes its own welcome.
--
-- `WELCOME` joins the kinds an admin can already rewrite, rather than getting
-- a template table of its own — the co-op's own words for an email MaybeOS
-- sends already have a home, and a second one is how one of them ends up
-- weaker than the other.
--
-- Only the enum value, in its own migration: Postgres will not let a new enum
-- value be used in the same transaction that adds it, so nothing here may
-- reference it. `IF NOT EXISTS` makes a re-run a no-op, which is what the
-- connector-then-dev path needs.

ALTER TYPE "BelongingEmailKind" ADD VALUE IF NOT EXISTS 'WELCOME';
