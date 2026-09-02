-- SPC-13: closing the whole building.
--
-- A separate table rather than a nullable roomId on availability_rules: a
-- room-level rule and a building-level one answer different questions, and an
-- optional roomId would let any query that forgets to filter treat a building
-- closure as belonging to whichever room it joined against.
CREATE TABLE IF NOT EXISTS "org_closures" (
  "id"            TEXT NOT NULL,
  "orgId"         TEXT NOT NULL,
  "label"         TEXT,
  "startTime"     TEXT NOT NULL DEFAULT '00:00',
  "endTime"       TEXT NOT NULL DEFAULT '23:59',
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo"   TIMESTAMP(3) NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "org_closures_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "org_closures_orgId_idx" ON "org_closures"("orgId");

ALTER TABLE "org_closures"
  ADD CONSTRAINT "org_closures_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- SEC-09: new tables arrive with row level security disabled. Every read goes
-- through the API's own tenant scoping, but a table left open is one
-- misconfigured key away from being readable by anyone.
ALTER TABLE "org_closures" ENABLE ROW LEVEL SECURITY;
