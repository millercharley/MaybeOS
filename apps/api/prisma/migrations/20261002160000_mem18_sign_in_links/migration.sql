-- MEM-18: the email a co-op moving in sends its whole roster.
--
-- `inviteMember` refuses anybody who already has a membership — "This person
-- is already a member of this organization" — so after a CSV import the
-- invitation path is closed for exactly the people who need contacting. An
-- imported member has an account with no password and has belonged to the
-- co-op for years; what they need is not an invitation to join but a way to
-- sign in.
--
-- `signInSentAt` is the marker that makes that send resumable and stops a
-- second run reaching the people the first one already did, the same job
-- `doorPinEmailedAt` does for door codes.
--
-- `inviteExpiryDays` makes the seven days configurable. Seven is right for
-- inviting one person and wrong for inviting 364 at once, where it means
-- somebody comes back from a holiday to a dead link.
--
-- The two enum values go in their own statements below: Postgres will not let
-- a new enum value be used in the transaction that adds it, and nothing here
-- uses them.
--
-- Idempotent: production takes this through the Supabase connector before the
-- code ships, and dev through `prisma migrate deploy`.

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "inviteExpiryDays" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "user_orgs" ADD COLUMN IF NOT EXISTS "signInSentAt" TIMESTAMP(3);

ALTER TYPE "BelongingEmailKind" ADD VALUE IF NOT EXISTS 'INVITE';
ALTER TYPE "BelongingEmailKind" ADD VALUE IF NOT EXISTS 'SIGN_IN';
