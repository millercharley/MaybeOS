-- MEM-24: what Postmark says actually happened to each sign-in link.
--
-- `signInSentAt` is written before the provider is called, so it records an
-- attempt and not a delivery. When Postmark's plan capped at a hundred
-- messages, 435 members were marked and ~335 of them never received anything;
-- these columns are how MaybeOS can tell those two groups apart.
ALTER TABLE "user_orgs"
  ADD COLUMN "signInDeliveredAt" TIMESTAMP(3),
  ADD COLUMN "signInBouncedAt"   TIMESTAMP(3),
  ADD COLUMN "signInBounceKind"  TEXT,
  ADD COLUMN "signInAuditedAt"   TIMESTAMP(3);

-- The audit reads "everybody this org has written to" and the resend reads
-- "everybody the audit could not account for". Both are org-scoped scans over
-- a column that is null for most rows, so a partial index on the sent ones is
-- the whole working set.
CREATE INDEX "user_orgs_signin_audit_idx"
  ON "user_orgs" ("orgId", "signInSentAt")
  WHERE "signInSentAt" IS NOT NULL;
