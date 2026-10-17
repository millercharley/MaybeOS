-- CMN-21: an organiser can email a Commons post to the whole roster.
--
-- `post_email_sends` is the cursor. A send to four hundred members cannot
-- finish inside one function invocation, so the members still owed a copy are
-- the ones with no row here — the same shape `radar_sends` uses, and a mark
-- that survives the process being killed halfway through.
--
-- `emailRequestedAt` is null for the overwhelming majority of posts, which
-- are a conversation rather than an announcement.
--
-- `announcementEmails` is on by default and has its own switch: a member who
-- does not want a weekly summary may well want to be told the potluck moved.
ALTER TABLE "posts" ADD COLUMN "emailRequestedAt" TIMESTAMP(3);
ALTER TABLE "user_orgs" ADD COLUMN "announcementEmails" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "post_email_sends" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userOrgId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_email_sends_pkey" PRIMARY KEY ("id")
);

-- One copy per member per announcement, enforced rather than intended: two
-- overlapping runs must not both decide somebody is owed one.
CREATE UNIQUE INDEX "post_email_sends_postId_userOrgId_key"
    ON "post_email_sends"("postId", "userOrgId");
CREATE INDEX "post_email_sends_postId_idx" ON "post_email_sends"("postId");

ALTER TABLE "post_email_sends" ADD CONSTRAINT "post_email_sends_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "post_email_sends" ADD CONSTRAINT "post_email_sends_userOrgId_fkey"
    FOREIGN KEY ("userOrgId") REFERENCES "user_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
