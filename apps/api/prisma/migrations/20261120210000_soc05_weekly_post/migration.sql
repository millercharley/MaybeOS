-- SOC-05: the co-op posts once a week, instead of members posting their own.
--
-- Charley, 2026-11-20: "have the MaybeOS system allow an admin to connect to
-- their Instagram account and/or Facebook Page to generate a weekly post to
-- highlight public events happening at the co-op… Allow the Admin to set
-- their time preference of when the post will be sent… The default is the
-- image posts on Thursday mornings, listing events from Thursday through the
-- following Sunday (11 day horizon)."
--
-- The settings sit on the account rather than the organisation because they
-- are about posting, and posting needs the connection: a co-op with no Page
-- has nothing to schedule. `weeklyEnabled` is false by default — connecting
-- an account is permission to post, not an instruction to start, and a co-op
-- that connected one under SOC-01 to let hosts share must not discover MaybeOS
-- posting on its behalf because the feature changed underneath them.

ALTER TABLE "org_social_accounts" ADD COLUMN IF NOT EXISTS "weeklyEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "org_social_accounts" ADD COLUMN IF NOT EXISTS "weeklyDay" INTEGER NOT NULL DEFAULT 4;
ALTER TABLE "org_social_accounts" ADD COLUMN IF NOT EXISTS "weeklyHour" INTEGER NOT NULL DEFAULT 9;
ALTER TABLE "org_social_accounts" ADD COLUMN IF NOT EXISTS "weeklyDays" INTEGER NOT NULL DEFAULT 11;
ALTER TABLE "org_social_accounts" ADD COLUMN IF NOT EXISTS "weeklyCta" TEXT;
ALTER TABLE "org_social_accounts" ADD COLUMN IF NOT EXISTS "weeklyToPage" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "org_social_accounts" ADD COLUMN IF NOT EXISTS "weeklyToInstagram" BOOLEAN NOT NULL DEFAULT true;

-- One row per co-op per week, claimed before anything is published.
--
-- The scheduler runs every fifteen minutes, so four of its runs fall inside
-- whichever hour a co-op chose. The unique index below is the whole of what
-- stops four runs posting four times — the same thing the monthly recap
-- relies on, and the reason the row is written before the Graph API is
-- called rather than after it answers.
CREATE TABLE IF NOT EXISTS "social_weekly_posts" (
  "id"           TEXT NOT NULL,
  "orgId"        TEXT NOT NULL,
  "periodStart"  DATE NOT NULL,
  "periodEnd"    DATE NOT NULL,
  "status"       TEXT NOT NULL DEFAULT 'PENDING',
  "eventCount"   INTEGER NOT NULL DEFAULT 0,
  "imagePath"    TEXT,
  "facebookId"   TEXT,
  "facebookUrl"  TEXT,
  "instagramId"  TEXT,
  "instagramUrl" TEXT,
  "error"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "social_weekly_posts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "social_weekly_posts_orgId_periodStart_key"
  ON "social_weekly_posts" ("orgId", "periodStart");

DO $$
BEGIN
  ALTER TABLE "social_weekly_posts"
    ADD CONSTRAINT "social_weekly_posts_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
