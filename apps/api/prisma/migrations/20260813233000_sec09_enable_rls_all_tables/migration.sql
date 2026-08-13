-- SEC-09: row-level security on every table in `public`.
--
-- Enabled with NO policies, which denies every role that does not bypass RLS.
-- That is the intent rather than an oversight: MaybeOS does not use Supabase's
-- Data API at all — there is no `@supabase/supabase-js` anywhere in the repo
-- and no `/rest/v1/` call — so nothing legitimate reaches these tables through
-- PostgREST, and a policy would only widen what can.
--
-- Safe for the application because the API connects as `postgres`, which both
-- owns these tables and carries `rolbypassrls`; `service_role` bypasses too.
-- Verified on dev before production: all 21 write paths passed with RLS on,
-- and then again against production afterwards.
--
-- This is a second lock, not a fix. SEC-08 already revoked schema and object
-- privileges from `anon` and `authenticated`, and Supabase's security advisors
-- reported nothing beforehand. The point is that one layer was doing all the
-- work: if a future migration, a dashboard click, or a restored backup ever
-- re-grants privileges to `anon`, RLS still denies.
--
-- Expect Supabase's linter to report `rls_enabled_no_policy` (INFO) for every
-- table afterwards. That notice describes this state accurately and is not a
-- problem to fix — it assumes you want PostgREST access, and MaybeOS does not.
--
-- **New tables do not inherit this.** A CREATE TABLE in a later migration
-- arrives with RLS disabled, exactly as `tickets` and `expenses` did. Enable it
-- in the same migration that creates the table.

DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
  END LOOP;
END $$;
