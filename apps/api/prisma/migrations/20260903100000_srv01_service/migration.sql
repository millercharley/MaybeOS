-- SRV-01: naming the things that need doing, and counting who did them.
--
-- Three tables and two columns. A duty is a *definition* — occurrences are
-- computed from its recurrence rule the way room slots already are, so there
-- is no horizon to keep topped up and no year of stale rows to clean up when
-- an organiser moves the trash from Tuesdays to Wednesdays. Rows in
-- duty_claims exist only where somebody actually took a turn.

CREATE TYPE "ServicePeriod" AS ENUM ('WEEK', 'MONTH', 'YEAR');
CREATE TYPE "DutyClaimStatus" AS ENUM ('CLAIMED', 'CONFIRMED', 'DONE', 'MISSED', 'RELEASED');

CREATE TABLE IF NOT EXISTS "duties" (
  "id"               TEXT NOT NULL,
  "orgId"            TEXT NOT NULL,
  "title"            TEXT NOT NULL,
  "description"      TEXT,
  "estimatedMinutes" INTEGER NOT NULL DEFAULT 30,
  "capacity"         INTEGER NOT NULL DEFAULT 1,
  "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
  "recurrence"       "RecurrenceRule" NOT NULL DEFAULT 'NONE',
  "startsOn"         TIMESTAMP(3) NOT NULL,
  "endsOn"           TIMESTAMP(3),
  "startTime"        TEXT NOT NULL DEFAULT '09:00',
  "isActive"         BOOLEAN NOT NULL DEFAULT true,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "duties_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "duty_adoptions" (
  "id"         TEXT NOT NULL,
  "dutyId"     TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "startedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "duty_adoptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "duty_claims" (
  "id"            TEXT NOT NULL,
  "dutyId"        TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "occursAt"      TIMESTAMP(3) NOT NULL,
  "status"        "DutyClaimStatus" NOT NULL DEFAULT 'CONFIRMED',
  "minutes"       INTEGER,
  "minutesEdited" BOOLEAN NOT NULL DEFAULT false,
  "minutesNote"   TEXT,
  "completedAt"   TIMESTAMP(3),
  "releasedAt"    TIMESTAMP(3),
  "reviewedBy"    TEXT,
  "reviewedAt"    TIMESTAMP(3),
  "adoptionId"    TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "duty_claims_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "duties_orgId_isActive_idx" ON "duties"("orgId", "isActive");
CREATE INDEX IF NOT EXISTS "duty_adoptions_dutyId_releasedAt_idx" ON "duty_adoptions"("dutyId", "releasedAt");
CREATE INDEX IF NOT EXISTS "duty_adoptions_userId_idx" ON "duty_adoptions"("userId");
CREATE INDEX IF NOT EXISTS "duty_claims_dutyId_occursAt_idx" ON "duty_claims"("dutyId", "occursAt");
CREATE INDEX IF NOT EXISTS "duty_claims_userId_status_idx" ON "duty_claims"("userId", "status");

-- A member takes a given turn once. Two rows would count the hours twice.
CREATE UNIQUE INDEX IF NOT EXISTS "duty_claims_dutyId_userId_occursAt_key"
  ON "duty_claims"("dutyId", "userId", "occursAt");

ALTER TABLE "duties"
  ADD CONSTRAINT "duties_orgId_fkey" FOREIGN KEY ("orgId")
  REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "duty_adoptions"
  ADD CONSTRAINT "duty_adoptions_dutyId_fkey" FOREIGN KEY ("dutyId")
  REFERENCES "duties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "duty_adoptions"
  ADD CONSTRAINT "duty_adoptions_userId_fkey" FOREIGN KEY ("userId")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "duty_claims"
  ADD CONSTRAINT "duty_claims_dutyId_fkey" FOREIGN KEY ("dutyId")
  REFERENCES "duties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "duty_claims"
  ADD CONSTRAINT "duty_claims_userId_fkey" FOREIGN KEY ("userId")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- SetNull, not Cascade: releasing an adoption must not delete the turns
-- somebody already did under it, or the hours vanish with the arrangement.
ALTER TABLE "duty_claims"
  ADD CONSTRAINT "duty_claims_adoptionId_fkey" FOREIGN KEY ("adoptionId")
  REFERENCES "duty_adoptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- What a tier asks of a member. Both null means no expectation, which is the
-- default and stays true for every tier that exists today.
ALTER TABLE "membership_tiers" ADD COLUMN IF NOT EXISTS "serviceMinutes" INTEGER;
ALTER TABLE "membership_tiers" ADD COLUMN IF NOT EXISTS "servicePeriod" "ServicePeriod";

-- SEC-09: new tables arrive with row level security disabled. Every read goes
-- through the API's own tenant scoping, but a table left open is one
-- misconfigured key away from being readable by anyone.
ALTER TABLE "duties" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "duty_adoptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "duty_claims" ENABLE ROW LEVEL SECURITY;
