-- SPC-39: a reservation the importer created is not a MaybeOS booking.
--
-- SPC-36 added `bookings.source` so the import would stop re-deriving who a
-- MaybeOS booking belongs to. It added the column with DEFAULT 'MAYBEOS' and
-- no backfill — so every row that already existed, including the thousands
-- the importer itself had created, began claiming to be ours.
--
-- That is worse than the bug SPC-36 fixed, because SPC-36's guard is
-- absolute: `ours` means the import declines to look at ownership at all.
-- A reservation the import had filed under the wrong person was therefore
-- frozen under them, and every later pass — including the ones that can now
-- read a guest line (SPC-25), a title (SPC-34) and a guest's name (SPC-38)
-- — declined to correct it.
--
-- At MaybeItsFate, 3,024 of those rows were later relabelled GOOGLE by hand;
-- 50 were missed, and all 50 are rows the import had attributed to somebody.
-- Eight of them sat in the first organiser's My Bookings — the fallback
-- owner, which is who an unmatched reservation is filed under — showing him
-- six upcoming evenings in the Attic that another member had booked through
-- the co-op's old calendar tool.
--
-- The fingerprint is the description. MaybeOS never writes a "Guest •" line;
-- a booking tool writing into a room calendar is the only thing that does,
-- and it is the same line `booking-guest.ts` reads to find out whose
-- reservation it is. A row carrying one was created by the importer from
-- that calendar, whatever its `source` column says.
--
-- Nothing here touches ownership. Handing these back to the import is the
-- whole point: its own rules decide, and SPC-35 protects the ones already
-- attributed to a real member — a pass with weaker evidence may no longer
-- take a reservation off somebody.
UPDATE "bookings"
SET "source" = 'GOOGLE'
WHERE "source" = 'MAYBEOS'
  AND "googleEventId" IS NOT NULL
  -- `\M` rather than `\b`: Postgres regexes spell the trailing word boundary
  -- that way, and `\b` is a backspace. The labels are `LABELS` in
  -- `booking-guest.ts`; the two lists mean the same thing and are tested
  -- against each other.
  AND "description" ~* '(^|\n)\s*(guest|booked by|booked for|reserved by|reserved for|host)\M[^\n]*@[^\s@]+\.[a-z]{2,}';
