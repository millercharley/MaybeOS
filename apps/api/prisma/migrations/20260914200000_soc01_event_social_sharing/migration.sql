-- SOC-01: hosts share public events to the co-op's Facebook Page and Instagram.
--
-- `org_social_accounts` holds the connected Page and its Instagram account.
-- The Page token is sealed with secret-box before it is written.
-- `event_social_posts` records each event shared to each platform; its unique
-- index is what stops the same event being posted twice.
--
-- Off for every co-op until an admin connects an account and turns sharing on.
-- Row-level security on both new tables and no grants to anon or authenticated,
-- matching every other application table.
--
-- Idempotent: production takes this through the Supabase connector before the
-- code ships, and dev through `prisma migrate deploy`.

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "socialSharingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "socialShareMembersByDefault" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "user_orgs" ADD COLUMN IF NOT EXISTS "socialShareAllowed" BOOLEAN;
ALTER TABLE "user_orgs" ADD COLUMN IF NOT EXISTS "instagramHandle" TEXT;

DO $$ BEGIN
  CREATE TYPE "SocialPlatform" AS ENUM ('FACEBOOK', 'INSTAGRAM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "org_social_accounts" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "pageId" TEXT,
  "pageName" TEXT,
  "pageToken" JSONB,
  "igUserId" TEXT,
  "igUsername" TEXT,
  "pendingPages" JSONB,
  "pendingUntil" TIMESTAMP(3),
  "connectedById" TEXT,
  "connectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "org_social_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "org_social_accounts_orgId_key" ON "org_social_accounts"("orgId");

DO $$ BEGIN
  ALTER TABLE "org_social_accounts"
    ADD CONSTRAINT "org_social_accounts_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "event_social_posts" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "platform" "SocialPlatform" NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "externalId" TEXT,
  "permalink" TEXT,
  "postedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "event_social_posts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "event_social_posts_eventId_platform_key" ON "event_social_posts"("eventId", "platform");
CREATE INDEX IF NOT EXISTS "event_social_posts_orgId_createdAt_idx" ON "event_social_posts"("orgId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "event_social_posts"
    ADD CONSTRAINT "event_social_posts_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "event_social_posts"
    ADD CONSTRAINT "event_social_posts_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "org_social_accounts" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "org_social_accounts" FROM anon, authenticated;
ALTER TABLE "event_social_posts" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "event_social_posts" FROM anon, authenticated;
