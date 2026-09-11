-- SPC-22: who a booking or event is suitable for.
--
-- Asked of the host when a room is booked (All ages, 13+, 18+, 21+) and
-- carried onto the event when a booking is published (EVT-17), which is where
-- people outside the co-op read it.
--
-- NOT NULL with an all-ages default, following SPC-15's booking questions:
-- every existing booking and event stays exactly what it was, and the product
-- only ever displays the restricting answers.
--
-- Idempotent, because production takes this through the Supabase connector
-- before the code ships and dev takes it through `prisma migrate deploy`.

DO $$ BEGIN
  CREATE TYPE "MaturityLevel" AS ENUM ('ALL_AGES', 'AGES_13_PLUS', 'AGES_18_PLUS', 'AGES_21_PLUS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "maturityLevel" "MaturityLevel" NOT NULL DEFAULT 'ALL_AGES';

ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "maturityLevel" "MaturityLevel" NOT NULL DEFAULT 'ALL_AGES';
