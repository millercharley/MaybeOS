-- AUTH-07: one spelling of an email address.
--
-- `users.email` is unique and case-sensitive, so `Jonleecope@bellsouth.net`
-- and `jonleecope@bellsouth.net` were two people. A member of MaybeItsFate
-- typed their own address with a capital, was not recognised, was offered a
-- co-op of their own instead, and took it — ending with two accounts, two
-- passwords, and a duplicate of their own community.
--
-- The code fix (normalising on register, sign-in and magic link) stops new
-- ones. This brings the stored rows into line.
--
-- **Deliberately leaves collisions alone.** Lowercasing an address whose
-- lowercase form already belongs to somebody else would either violate the
-- unique index or, worse, quietly merge two people. Those pairs are a
-- judgement call about which account survives, and that is a person's
-- decision rather than a migration's.
UPDATE "users" u
SET "email" = lower(u."email")
WHERE u."email" <> lower(u."email")
  AND NOT EXISTS (
    SELECT 1 FROM "users" other
    WHERE other."id" <> u."id"
      AND other."email" = lower(u."email")
  );

-- No unique index on lower(email) yet, and that is on purpose: one collision
-- is outstanding at the time of writing, and adding the index would fail the
-- migration rather than report it. It follows once that pair is resolved —
-- see the second half of AUTH-07.
