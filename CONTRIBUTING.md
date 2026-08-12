# Contributing to MaybeOS

MaybeOS is software for co-ops and member-run spaces. It handles membership,
dues, bookings, governance votes and — since ImpactOS — demographic data about
real people. A bug here is somebody's rent payment or somebody's address, so
the conventions below are less about style than about the specific ways this
codebase has gone wrong before.

## Getting set up

```bash
npm install
cp .env.example apps/api/.env    # then fill in DATABASE_URL
npm run db:generate
npm run dev                       # API on :3001, web on :3000
```

You need a PostgreSQL database. `docker compose up -d` starts one locally, or
point `DATABASE_URL` at a hosted one.

```bash
npm run lint      # eslint, both workspaces
npm test          # jest, both workspaces
npm run build     # must pass before a PR
```

## The conventions that exist for a reason

**Every query on a tenant-owned record filters on the org.** The membership
guard proves the caller belongs to the org *named in the URL* — and the caller
writes the URL. Looking up a booking, survey or proposal by bare id under
`/orgs/:orgId/...` lets somebody pair their own org id with another co-op's
record. A test in `apps/api/src/common/__tests__/tenant-scoping.spec.ts` fails
the suite when a tenant-owned model is fetched by bare id; if you have a real
reason to, mark it with a `tenant-scoping-exempt: <reason>` comment.

A record from another org raises **NotFound, not Forbidden**. Forbidden
confirms the id exists.

**Schema changes go through `prisma migrate`, never `db push`.** Apply the
migration to production *before* merging the code that needs it. Prisma
selects every column unless a query says otherwise, so a column that does not
exist yet is a 500 on every request that touches that table — this has
happened, and it took the public pages down. See
`apps/api/prisma/migrations/README.md`.

**Redact at the source, not at the caller.** Secrets and personal data are
omitted in the Prisma client or the service's `select`, so the default is
safe and an exception has to be written down. `Room.googleTokens` is omitted
globally; contact details are shaped in `common/access/contact-visibility.ts`.
If you add a column holding a credential or personal data, decide who sees it
in the same commit.

**A type in `apps/web/lib/api.ts` is a claim about a response, not evidence of
one.** Several have described endpoints that never existed, and because a
missing field reads as `undefined` rather than throwing, the UI renders a
blank or a zero and looks merely empty. `node tools/type-sweep.js` diffs every
declared interface against a live response, in both directions. Run it after
changing a response shape.

**Never swallow an error.** `catch {}` in the member portal meant somebody
posted, it failed, and the page said nothing — the post simply vanished. If a
failure has no useful message, that is a reason to write one, not to hide it.

## Writing tests

Tests should say what breaks and why, not restate the implementation. The ones
worth copying are the ones that name the defect they prevent — see
`safe-path.spec.ts` or `check-in.spec.ts`. A test that passes against a mock
shaped like the code proves very little; where the behaviour depends on the
database or a real payload, exercise it against a running API instead.

## Pull requests

- Branch from the production branch, and keep one concern per PR.
- `npm run lint`, `npm test` and `npm run build` all pass.
- The commit message explains what was wrong and how you know it is fixed.
  "Fixed bug" tells the next person nothing; the reasoning is the part that
  does not survive in the diff.
- Say what you verified and how. "Verified in the browser" and "the types
  compile" are different claims.

## Reporting something sensitive

Do not open a public issue for a security or privacy problem. See
[SECURITY.md](SECURITY.md).
