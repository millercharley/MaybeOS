-- PLT-05: MaybeOS's own documentation.
--
-- Charley: "the Admin should see MaybeOS documentation on how to manage
-- everything, including setup decisions and migration options... All Admins
-- should see this documentation... make sure that I, as a Super Admin, can
-- edit the articles and add additional screenshots."
--
-- Deliberately not scoped to a co-op, which is the one way this differs from
-- `knowledge_articles` that matters: a co-op's handbook belongs to that co-op,
-- this is written once and read by the organisers of every co-op on MaybeOS.
-- An orgId here would mean four hundred copies of one page drifting apart.
CREATE TABLE IF NOT EXISTS "support_articles" (
  "id"          TEXT NOT NULL,
  "slug"        TEXT NOT NULL,
  "title"       TEXT NOT NULL,
  "summary"     TEXT,
  "category"    TEXT NOT NULL DEFAULT 'Getting started',
  "body"        TEXT NOT NULL,
  "position"    INTEGER NOT NULL DEFAULT 0,
  "state"       "ArticleState" NOT NULL DEFAULT 'PUBLISHED',
  "updatedById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_articles_pkey" PRIMARY KEY ("id")
);

-- Screenshots, plural and over time, which is why they are their own rows.
-- Private bucket and signed on read like every other upload: a picture of an
-- admin screen is still a picture of somebody's admin screen.
CREATE TABLE IF NOT EXISTS "support_article_images" (
  "id"        TEXT NOT NULL,
  "articleId" TEXT NOT NULL,
  "path"      TEXT NOT NULL,
  "caption"   TEXT,
  "position"  INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_article_images_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "support_articles_slug_key" ON "support_articles" ("slug");
CREATE INDEX IF NOT EXISTS "support_articles_category_position_idx" ON "support_articles" ("category", "position");
CREATE INDEX IF NOT EXISTS "support_article_images_articleId_position_idx" ON "support_article_images" ("articleId", "position");

DO $$ BEGIN
  ALTER TABLE "support_articles" ADD CONSTRAINT "support_articles_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "support_article_images" ADD CONSTRAINT "support_article_images_articleId_fkey"
    FOREIGN KEY ("articleId") REFERENCES "support_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "support_articles"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_article_images" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "support_articles"       FROM anon, authenticated;
REVOKE ALL ON "support_article_images" FROM anon, authenticated;
