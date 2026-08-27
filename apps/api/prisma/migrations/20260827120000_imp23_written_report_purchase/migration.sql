-- IMP-23: the written year-end report, and the $50 that buys it (D-031).
--
-- Two reports exist from here on. BASIC is the deterministic reading IMP-22
-- already produces from frozen figures, and stays free forever — the PRD's
-- promise is that a co-op states a goal and gets a report back, and a paywall
-- across that promise would be a different product. WRITTEN is the same
-- frozen figures with prose composed around them.

CREATE TYPE "ReportTier" AS ENUM ('BASIC', 'WRITTEN');

-- Existing reports are all the free kind. Defaulting to BASIC rather than
-- backfilling keeps that true without touching a published row.
ALTER TABLE "impact_reports"
  ADD COLUMN IF NOT EXISTS "tier" "ReportTier" NOT NULL DEFAULT 'BASIC';

CREATE TYPE "ImpactReportPurchaseStatus" AS ENUM ('PENDING', 'PAID', 'REFUNDED');

-- The purchase is of a reporting PERIOD, not of a document. A co-op that pays
-- for 2026 can regenerate, revise and republish its 2026 written report as
-- often as it likes; charging per generation would make a co-op ration exactly
-- the revisions that make a report honest.
CREATE TABLE IF NOT EXISTS "impact_report_purchases" (
  "id"                      TEXT NOT NULL,
  "orgId"                   TEXT NOT NULL,
  -- Copied from the report the admin was looking at when they bought, then
  -- frozen. Moving it would silently re-scope what was paid for.
  "periodStart"             TIMESTAMP(3) NOT NULL,
  "periodEnd"               TIMESTAMP(3) NOT NULL,
  "amountCents"             INTEGER NOT NULL,
  "status"                  "ImpactReportPurchaseStatus" NOT NULL DEFAULT 'PENDING',
  "stripeCheckoutSessionId" TEXT,
  "stripePaymentIntentId"   TEXT,
  -- Nullable: removing an admin must not delete the co-op's entitlement along
  -- with them.
  "purchasedById"           TEXT,
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt"                  TIMESTAMP(3),
  "updatedAt"               TIMESTAMP(3) NOT NULL,
  CONSTRAINT "impact_report_purchases_pkey" PRIMARY KEY ("id")
);

-- Unique so a webhook redelivery settles the row it already settled rather
-- than minting a second entitlement. Stripe retries; this is not theoretical.
CREATE UNIQUE INDEX IF NOT EXISTS "impact_report_purchases_stripeCheckoutSessionId_key"
  ON "impact_report_purchases"("stripeCheckoutSessionId");
CREATE INDEX IF NOT EXISTS "impact_report_purchases_orgId_status_idx"
  ON "impact_report_purchases"("orgId", "status");
CREATE INDEX IF NOT EXISTS "impact_report_purchases_orgId_periodStart_periodEnd_idx"
  ON "impact_report_purchases"("orgId", "periodStart", "periodEnd");

ALTER TABLE "impact_report_purchases"
  ADD CONSTRAINT "impact_report_purchases_orgId_fkey" FOREIGN KEY ("orgId")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "impact_report_purchases"
  ADD CONSTRAINT "impact_report_purchases_purchasedById_fkey" FOREIGN KEY ("purchasedById")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SEC-09: new tables arrive with RLS disabled and must enable it explicitly.
ALTER TABLE "impact_report_purchases" ENABLE ROW LEVEL SECURITY;
