-- EVT-46: tickets nobody was told about.
--
-- Eight tickets had been sold through MaybeOS and not one buyer had been
-- emailed, because no code path ever sent them anything. This column is how
-- the backfill and every future sale are told apart.
--
-- Left NULL for the rows that already exist, deliberately: they are exactly
-- the people who are still owed a confirmation, and the scheduler's sweep
-- will send to them on its next run.
ALTER TABLE "tickets" ADD COLUMN "confirmationSentAt" TIMESTAMP(3);

CREATE INDEX "tickets_confirmationSentAt_idx" ON "tickets"("confirmationSentAt");

-- Seats are counted, not stored: Stripe Checkout is created with quantity 1,
-- so somebody buying two tickets is two rows under one address. This index is
-- what makes "how many seats does this address hold for this event" a lookup.
CREATE INDEX "tickets_eventId_buyerEmail_idx" ON "tickets"("eventId", "buyerEmail");
