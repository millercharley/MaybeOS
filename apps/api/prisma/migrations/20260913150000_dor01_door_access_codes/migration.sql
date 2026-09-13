-- DOR-01: door codes, and the sheet the door application reads.
--
-- The code lives on the membership rather than the account, because a code
-- opens one co-op's door: somebody who belongs to two co-ops has two doors.
--
-- `(orgId, doorPin)` is unique so two members of a co-op can never share a
-- code. Postgres treats nulls as distinct, so the memberships that have no
-- code yet — which is all of them, at this point — do not collide with each
-- other; the constraint only binds once a code exists.
--
-- Everything is nullable and off by default, so this changes nothing for any
-- co-op until an organiser turns it on and names a sheet.
--
-- Idempotent: production takes this through the Supabase connector before the
-- code ships, and dev through `prisma migrate deploy`.

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "doorAccessEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "doorSheetId" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "doorCodeEmailsEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "user_orgs" ADD COLUMN IF NOT EXISTS "doorPin" TEXT;
ALTER TABLE "user_orgs" ADD COLUMN IF NOT EXISTS "doorPinIssuedAt" TIMESTAMP(3);
ALTER TABLE "user_orgs" ADD COLUMN IF NOT EXISTS "doorPinSyncedAt" TIMESTAMP(3);
ALTER TABLE "user_orgs" ADD COLUMN IF NOT EXISTS "doorPinEmailedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "user_orgs_orgId_doorPin_key" ON "user_orgs"("orgId", "doorPin");
