-- RDR-01: Radar — matching a member's interests to gatherings open to members.
--
-- `interest_tags` is the co-op's own list of interests, seeded from a MaybeOS
-- starter set the first time Radar is switched on. `member_interests` holds
-- what each member said (declared) and what their RSVPs suggest (rsvpCount),
-- kept apart so a declared "no" can always beat a guess. `radar_sends` records
-- which event has already been mentioned to which member, which is what stops
-- a scheduler running every fifteen minutes from mentioning it again.
--
-- Switches: `organizations.radarEnabled` is off for every co-op, and the
-- interface only offers it on Plus and Unlimited. `user_orgs.radarEmails`
-- defaults to true — an admin turning Radar on is the co-op deciding — and
-- every digest carries a one-click unsubscribe that writes false.
--
-- Row-level security on all three new tables and no grants to anon or
-- authenticated, matching every other application table (SEC-09).
--
-- Idempotent: production takes this through the Supabase connector before the
-- code ships, and dev through `prisma migrate deploy`.

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "radarEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "radarDigestDay" INTEGER NOT NULL DEFAULT 4;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "radarDigestHour" INTEGER NOT NULL DEFAULT 9;

ALTER TABLE "user_orgs" ADD COLUMN IF NOT EXISTS "radarEmails" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "user_orgs" ADD COLUMN IF NOT EXISTS "radarLastSentAt" TIMESTAMP(3);
ALTER TABLE "user_orgs" ADD COLUMN IF NOT EXISTS "interestsAskedAt" TIMESTAMP(3);
ALTER TABLE "user_orgs" ADD COLUMN IF NOT EXISTS "interestsDismissals" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "interest_tags" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "emoji" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "interest_tags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "interest_tags_orgId_name_key" ON "interest_tags"("orgId", "name");
CREATE INDEX IF NOT EXISTS "interest_tags_orgId_isActive_sortOrder_idx" ON "interest_tags"("orgId", "isActive", "sortOrder");

DO $$ BEGIN
  ALTER TABLE "interest_tags"
    ADD CONSTRAINT "interest_tags_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "member_interests" (
  "id" TEXT NOT NULL,
  "userOrgId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  "declared" BOOLEAN,
  "rsvpCount" INTEGER NOT NULL DEFAULT 0,
  "lastRsvpAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "member_interests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "member_interests_userOrgId_tagId_key" ON "member_interests"("userOrgId", "tagId");
CREATE INDEX IF NOT EXISTS "member_interests_userOrgId_idx" ON "member_interests"("userOrgId");

DO $$ BEGIN
  ALTER TABLE "member_interests"
    ADD CONSTRAINT "member_interests_userOrgId_fkey"
    FOREIGN KEY ("userOrgId") REFERENCES "user_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "member_interests"
    ADD CONSTRAINT "member_interests_tagId_fkey"
    FOREIGN KEY ("tagId") REFERENCES "interest_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "radar_sends" (
  "id" TEXT NOT NULL,
  "userOrgId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "radar_sends_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "radar_sends_userOrgId_eventId_key" ON "radar_sends"("userOrgId", "eventId");
CREATE INDEX IF NOT EXISTS "radar_sends_userOrgId_sentAt_idx" ON "radar_sends"("userOrgId", "sentAt");

DO $$ BEGIN
  ALTER TABLE "radar_sends"
    ADD CONSTRAINT "radar_sends_userOrgId_fkey"
    FOREIGN KEY ("userOrgId") REFERENCES "user_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "radar_sends"
    ADD CONSTRAINT "radar_sends_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "interest_tags" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "interest_tags" FROM anon, authenticated;
ALTER TABLE "member_interests" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "member_interests" FROM anon, authenticated;
ALTER TABLE "radar_sends" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "radar_sends" FROM anon, authenticated;
