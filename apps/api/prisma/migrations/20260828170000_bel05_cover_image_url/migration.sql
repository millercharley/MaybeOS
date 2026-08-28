-- BEL-05: the cover column holds a URL, so name it one.
--
-- It was `coverImagePath`, which promised a private storage path needing
-- per-request signing like an avatar. Cover art for a co-op's own house rules
-- is org-level content rather than member PII — the same kind of thing as
-- `organizations.logoUrl` — and signing it would have bought nothing while
-- making the field lie about what it holds.
--
-- Safe as a rename: the table is new and empty in every environment.
ALTER TABLE "knowledge_articles" RENAME COLUMN "coverImagePath" TO "coverImageUrl";
