-- NAV-02: links to things a co-op keeps outside MaybeOS.
--
-- Additive: a new table, empty for every co-op, and nothing renders until an
-- admin adds a link.
CREATE TABLE "org_links" (
  "id"        TEXT NOT NULL,
  "orgId"     TEXT NOT NULL,
  "label"     TEXT NOT NULL,
  "url"       TEXT NOT NULL,
  "position"  INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "org_links_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "org_links_orgId_position_idx" ON "org_links"("orgId", "position");

ALTER TABLE "org_links" ADD CONSTRAINT "org_links_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SEC-09: new tables arrive with RLS disabled and must enable it explicitly.
ALTER TABLE "org_links" ENABLE ROW LEVEL SECURITY;
