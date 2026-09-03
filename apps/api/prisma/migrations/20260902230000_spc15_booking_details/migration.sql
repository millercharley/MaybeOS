-- SPC-15: what a booking is actually for.
--
-- A booking carried a title and a description, and the booking screen sent the
-- room's own name as the title — so the room's Google Calendar read "Attic"
-- against a three-hour block, telling an organiser walking past nothing about
-- who was in there or why.
--
-- Defaults chosen so every existing booking stays exactly what it was: private,
-- no attendance figure, no cost, uncategorised.
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "visibility" "EventVisibility" NOT NULL DEFAULT 'PRIVATE',
  ADD COLUMN IF NOT EXISTS "expectedAttendance" INTEGER,
  ADD COLUMN IF NOT EXISTS "hasCost" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
