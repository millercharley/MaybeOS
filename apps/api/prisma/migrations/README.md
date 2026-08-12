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
