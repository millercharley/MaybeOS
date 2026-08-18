-- Which generation of Stripe's Accounts API a co-op's connected account is (PAY-04, PAY-05).
--
-- MaybeOS acquires a connected account two ways, and they are not the same kind
-- of object. Creating one uses Accounts v2 (`/v2/core/accounts`). Linking one a
-- co-op already has uses Connect OAuth, which hands back the account they
-- already had — always a **v1 Standard** account, because it predates MaybeOS.
--
-- Reading a v1 account through a v2 endpoint fails with "v1 Accounts cannot be
-- used in v2 Account APIs". That is what the first real co-op saw on
-- 2026-08-18, at the end of an otherwise successful connection: the account was
-- live and correct, but the status question was asked through the wrong API.
--
-- Nothing in an account id distinguishes the two, so it is recorded at the
-- moment we learn it rather than guessed at read time.

DO $$ BEGIN
  CREATE TYPE "StripeAccountApi" AS ENUM ('V1', 'V2');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "stripeAccountApi" "StripeAccountApi";

-- Backfill: every account connected before today arrived through OAuth, so every
-- one of them is v1. Verified against live Stripe on 2026-08-18 rather than
-- assumed — the platform's only connected account is acct_1MhgKwDaRqv0hdwb,
-- type "standard", and /v2/core/accounts is empty, so no account has ever been
-- created by the v2 path in production.
UPDATE "organizations"
  SET "stripeAccountApi" = 'V1'
  WHERE "stripeAccountId" IS NOT NULL AND "stripeAccountApi" IS NULL;
