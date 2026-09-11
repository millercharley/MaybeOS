-- MEM-17: the co-op's equity ledger.
--
-- One row per grant (annual, founder, believer, bounty, referral, or an
-- adjustment), keyed to the holder's email so a grant finds its member the day
-- they join. Balances are summed, never stored.
--
-- Row-level security on and no grants to anon or authenticated, matching every
-- other application table: Supabase's public anon key must not be able to read
-- this one, least of all its holder emails. The API connects as the table
-- owner, which bypasses RLS, exactly as it does for the rest.
--
-- Idempotent: production takes this through the Supabase connector before the
-- code ships, and dev through `prisma migrate deploy`.

DO $$ BEGIN
  CREATE TYPE "ShareGrantKind" AS ENUM ('ANNUAL', 'FOUNDER', 'BELIEVER', 'BOUNTY', 'REFERRAL', 'ADJUSTMENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "share_grants" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "holderEmail" TEXT NOT NULL,
  "holderName" TEXT,
  "kind" "ShareGrantKind" NOT NULL,
  "shares" INTEGER NOT NULL,
  "importBatch" TEXT NOT NULL,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "share_grants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "share_grants_orgId_idx" ON "share_grants"("orgId");
CREATE INDEX IF NOT EXISTS "share_grants_orgId_holderEmail_idx" ON "share_grants"("orgId", "holderEmail");

DO $$ BEGIN
  ALTER TABLE "share_grants"
    ADD CONSTRAINT "share_grants_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "share_grants" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "share_grants" FROM anon, authenticated;
