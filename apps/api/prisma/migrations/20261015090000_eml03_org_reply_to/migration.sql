-- EML-03: where a member's reply goes, per co-op.
--
-- Nullable with no default, and null means no `Reply-To` header at all —
-- the co-op's mail is no-reply mail until an organiser says otherwise.
-- Every existing co-op therefore keeps exactly the behaviour it had.
ALTER TABLE "organizations" ADD COLUMN "replyToEmail" TEXT;
