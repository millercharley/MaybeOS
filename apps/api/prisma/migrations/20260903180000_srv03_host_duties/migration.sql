-- SRV-03: what a host has to do before, during and after their booking.
--
-- Not the SRV-01 `duties` table. Nobody claims these and nobody volunteers for
-- them: they come with the room, they are always the host's, and they recur
-- because bookings do rather than because a rule says so.
--
-- `host_briefings` starts empty on every co-op and stays empty until an admin
-- writes a message. A co-op does not begin emailing its members because
-- MaybeOS shipped a feature; the absence of a row is how this stays off.

CREATE TYPE "HostDutyPhase" AS ENUM ('BEFORE', 'DURING', 'AFTER');
CREATE TYPE "BriefingAnchor" AS ENUM (
  'CLOCK_ON_DAY', 'BEFORE_START', 'AFTER_START', 'BEFORE_END', 'AFTER_END'
);

CREATE TABLE IF NOT EXISTS "host_duties" (
  "id"        TEXT NOT NULL,
  "orgId"     TEXT NOT NULL,
  "roomId"    TEXT,
  "phase"     "HostDutyPhase" NOT NULL,
  "text"      TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "host_duties_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "host_briefings" (
  "id"            TEXT NOT NULL,
  "orgId"         TEXT NOT NULL,
  "phase"         "HostDutyPhase" NOT NULL,
  "subject"       TEXT NOT NULL,
  "body"          TEXT NOT NULL,
  "anchor"        "BriefingAnchor" NOT NULL DEFAULT 'CLOCK_ON_DAY',
  "clockTime"     TEXT NOT NULL DEFAULT '07:00',
  "offsetMinutes" INTEGER NOT NULL DEFAULT 60,
  "isActive"      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "host_briefings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "host_briefing_notices" (
  "id"        TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "phase"     "HostDutyPhase" NOT NULL,
  "sentAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "host_briefing_notices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "host_duties_orgId_phase_isActive_idx"
  ON "host_duties"("orgId", "phase", "isActive");

-- One message per phase per co-op.
CREATE UNIQUE INDEX IF NOT EXISTS "host_briefings_orgId_phase_key"
  ON "host_briefings"("orgId", "phase");

-- The whole of the idempotency. The scheduler has no jobs table (D-022), so
-- this row is what stands between a retried invocation and a member getting
-- the same email four times.
CREATE UNIQUE INDEX IF NOT EXISTS "host_briefing_notices_bookingId_phase_key"
  ON "host_briefing_notices"("bookingId", "phase");

ALTER TABLE "host_duties"
  ADD CONSTRAINT "host_duties_orgId_fkey" FOREIGN KEY ("orgId")
  REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "host_duties"
  ADD CONSTRAINT "host_duties_roomId_fkey" FOREIGN KEY ("roomId")
  REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "host_briefings"
  ADD CONSTRAINT "host_briefings_orgId_fkey" FOREIGN KEY ("orgId")
  REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "host_briefing_notices"
  ADD CONSTRAINT "host_briefing_notices_bookingId_fkey" FOREIGN KEY ("bookingId")
  REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SEC-09: new tables arrive with row level security disabled.
ALTER TABLE "host_duties" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "host_briefings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "host_briefing_notices" ENABLE ROW LEVEL SECURITY;
