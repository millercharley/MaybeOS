# Deploying MaybeOS

Production is **Netlify**, one site serving both halves of the app (D-005, D-010).

This file used to be a Railway walkthrough with a correction notice bolted to the
top. Railway has not been the deployment target since D-010, and a document that
describes the wrong host — however clearly it is annotated — is a document that
eventually gets followed. It has been replaced with what actually happens.

## The shape of it

One Netlify site, `maybeos.org`:

- **Web** — the Next.js app in `apps/web`, built by Netlify's Next runtime.
- **API** — the NestJS app in `apps/api`, wrapped by `serverless-http` in
  `apps/api/src/lambda.ts` and served as the Netlify Function at
  `netlify/functions/api.js`. It answers on `/api/*` — **same origin as the web
  app**, which is the whole reason it lives here rather than on a second host:
  no CORS between the two, and one deploy rather than two that can disagree.
- **Scheduled work** — `netlify/functions/scheduled-tasks.js`, every 15 minutes
  (D-022). Not reachable over HTTP: Netlify answers 403 to external callers, and
  the handler refuses any invocation without a `next_run` payload.
- **Database** — Supabase Postgres. Two projects, `MaybeOS Dev` and
  `MaybeOS Prod`; they are not the same and it matters (see below).

`netlify.toml` registers the build plugin that compiles the API before functions
are bundled, and lists the packages esbuild must not inline.

## How a deploy happens

**Netlify builds `claude/maybeOS-suite-foundation-1Wauk`.** That is origin's
default branch. There is **no `main`**, and there is no staging step:

> Merging into that branch *is* the production deploy of maybeos.org.

So: build and test the *merged* result before pushing, not after.

```bash
git checkout claude/maybeOS-suite-foundation-1Wauk
git merge --no-ff your-branch
npm run lint && npm test && npm run build     # on the merged tree
git push origin claude/maybeOS-suite-foundation-1Wauk
```

`--no-ff` keeps a release revertable as a single commit.

## Database changes come first

Prisma selects every column unless a query says otherwise, so a column that
exists in the code and not in the database is a 500 on every request that
touches that table. This has happened: `organizations.allowPublicJoin` shipped
without its production migration and took MaybeItsFate's public pages down,
returning HTTP 200 the whole time because the pages are client-rendered shells.

**Apply the migration to production, then merge the code.** Never the other way
round. Full procedure in
[apps/api/prisma/migrations/README.md](apps/api/prisma/migrations/README.md),
including the drift check to run against both databases before a release.

## After a deploy

```bash
node tools/prod-smoke.js
```

26 read-only checks across every module: public endpoints answer 200, guarded
ones answer 401 rather than 500, malformed queries answer 400. It exits
non-zero on anything unexpected. This is what caught the outage above.

`tools/prod-write-probe.js` is its counterpart and is **not** routine — it
writes. It registers a throwaway account, creates a disposable org, and
exercises the write paths inside it: rooms, bookings, events, RSVPs, channels,
posts, comments and org settings. Run it before a launch or after a change to
a write path, then tear the org down; the run prints the org id to remove.
It deliberately never touches Stripe, because creating a tier provisions a
real live-mode Product and Price.

## Environment variables

Set in the Netlify dashboard (Site configuration → Environment variables), not
in the repo. The ones production needs:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Supabase **prod** session-mode pooler |
| `JWT_SECRET` | |
| `WEB_URL` | `https://maybeos.org` — also drives the CORS allow-list |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | org logo storage (D-017) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | live mode in production |
| `POSTMARK_API_TOKEN` | email delivery — **see below, this one fails silently** |
| `EMAIL_FROM` | must be a Postmark-verified sender; defaults to `noreply@maybeos.org` |
| `SENTRY_DSN` | error tracking |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional; calendar sync refuses with 503 when unset |

Dev and prod Supabase credentials are **not interchangeable**, and the two
dashboards look identical. Check the project name before pasting anything.

## Email is the one that fails without telling you

Every transactional email — invitations, the five booking emails, magic links,
dues dunning — goes through one `EmailService`. It has two deliberate
behaviours that combine badly:

- with `POSTMARK_API_TOKEN` unset it **logs the message and returns
  successfully**, so nothing errors;
- send failures are **caught and logged, never thrown**, so a Postmark outage
  cannot fail a member's registration.

Both are right on their own. Together they mean a deployment that cannot send
a single email looks exactly like one that can. That is how OPS-19 went
unnoticed until 2026-08-13: every email in the product's production history
had been a log line.

Two things are needed, and a token alone is not enough:

1. **A Postmark server token** → `POSTMARK_API_TOKEN`.
2. **A verified sender.** Postmark refuses any From address that is not a
   verified Sender Signature or on a verified domain, and *that refusal is
   logged rather than raised* — indistinguishable from having no token at all.
   Set `EMAIL_FROM` to an address you have verified.

Check the first from outside:

```bash
curl -s https://maybeos.org/api/health | python3 -m json.tool
```

`email.configured: true` and `transport: "postmark"` prove the token landed.
That is necessary and **not sufficient** — only an email actually arriving
proves the sender is verified. Request a magic link and watch for it; if it
does not arrive while `configured` is true, the reason is in Postmark's
Activity log.

## What is not the deployment target

**Railway.** It was the original target and was replaced by D-010. If a Railway
project is still connected to `millercharley/MaybeOS` it will keep building on
every push and keep failing, because nothing in this repo is arranged for it —
no `railway.json`, no `Procfile`, no `nixpacks.toml`. Those build failures are
noise from a disconnected past, not a signal about this deploy. Delete the
Railway project or disconnect its GitHub integration; nothing in this repository
can stop it.

**Docker Compose** (`docker-compose.yml`, `docker-compose.prod.yml`) is for
running Postgres locally. It is not how production runs.
