-- SRV-04: a reminder on the morning of a turn.
--
-- Charley took the Saturday watering turn and asked for "email reminders the
-- morning of the date, plus a reminder on the Dashboard". A duty nobody is
-- reminded of is a duty somebody forgets, and the co-op finds out when the
-- plants are dry.
--
-- Marked before the email is sent, not after: EmailService swallows its own
-- failures, so a null here after a send would have the next quarter-hour send
-- it again. A reminder that arrives twice is worse than one that did not
-- arrive — it is the one somebody stops reading.
--
-- Idempotent: production takes this through the Supabase connector before the
-- code ships, and dev through `prisma migrate deploy`.

ALTER TABLE "duty_claims" ADD COLUMN IF NOT EXISTS "remindedAt" TIMESTAMP(3);

-- The sweep asks "whose turn is today and has not been reminded", which is a
-- query over two columns on every run.
CREATE INDEX IF NOT EXISTS "duty_claims_remindedAt_occursAt_idx"
  ON "duty_claims" ("remindedAt", "occursAt");
