-- CMN-20: the weekly Commons digest — what a member missed while away.
--
-- The co-op switch is off by default, like every other one that decides
-- whether email leaves the building (`radarEnabled`, `recapEnabled`,
-- `welcomeEmailEnabled`). Nothing starts sending because this ran.
--
-- The member switch is on, because the digest only ever reaches somebody who
-- was away: a member who reads the Commons never receives one.
ALTER TABLE "organizations" ADD COLUMN "commonsDigestEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organizations" ADD COLUMN "commonsDigestDay" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "organizations" ADD COLUMN "commonsDigestHour" INTEGER NOT NULL DEFAULT 9;
ALTER TABLE "user_orgs" ADD COLUMN "commonsDigestEmails" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "user_orgs" ADD COLUMN "commonsDigestSentAt" TIMESTAMP(3);
