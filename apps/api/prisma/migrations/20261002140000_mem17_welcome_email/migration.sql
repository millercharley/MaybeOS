-- MEM-17: MaybeOS welcomes a new member itself.
--
-- `sendWelcome` has existed in the email service since the beginning and has
-- never had a caller — MaybeOS has never sent a welcome email. MaybeItsFate's
-- welcome came from a Zapier automation wired to Stripe, which surfaced on
-- 2026-10-02 by welcoming Charley to the *old* system during a test purchase
-- in the new one.
--
-- Off for every co-op, including the one that asked for it. A co-op moving in
-- usually already has something sending this, and two welcomes is worse than
-- none: this switch goes on when the old automation goes off.
--
-- Idempotent: production takes this through the Supabase connector before the
-- code ships, and dev through `prisma migrate deploy`.

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "welcomeEmailEnabled" BOOLEAN NOT NULL DEFAULT false;
