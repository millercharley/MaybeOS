-- MEM-19: a second address the same person reads.
--
-- MaybeItsFate's roster has people billed at one address and signed up to its
-- forum at another — the same person, two records, and nothing in either file
-- says which one they still read. Choosing wrong is invisible: the sign-in
-- link arrives somewhere nobody looks, and the member concludes MaybeOS does
-- not work rather than that MaybeOS has the wrong address.
--
-- So both travel. Mail MaybeOS sends a member is copied to the second
-- address rather than sent twice: one message, one conversation, one link.
--
-- On the membership rather than the account, like everything else a member
-- tells one co-op — what somebody gives one is not consent to use it in
-- another (D-020).
--
-- Idempotent: production takes this through the Supabase connector before the
-- code ships, and dev through `prisma migrate deploy`.

ALTER TABLE "user_orgs" ADD COLUMN IF NOT EXISTS "altEmail" TEXT;
