-- MEM-19: share tracking an admin switches on, and grants made in MaybeOS.
--
-- `sharesEnabled` on the co-op, off by default — kept on for any co-op that has
-- already recorded shares. Grants gain the member they name (so a changed
-- email cannot detach them), a source (so re-importing the cap table replaces
-- only what the last import wrote), a note, and who granted them.
--
-- Idempotent: production through the Supabase connector before the code
-- ships, dev through `prisma migrate deploy`. share_grants keeps its RLS and
-- its revoked anon/authenticated grants; new columns inherit both.

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "sharesEnabled" BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  CREATE TYPE "ShareGrantSource" AS ENUM ('IMPORT', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "share_grants"
  ADD COLUMN IF NOT EXISTS "userId" TEXT,
  ADD COLUMN IF NOT EXISTS "source" "ShareGrantSource" NOT NULL DEFAULT 'IMPORT',
  ADD COLUMN IF NOT EXISTS "note" TEXT,
  ADD COLUMN IF NOT EXISTS "grantedById" TEXT;

ALTER TABLE "share_grants" ALTER COLUMN "importBatch" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "share_grants_orgId_userId_idx" ON "share_grants"("orgId", "userId");

DO $$ BEGIN
  ALTER TABLE "share_grants"
    ADD CONSTRAINT "share_grants_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

UPDATE "organizations" SET "sharesEnabled" = true
  WHERE "id" IN (SELECT DISTINCT "orgId" FROM "share_grants");
