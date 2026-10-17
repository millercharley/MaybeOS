-- CMN-19: tell a member when somebody writes to them.
--
-- `notifiedAt` carries the suppression rule: told once that a conversation is
-- waiting, and not again until it has been opened. Null means never told, so
-- every existing participant is eligible for the first notification.
--
-- `messageEmails` is on by default, like `radarEmails` and `recapEmails`. A
-- direct message is somebody addressing this member by name, which is the one
-- thing in MaybeOS that should not wait for their next visit.
ALTER TABLE "thread_participants" ADD COLUMN "notifiedAt" TIMESTAMP(3);
ALTER TABLE "user_orgs" ADD COLUMN "messageEmails" BOOLEAN NOT NULL DEFAULT true;
