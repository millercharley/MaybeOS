-- MEM-04: an invitation can carry the tier it is inviting somebody onto.
--
-- Accepting used to create a membership with no tier and no dues, so an
-- invited member joined free while somebody arriving through the public page
-- paid. Null stays valid and means joining without dues, which is right for
-- staff and for co-ops that do not charge.

ALTER TABLE "invitations"
  ADD COLUMN IF NOT EXISTS "tierId" TEXT;

-- SetNull, not Cascade: deleting a tier must not delete the invitations that
-- referenced it and leave people holding dead links.
ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_tierId_fkey" FOREIGN KEY ("tierId")
  REFERENCES "membership_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
