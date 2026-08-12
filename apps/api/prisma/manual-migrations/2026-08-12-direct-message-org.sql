-- Direct messages belong to an organization (CMN-08)
--
-- Charley's decision, 2026-08-12: orgs are firewalled. A member of one co-op
-- must not see or message a member of another. CMN-07 enforced that at the
-- boundary; this puts it in the data.
--
-- The DDL is `prisma migrate diff` output. The backfill around it is written
-- by hand, because the generated version is a bare
-- `ADD COLUMN "orgId" TEXT NOT NULL`, which cannot be applied to a table that
-- already holds messages.
--
-- Strategy: add the column nullable, derive each message's org from the one
-- its two participants share, then enforce NOT NULL. A message whose
-- participants share no org cannot belong anywhere under the new model — that
-- is precisely the cross-org message the firewall forbids — so the migration
-- REFUSES rather than guessing or deleting. If it raises, inspect those rows
-- and decide deliberately.

-- 1. Nullable first, so existing rows survive to be backfilled.
ALTER TABLE "direct_messages" ADD COLUMN "orgId" TEXT;

-- 2. Derive the org from the participants' shared membership.
UPDATE "direct_messages" dm
SET "orgId" = (
  SELECT uo_sender."orgId"
  FROM "user_orgs" uo_sender
  JOIN "user_orgs" uo_receiver
    ON uo_receiver."orgId" = uo_sender."orgId"
   AND uo_receiver."userId" = dm."receiverId"
  WHERE uo_sender."userId" = dm."senderId"
  ORDER BY uo_sender."orgId"
  LIMIT 1
)
WHERE dm."orgId" IS NULL;

-- 3. Refuse to continue if anything could not be placed.
DO $$
DECLARE orphaned INTEGER;
BEGIN
  SELECT count(*) INTO orphaned FROM "direct_messages" WHERE "orgId" IS NULL;
  IF orphaned > 0 THEN
    RAISE EXCEPTION
      'CMN-08: % direct message(s) are between users who share no organization. They cannot be assigned an org. Inspect them and decide before re-running.', orphaned;
  END IF;
END $$;

-- 4. Now it can be required.
ALTER TABLE "direct_messages" ALTER COLUMN "orgId" SET NOT NULL;

-- 5. Indexes and the foreign key (generated).
DROP INDEX IF EXISTS "direct_messages_senderId_receiverId_idx";
CREATE INDEX "direct_messages_orgId_senderId_receiverId_idx" ON "direct_messages"("orgId", "senderId", "receiverId");
CREATE INDEX "direct_messages_orgId_idx" ON "direct_messages"("orgId");
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
