-- PAY-10: a dues payment remembers who made it.
--
-- `dues_payments."userOrgId"` is ON DELETE SET NULL, so removing a member
-- detaches their payments from them. Found on 2026-10-02, twenty minutes
-- after the removal shipped: Charley removed a paying test member and their
-- $19.50 stayed in the ledger with nobody attached to it.
--
-- The co-op's totals were never at risk — those read `orgId` — but *who paid*
-- was gone, which is the wrong half to lose when somebody asks for a receipt
-- or a refund. CASCADE would be worse: it deletes the money too.
--
-- So the payment carries the payer's name and address itself. Denormalised on
-- purpose. A payment is a historical fact, and a fact that depends on a row
-- somebody can delete is not one you can rely on afterwards — the same reason
-- a recap freezes its figures rather than recomputing them.
--
-- These are PII and stay out of anything a member or an organiser is shown;
-- the ledger and the member card still show no addresses (D-020).
--
-- Idempotent: production takes this through the Supabase connector before the
-- code ships, and dev through `prisma migrate deploy`.

ALTER TABLE "dues_payments" ADD COLUMN IF NOT EXISTS "payerName" TEXT;
ALTER TABLE "dues_payments" ADD COLUMN IF NOT EXISTS "payerEmail" TEXT;

-- Backfill everything still attached to somebody. Rows already detached
-- cannot be recovered here — their membership is gone — and are left null,
-- which is the honest answer rather than a guess from a customer id.
UPDATE "dues_payments" dp
SET "payerName" = u."name",
    "payerEmail" = u."email"
FROM "user_orgs" uo
JOIN "users" u ON u."id" = uo."userId"
WHERE dp."userOrgId" = uo."id"
  AND dp."payerEmail" IS NULL;
