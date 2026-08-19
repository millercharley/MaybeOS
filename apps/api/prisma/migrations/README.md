# Migrations

## How this directory got here (OPS-04)

The schema was synced with `prisma db push` from the beginning, so no database
ever had a `_prisma_migrations` table. Three migration files were nonetheless
committed — `0001_init`, `0002_webhook_events`, `0003_add_invitations` — and
`prisma migrate status` reported all three as *unapplied*, on every
environment, because they never had been. Meanwhile the schema itself moved
far past them.

That combination is worse than having no migrations at all: it looks like a
migration history, so nobody checks, and nothing tells you when an environment
falls behind. It is how `organizations.allowPublicJoin` reached the code and
the dev database but never production, where it broke every read of an
organization row until it was found by comparing the two databases column by
column.

The three stale files are gone (they remain in git history). In their place is
a single `0_init` generated from the live schema, marked as already applied on
each existing database.

## The rule from here

**Schema changes go through `prisma migrate`, not `db push`.**

```bash
# in apps/api, against dev
npx prisma migrate dev --name what_changed
```

That writes a migration file, applies it, and records it. Commit the file with
the code that needs it.

Production is deployed by Netlify from the production branch and does not run
migrations itself, so a migration reaches production when somebody applies it:

```bash
npx prisma migrate deploy      # with DATABASE_URL pointing at production
```

Apply it **before** merging the code that depends on it. A column that does not
exist yet is a 500 on every request that selects it, and Prisma selects every
column unless a query says otherwise.

### A new table needs its own `ENABLE ROW LEVEL SECURITY`

SEC-09 turned RLS on for every table in `public`, with no policies, so that
`anon` and `authenticated` are denied twice over — once by SEC-08's revoked
privileges and once by RLS. The API is unaffected: it connects as `postgres`,
which owns these tables and carries `rolbypassrls`.

**A table created later does not inherit any of that.** It arrives with RLS
disabled, which is how `tickets` and `expenses` were created. Add this to the
same migration that creates it:

```sql
ALTER TABLE "your_new_table" ENABLE ROW LEVEL SECURITY;
```

Supabase's linter reporting `rls_enabled_no_policy` (INFO) for every table is
the expected state, not a list of things to fix — that lint assumes you want
PostgREST access, and MaybeOS never uses the Data API.

## Both databases are baselined (OPS-23, 2026-08-19)

They were not, and the gap was not what it looked like. `prisma migrate status`
reported **nine** migrations pending on dev; only **four** were real. The other
five were already in dev's schema — RLS was on all 32 tables, `expenses`
existed, every column was there — and showed as pending because
`_prisma_migrations` was stale. Both databases had been maintained with
`db push`, so the migration history was bookkeeping fiction rather than a
record of anything.

Production was worse: it had **no `_prisma_migrations` table at all**, so
`prisma migrate deploy` would have tried to replay `0_init` onto a database
already carrying every table. That is the failure this file existed to warn
about, sitting in the live environment.

Both are now correct, and were fixed differently on purpose:

- **Dev** — the five already in its schema were recorded with
  `migrate resolve --applied`; the four genuinely missing were run with
  `migrate deploy`. Running all nine risked a non-idempotent migration failing
  and marking itself failed, which blocks every later deploy.
- **Production** — its `_prisma_migrations` table was created and all thirteen
  recorded, using the checksums Prisma itself had written in dev for the same
  files. Copied rather than computed: a checksum guessed at the wrong algorithm
  fails later with "migration file has been modified", by which time the
  original files are long gone from anyone's memory.

Verified by fingerprint rather than by trust — every table, column and data
type in both databases, hashed, and identical:
`e67467deb2b23c27d58250cb6afcc958`, 352 columns each.

**From here, use `prisma migrate`.** Both databases now record what has been
applied, so drift is visible again — which it was not for the eleven days this
went unnoticed.

## Baselining another environment

If a database already has the schema but no `_prisma_migrations` table, mark
the baseline applied rather than running it:

```bash
npx prisma migrate resolve --applied 0_init
```

Then confirm:

```bash
npx prisma migrate status      # "Database schema is up to date!"
```

## Checking for drift

The check that found the production outage, and the one worth running before
any release:

```bash
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script
```

Against a database that matches the schema this prints `-- This is an empty
migration.` Anything else is drift, and the output is the SQL that would fix
it. Run it against production too, not only dev — the whole failure above was
that the two had diverged and nothing was comparing them.
