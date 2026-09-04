-- CMN-09: a comment records when its author rewrote it.
--
-- Not `updatedAt`, which moves for any write — flagging a comment for
-- moderation would otherwise mark it "edited" and accuse somebody of changing
-- their words. Nullable with no default: every comment that exists now has
-- never been edited, which is true.
ALTER TABLE "comments" ADD COLUMN "editedAt" TIMESTAMP(3);
