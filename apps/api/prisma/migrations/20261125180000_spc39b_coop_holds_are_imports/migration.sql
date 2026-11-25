-- SPC-39b: write down the relabel that was done by hand.
--
-- SPC-36 added `bookings.source` with DEFAULT 'MAYBEOS' and no backfill, so
-- every row the importer had already created claimed to be ours. 3,024 of
-- MaybeItsFate's were corrected straight against production, by a rule
-- nobody wrote down, and SPC-39 caught 48 that run had missed.
--
-- So production is right and the repository cannot say why. A database
-- restored from a backup taken before 21 November 2026 would carry the bug
-- back in, and the drift check would not notice: it compares migration
-- names, not rows.
--
-- This is a no-op everywhere today — production has nothing left to move and
-- the dev database holds three bookings, none of them imported. It exists so
-- that a dump replayed through the migrations comes out correct.
--
-- Two fingerprints, both conclusive rather than likely:
--
--   1. **A co-op hold.** Nothing in MaybeOS has ever written
--      `isCoopHold = true`; it is what the importer marks a reservation with
--      when it cannot say whose it is (SPC-23), and a member's own booking
--      is never one. A test pins that — the only Prisma `data` block in the
--      API that sets it true is the importer's.
--   2. **A guest line**, as SPC-39. MaybeOS never writes one; it is the line
--      a booking tool puts in a room calendar, and the same line
--      `booking-guest.ts` reads to find out whose reservation it is.
--
-- Together those are 2,946 of the 3,074 rows. The remaining 128 carry no
-- evidence at all — no hold, no guest line, a title and nothing else — and
-- are left alone on purpose. Guessing at them would be the mistake SPC-36
-- made: asserting something about rows this cannot actually know.
--
-- Ownership is untouched here, as in SPC-39. The import decides, and SPC-35
-- keeps a weaker pass from taking a reservation off the member it is already
-- filed under.
UPDATE "bookings"
SET "source" = 'GOOGLE'
WHERE "source" = 'MAYBEOS'
  AND (
    "isCoopHold" = true
    -- `\M` rather than `\b`: that is how a Postgres regex spells the
    -- trailing word boundary, and `\b` is a backspace. The labels are
    -- `LABELS` in `booking-guest.ts`, and the two lists are tested against
    -- each other.
    OR (
      "googleEventId" IS NOT NULL
      AND "description" ~* '(^|\n)\s*(guest|booked by|booked for|reserved by|reserved for|host)\M[^\n]*@[^\s@]+\.[a-z]{2,}'
    )
  );
