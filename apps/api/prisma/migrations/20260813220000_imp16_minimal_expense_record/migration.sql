-- IMP-16: a deliberately minimal expense record, amending D-021.
--
-- D-021's non-goals list bookkeeping, and that still stands. This is the
-- smallest thing that gives cost-per-outcome and mission-alignment-of-spend a
-- denominator: no vendors, no invoices, no payment status, no reconciliation,
-- no attachments, no approvals, no double entry. A co-op's books stay in its
-- accounting software.

CREATE TABLE IF NOT EXISTS "expenses" (
  "id"          TEXT NOT NULL,
  "orgId"       TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "incurredOn"  TIMESTAMP(3) NOT NULL,
  "category"    TEXT NOT NULL,
  "goalKey"     TEXT,
  "description" TEXT,
  "createdBy"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "expenses_orgId_incurredOn_idx" ON "expenses"("orgId", "incurredOn");
CREATE INDEX IF NOT EXISTS "expenses_orgId_goalKey_idx"    ON "expenses"("orgId", "goalKey");

ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_orgId_fkey" FOREIGN KEY ("orgId")
  REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nulled rather than cascading: an admin leaving must not delete the co-op's
-- financial history.
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_createdBy_fkey" FOREIGN KEY ("createdBy")
  REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
