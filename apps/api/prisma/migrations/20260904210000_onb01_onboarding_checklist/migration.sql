-- ONB-01: a getting-started checklist a co-op writes and a member works through.
--
-- Additive throughout. `onboardingEnabled` is false for every existing co-op,
-- so nothing appears in anybody's sidebar until an admin turns it on and
-- writes the steps.

CREATE TYPE "OnboardingStepKind" AS ENUM (
  'PROFILE', 'HANDBOOK', 'COMMONS_POST', 'EVENT_RSVP', 'ROOM_BOOKING', 'SERVICE_CLAIM', 'CUSTOM'
);

ALTER TABLE "organizations" ADD COLUMN "onboardingEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Null for everyone: nobody has finished with a checklist that does not exist.
ALTER TABLE "user_orgs" ADD COLUMN "onboardingDismissedAt" TIMESTAMP(3);

CREATE TABLE "onboarding_steps" (
  "id"          TEXT NOT NULL,
  "orgId"       TEXT NOT NULL,
  "kind"        "OnboardingStepKind" NOT NULL DEFAULT 'CUSTOM',
  "title"       TEXT NOT NULL,
  "description" TEXT,
  "ctaLabel"    TEXT NOT NULL DEFAULT 'Do it now',
  "href"        TEXT,
  "position"    INTEGER NOT NULL DEFAULT 0,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "onboarding_steps_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "onboarding_steps_orgId_position_idx" ON "onboarding_steps"("orgId", "position");

CREATE TABLE "onboarding_completions" (
  "id"          TEXT NOT NULL,
  "stepId"      TEXT NOT NULL,
  "memberId"    TEXT NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "onboarding_completions_pkey" PRIMARY KEY ("id")
);
-- One row per member per step: ticking twice is the same fact, not two.
CREATE UNIQUE INDEX "onboarding_completions_stepId_memberId_key"
  ON "onboarding_completions"("stepId", "memberId");
CREATE INDEX "onboarding_completions_memberId_idx" ON "onboarding_completions"("memberId");

ALTER TABLE "onboarding_steps" ADD CONSTRAINT "onboarding_steps_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "onboarding_completions" ADD CONSTRAINT "onboarding_completions_stepId_fkey"
  FOREIGN KEY ("stepId") REFERENCES "onboarding_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "onboarding_completions" ADD CONSTRAINT "onboarding_completions_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "user_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SEC-09: new tables arrive with RLS disabled and must enable it explicitly.
ALTER TABLE "onboarding_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "onboarding_completions" ENABLE ROW LEVEL SECURITY;
