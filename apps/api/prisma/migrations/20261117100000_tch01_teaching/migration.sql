-- TCH-01: members broadcast what they teach.
--
-- Charley, 2026-11-17: a member should be able to say they are running a
-- workshop, or that they will take private students. Until now the only route
-- was asking an organiser to create an event, or doing it off-platform where
-- the co-op never learned it had been offered.
--
-- **An offering is the broadcast; a workshop's dates are events.** `events`
-- gains `offeringId` rather than `offerings` growing its own schedule,
-- capacity, tickets, RSVPs and payouts. Everything a session needs is already
-- on `events` and already tested, including the whole ticket-checkout gate
-- chain. So "a scheduled workshop shows on the calendar" required no code: the
-- sessions are events.
--
-- `ON DELETE SET NULL` on that column, never CASCADE. Deleting an offering
-- must not delete an evening somebody holds a ticket to; the session survives
-- as a plain event, which is what it already was to everyone who booked it.
--
-- `offerings.visibility` defaults to MEMBERS_ONLY where `events.visibility`
-- defaults to PUBLIC. That difference is deliberate and is the one thing in
-- here worth remembering: an event is a co-op publishing its own calendar, and
-- an offering is a member writing up what they teach. Reaching the open web
-- should be something they chose.
CREATE TYPE "OfferingKind" AS ENUM ('WORKSHOP', 'PRIVATE_LESSON');
CREATE TYPE "OfferingPayment" AS ENUM ('THROUGH_MAYBEOS', 'ARRANGE_DIRECTLY');

CREATE TABLE "offerings" (
    "id"              TEXT NOT NULL,
    "orgId"           TEXT NOT NULL,
    "teacherId"       TEXT NOT NULL,
    "createdById"     TEXT,
    "kind"            "OfferingKind" NOT NULL,
    "title"           TEXT NOT NULL,
    "slug"            TEXT NOT NULL,
    "summary"         TEXT,
    "description"     TEXT,
    "richDescription" TEXT,
    "imageUrl"        TEXT,
    "imageCredit"     TEXT,
    "imageCreditUrl"  TEXT,
    "imageFocusY"     INTEGER NOT NULL DEFAULT 50,
    "visibility"      "EventVisibility" NOT NULL DEFAULT 'MEMBERS_ONLY',
    "isPublished"     BOOLEAN NOT NULL DEFAULT false,
    "publishedAt"     TIMESTAMP(3),
    "closedAt"        TIMESTAMP(3),
    "payment"         "OfferingPayment" NOT NULL DEFAULT 'ARRANGE_DIRECTLY',
    "priceCents"      INTEGER,
    "priceNote"       TEXT,
    "currency"        TEXT NOT NULL DEFAULT 'usd',
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offerings_pkey" PRIMARY KEY ("id")
);

-- Asking twice is asking once: a member pressing it again is updating their
-- note, not joining the queue a second time.
CREATE TABLE "offering_interests" (
    "id"         TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "note"       TEXT,
    "handledAt"  TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offering_interests_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "events" ADD COLUMN "offeringId" TEXT;

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "teachingEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "offerings_orgId_slug_key" ON "offerings"("orgId", "slug");
CREATE INDEX "offerings_orgId_visibility_isPublished_idx" ON "offerings"("orgId", "visibility", "isPublished");
CREATE INDEX "offerings_orgId_teacherId_idx" ON "offerings"("orgId", "teacherId");
CREATE UNIQUE INDEX "offering_interests_offeringId_userId_key" ON "offering_interests"("offeringId", "userId");
CREATE INDEX "offering_interests_offeringId_createdAt_idx" ON "offering_interests"("offeringId", "createdAt");

ALTER TABLE "offerings" ADD CONSTRAINT "offerings_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "offerings" ADD CONSTRAINT "offerings_teacherId_fkey"
  FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "offerings" ADD CONSTRAINT "offerings_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "offering_interests" ADD CONSTRAINT "offering_interests_offeringId_fkey"
  FOREIGN KEY ("offeringId") REFERENCES "offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "offering_interests" ADD CONSTRAINT "offering_interests_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "events" ADD CONSTRAINT "events_offeringId_fkey"
  FOREIGN KEY ("offeringId") REFERENCES "offerings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
