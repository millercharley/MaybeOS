-- EVT-22: where an event's picture came from.
--
-- Two nullable columns, no default, no backfill: every event that exists has
-- either no image or one somebody typed a URL for, and neither has anybody to
-- credit. They fill only when a photo is chosen from Unsplash, whose API
-- terms require the photographer's name and a link back to their profile.
--
-- Purely additive, so it is safe to apply before the code that writes it.
--
-- Idempotent: production takes this through the Supabase connector before the
-- code ships, and dev through `prisma migrate deploy`.

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "imageCredit" TEXT;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "imageCreditUrl" TEXT;
