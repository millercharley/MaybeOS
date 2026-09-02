-- SPC-12: a closure can say why the room is shut.
--
-- Without it the booking screen can only grey a row out, and a member cannot
-- tell a public holiday from a mistake in the opening hours.
ALTER TABLE "availability_rules"
  ADD COLUMN IF NOT EXISTS "label" TEXT;
