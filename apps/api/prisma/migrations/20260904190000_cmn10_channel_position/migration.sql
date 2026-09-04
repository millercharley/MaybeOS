-- CMN-10: an admin can put the Commons channels in an order.
--
-- Zero for everything that exists, which keeps the order every co-op has now:
-- the list sorts by position and then falls back to creation date, so an
-- untouched co-op is unchanged. Purely additive.
ALTER TABLE "channels" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "channels_orgId_position_idx" ON "channels"("orgId", "position");
