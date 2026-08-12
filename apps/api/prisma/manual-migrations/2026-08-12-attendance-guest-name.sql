-- IMP-10: record who turned up without an RSVP.
--
-- Attendance could only ever be written for a member with an RSVP, and no
-- screen wrote it at all, so the table held 0 rows and every reach figure in
-- the impact dashboard was structurally zero.
--
-- A door list realistically gets a name or nothing. `guestEmail` already
-- existed but demanding an address to record that a person was present would
-- lose exactly the counts this is for, so walk-ins get their own nullable
-- column rather than a name stuffed into a field named for an address.
--
-- Additive and nullable: safe to apply before the code that writes it.

ALTER TABLE "attendance" ADD COLUMN "guestName" TEXT;
