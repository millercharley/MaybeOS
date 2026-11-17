-- CMN-22: a teaching offering gets a thread in the Commons.
--
-- Charley, 2026-11-17: "Anytime a new event or teaching offering is shared to
-- members of the co-op, add this as a timeline post in the Commons in either
-- the #Events channel or the #Teaching channel... This should make it easy for
-- members to reply to ask questions."
--
-- Events already had this half-built (EVT-42): `events.postId` points at the
-- post carrying the conversation. This gives `offerings` the same column and
-- the same shape, so the two features are one idea rather than two.
--
-- UNIQUE, matching `events.postId`. One post belongs to one offering, and the
-- constraint is what makes the claim-by-update safe when two requests race:
-- both create a post, only one can attach it, and the loser deletes the post
-- it made rather than orphaning the winner's thread.
--
-- ON DELETE SET NULL, never CASCADE. Deleting an offering must not delete a
-- conversation members have been having — the thread stays in #Teaching with
-- its replies intact, which is what everyone who wrote in it expects. The
-- same reasoning TCH-01 used for an offering's dates.

ALTER TABLE "offerings" ADD COLUMN IF NOT EXISTS "postId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'offerings_postId_key'
  ) THEN
    ALTER TABLE "offerings" ADD CONSTRAINT "offerings_postId_key" UNIQUE ("postId");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'offerings_postId_fkey'
  ) THEN
    ALTER TABLE "offerings"
      ADD CONSTRAINT "offerings_postId_fkey"
      FOREIGN KEY ("postId") REFERENCES "posts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
