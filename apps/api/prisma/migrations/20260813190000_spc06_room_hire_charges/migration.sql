-- SPC-06: charging for room hire.
--
-- `rooms.hourlyRate` has existed since SpaceOS was built and nothing ever read
-- it. Charging is off unless an admin switches it on AND sets a rate, so an
-- existing room cannot start billing people because this migration ran.

-- A slot held while its payment is in flight. A room hour is exclusive, so
-- unlike a ticket it cannot be sold twice and reconciled afterwards.
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'PENDING_PAYMENT';

ALTER TABLE "rooms"
  ADD COLUMN IF NOT EXISTS "chargeForBooking" BOOLEAN NOT NULL DEFAULT false;

-- Nullable throughout: a free room, which is the default, records none of it.
-- Amounts are stored per booking rather than recomputed from the room, so
-- changing a rate in June does not change what somebody paid in March.
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "priceCents" INTEGER,
  ADD COLUMN IF NOT EXISTS "platformFeeCents" INTEGER,
  ADD COLUMN IF NOT EXISTS "amountCents" INTEGER,
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'usd',
  ADD COLUMN IF NOT EXISTS "stripeSessionId" TEXT,
  ADD COLUMN IF NOT EXISTS "stripePaymentIntentId" TEXT,
  ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "refundedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "holdExpiresAt" TIMESTAMP(3);

-- One booking per Stripe session: the idempotency guard for webhook retries.
CREATE UNIQUE INDEX IF NOT EXISTS "bookings_stripeSessionId_key"
  ON "bookings"("stripeSessionId");
