# STATE.md — Current State

**Rules for the AI:**
- This is the **first file you read at session boot.**
- It reflects *right now*: what exists, what's in progress, what's blocked. Keep it current at session shutdown.
- Keep it short. Historical narrative belongs in session summaries; durable facts belong in ARCHITECTURE.md / DECISIONS.md.

---

## Active Workstream
Get MaybeOS Suite production-ready and launch MaybeItsFate LCA as the first live tenant this month, onboarding-ready for other co-ops to follow (D-003).

**DEP-01 complete (2026-08-09):** the API is live in production. maybeos.org now serves the Next.js frontend and the NestJS API (as a Netlify Function) from one origin, backed by a dedicated production Supabase project. Verified in-browser end to end — the login form returns a real API response instead of "Failed to fetch". See D-010 for the topology and the five required environment variables.

## Built (exists & working)
- [x] Auth (JWT + magic link + RBAC) — verified end-to-end 2026-08-08
- [x] OrgOS, MemberOS, EventsOS, SpaceOS, CommonsOS, ImpactOS, Stripe, Email, Calendar, Health modules — real business logic, compiles and runs against Supabase
- [x] Tenant isolation (D-009) — `OrgMembershipGuard` enforces org membership on every tenant-scoped endpoint; verified live and pushed
- [x] Member invitations (invite/resend, pending-invites UI on admin members page) — pre-existing in the canonical repo (D-008)
- [x] Public multi-tenant member portal (`apps/web/app/portal/[orgSlug]/*`: commons, directory, events, impact, rooms) — verified live in browser 2026-08-08, all five sections render real data. Note: its Commons page is a separate, simpler implementation from the admin hub — no Collections/threading/pinning there yet
- [x] Org onboarding component (`components/setup/org-setup.tsx`) — verified live in browser: fresh user → create org → lands as ADMIN of a real new org
- [x] Test suite: 36/36 unit tests pass (auth, roles guard, Stripe, exception filter). E2E: 11/12 pass after fixing a broken supertest import; the 1 failure is the global rate limiter (3 req/sec) tripping on back-to-back test requests, not an app bug
- [x] CommonsOS parity (D-004 onward): Collections/wiki (CRUD + pages), threaded comment replies, channel pinning, Direct Messages (list/send/read receipts), ⌘K search across members/channels/events/pages — built, merged into canonical repo, verified end-to-end in browser
- [x] Web admin dashboard (login → dashboard → members list) — verified live against seeded data
- [x] Legacy static demo (`maybeos-handoff`) — fully clickable single-tenant prototype; UX/feature reference only, not shipped (D-002)
- [x] Redis/BullMQ removed; email sends synchronously via Postmark (D-007) — verified both entry points boot with zero ECONNREFUSED noise
- [x] Destructive-seed guard — `db:seed` refuses to run against production or any non-local database unless `SEED_FORCE=true`. Added because the script deletes every row first, and dev/prod Supabase URLs differ by a few characters
- [x] **DEP-01 — API live in production** (D-010). NestJS runs as a Netlify Function behind an edge redirect; frontend and API share the maybeos.org origin. Verified: health check, 401 on bad credentials, JwtAuthGuard, ValidationPipe, Swagger correctly disabled, and a full register -> JWT -> authenticated-profile round trip (test account deleted afterward; prod DB confirmed empty)
- [x] Dedicated production Supabase project (`iugbkabdbgkofyaychjy`, ca-central-1), schema pushed, zero rows. Dev project stays separate (D-010)
- [x] **OPS-06 — API error tracking** (Sentry, `@sentry/nestjs` 8.55.2). Init isolated in `instrument.ts` and imported first; explicit `Sentry.flush()` before the Lambda freezes; the exception filter reports all 5xx (not just non-HttpException). Verified against a local fake ingest. **Live in production 2026-08-10** — `SENTRY_DSN` set on Netlify (project `4511886801960960`). Caveat: no real production 500 has been observed reaching Sentry yet, because the API correctly returns 4xx for every malformed request probed. The first genuine 500 is the real confirmation.
- [x] **OPS-07 — Frontend error tracking** (D-011, `@sentry/nextjs` 8.55.2). Browser + SSR + edge/middleware. Includes the app's **first React error boundaries** (`app/error.tsx`, `app/global-error.tsx`) — before this, a render error showed Next's blank default screen and reported nothing. API client emits a breadcrumb per request and captures 5xx and unreachable-API failures; `auth-store` attaches user id and org tag. Credential-bearing URLs (`?token=`) are redacted before send. Verified end-to-end against a local fake ingest: uncaught error, unhandled rejection, render error, API-down, and token redaction all confirmed. **Live in production 2026-08-10** — `NEXT_PUBLIC_SENTRY_DSN` set (project `4511886807597056`) and confirmed inlined into the deployed bundle. On maybeos.org itself: client initialized with the right DSN, `environment=production`, `tracesSampleRate=0.1`; a test exception was accepted by Sentry (HTTP 200) and `flush()` drained; and on `/magic-link?token=…` the outgoing envelope contained `token=%5Bredacted%5D` with zero occurrences of the secret.
- [x] **Sentry source maps** (D-012) — uploading from the Netlify build since 2026-08-10. Verified on production: 12 of 13 deployed chunks carry debug IDs (the exception is `polyfills-*`, on Sentry's own ignore list); every `.js.map` returns 404 so no unminified source is served; no auth token appears in any chunk. A real `ApiNetworkError` raised from the live login form reported frames in `chunks/107-*.js` and `chunks/509-*.js`, confirming `widenClientFileUpload` is doing the work D-012 describes.
- [x] **MEM-02 — public join wired to payment** (D-020, commit `b933c2c`). `/join?org=&tier=` signs the visitor in, creates the membership and hands off to Stripe checkout. Before this the "Join as X" button was a bare link to `/register` that discarded the co-op and the tier, so a prospective member was invited to found their own co-op and never reached payment. Note this is gated by `allowPublicJoin`, which no UI can turn on yet — see MEM-03 under Blocked on Charley
- [x] Project operating system (this folder) — established 2026-08-08

## Audited
- **ImpactOS — audited 2026-08-11, first time the module has ever been run** (AUDIT-BRIEF.md). Thirteen findings, IMP-01 … IMP-13, all on the roadmap; every one observed in a browser or against the live dev API. The four that matter: an admin of one co-op can read, export and edit **another** co-op's surveys and see respondents' names and emails (IMP-01, same class as SEC-01); the admin Impact page crashes outright for any org that has a survey response (IMP-02); no member can answer a survey because the question types the renderer handles are not the ones surveys actually use (IMP-04); and the metrics are structurally incapable of producing a number, because the aggregation averages answer keys nobody ever writes (IMP-05). Nothing was fixed — this was an audit pass. Test data cleaned up: dev DB back to 1 org, 8 users, 5 seeded responses.

## Planned (not yet built)
- [ ] **OPS-03a — Tier management UI.** Admins cannot create or edit membership tiers in the product at all; the API exists and nothing calls it. Blocks Charley setting up MaybeItsFate's dues. Must implement D-016's grandfathering option.
- [ ] **OPS-03c — Logo upload** (D-017). Blocked on the Supabase bucket and keys above.
- [ ] AccessOS v1 — admin-issued numeric door codes tied to membership status (D-004, D-006) — fast-follow, not in launch critical path
- [ ] Production hardening — the deploy works, but has never been exercised beyond auth. Worth a pass over the other modules (events, rooms, commons, impact) against prod before real members arrive
- [ ] Stripe live-mode config for MaybeItsFate
- [ ] Port CommonsOS parity (Collections/threading/pinning) into the public portal's separate Commons page, or decide the admin hub is the only place it needs to live
- [ ] Consolidate Prisma migration history — schema is currently synced via `prisma db push` (not `migrate dev`) because the canonical repo's committed migrations and the zip's committed migrations diverged against the same live Supabase DB; needs a clean migration squash before production cutover
- [ ] Wildcard subdomain tenant routing ([org].maybeos.com) — Stage 2, not needed for single-tenant launch
- [ ] Supabase Auth integration — Google OAuth, passwordless email, and phone sign-in options, replacing or augmenting the current custom JWT/bcrypt auth. Not scoped yet: needs a decision on whether this replaces `auth.service.ts` entirely or runs alongside it, and how Supabase Auth's own user records map to the existing Prisma `User`/`UserOrg` model
- [ ] Stripe product catalog — real Products/Prices configured so self-serve checkout works end to end, not just live API keys
- [ ] Global "product forum" org — every MaybeOS org owner auto-joins a free, global org; Stage 2 concept (needs multiple real org owners to be meaningful)
- [ ] Prepare github.com/millercharley/MaybeOS for open-source release — license, README, contributing guide, history scrub for secrets

## In Progress
- [ ] None. Three branches merged and **live on maybeos.org**: `claude/impact-deletion-pass` (`f5faea7`), `claude/scheduler` (`0a19ee0`), `claude/cmn-07` (`3e16aad`).
- **Tenant isolation is now fixed in three modules and unexamined in two.** The pattern is identical every time: a controller declared `@Controller('orgs/:orgId')` with `OrgMembershipGuard`, and service methods that resolve an entity by bare id and never compare it to that org. The guard proves the caller belongs to the org *they named in the URL*. See SEC-04 under Next.
- **Verification limit worth repeating:** every cross-tenant fix has been proven against the **dev** database by standing up a real second co-op. Production has one org and an empty database, so the same probe cannot be run there. The code is identical and the unit tests travel with it, but "verified in production" has not been said and should not be.
- **ImpactOS now has no user-facing surface at all.** That is the intended state under D-021, but it means impact tracking is invisible in the product until the Signals view and the touchpoint questions exist.

## Next
- **SEC-04 — sweep EventOS and MemberOS for the same org-scoping hole.** Three modules examined, three holes found and fixed: SPC-02, IMP-01, and CMN-07 (twenty methods). These two have never been checked, and three for three is not a reason to assume they are clean. Answer the standing question in the same pass: should a lint rule or a base class make it impossible for an org-scoped controller to resolve an entity by bare id?
- **CMN-08 — decide whether `DirectMessage` gets an `orgId`.** CMN-07 enforced org membership at the boundary, which stops cross-co-op messaging, but the data still has no tenant. Two people who share two co-ops have one thread, not one per co-op, and conversations cannot be retained, exported or deleted per-org. Schema decision, deliberately not taken during CMN-07.
- Then IMP-05/08/09 as one piece of work: the response schema (indicator, question version, collection window, uniqueness per member per window).

## How production ships
- **Netlify builds `claude/maybeOS-suite-foundation-1Wauk`** — origin's default branch, confirmed by Charley 2026-08-11. There is **no `main` branch**, and no staging step: **merging into that branch is the production deploy of maybeos.org.** Build and test on the merged result *before* pushing, not after. DEPLOY.md's Railway instructions are historical only (corrected in place).
- **Charley has delegated releases** (2026-08-11): merge and push without asking, report what went live afterwards. Prefer `--no-ff` so a release stays revertable as one commit. Still ask first for: Stripe live mode, destructive operations against the production database, secret rotation, or anything needing a credential in plaintext.
- **Caveat:** the Claude Code auto-mode classifier blocks `git merge` and blocks editing the permission settings that would allow it. That gate is the harness's, not Charley's. Charley added `Bash(git merge:*)` to `.claude/settings.json` on 2026-08-11, which lifts it. That file is **deliberately not committed** — it grants an agent merge rights and OSS-01 has this repo heading for open source, so committing it is Charley's call.
- **Scheduled work runs every 15 minutes** via the `scheduled-tasks` Netlify function (D-022). It is not reachable over HTTP: Netlify returns 403 to external callers (verified — a function that does not exist returns 404), and the handler itself refuses any invocation without a `next_run` payload. **Not yet observed firing in production**: production has no proposals or surveys, so a run leaves no trace, and confirming it needs the Netlify function logs — i.e. the token in OPS-12. Sentry cron check-ins would make this self-reporting without a schema change.

## Blocked on Charley
- **Netlify token expires ~2026-08-17** (about six days from 2026-08-11). It is the only one — the DEP-01 PAT was revoked 2026-08-10. Every deploy, env-var change and function log read goes through it, and it fails with a bare 401 when it lapses. Reissue before the date, not after. Tracked as OPS-12.
- **MaybeItsFate is invitation-only in production and nobody can join.** `Organization.allowPublicJoin` defaults to `false` and the self-join endpoint enforces it, but no admin UI sets it, so public joining cannot be turned on from inside the product. MEM-03 is that toggle. Until it ships, the only route in is an invitation.
- **The dev Supabase key is rejecting requests**, which blocks OPS-03c. The dev *database* is fine (the API's health check and this session's audit both ran against it) — it is the Supabase API key that fails, so the Storage upload path can neither be built nor exercised.
- **OPS-03c (logo upload)** needs a `org-logos` public bucket in both Supabase projects, plus `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as Netlify **secret** values. The service role key bypasses RLS — treat it as more sensitive than the Stripe key. See D-017.
- **Live Stripe key is unverified.** Netlify withholds the value, so nobody has confirmed it is `*_live_*` rather than a test key. A test key would look like it works while charging nobody. Confirm on the first tier created in production: `stripeProductId` populated, and the Product visible in Stripe's **live** dashboard.
- Nothing outstanding for Sentry. The Netlify PAT issued during DEP-01 was **revoked 2026-08-10** and confirmed dead (API returns 401); the site, functions, and error tracking were unaffected. Any future Netlify API work needs a fresh token.

## Open Questions
- ~~Q: What should a co-op get out of impact tracking?~~ **Answered 2026-08-11 by `Impact OS — Product Requirements Document` (Draft v0.1, Charley), in ~/Downloads.** Mission → goals → AI-drafted indicators → questions attached to existing MaybeOS touchpoints, under a hard fatigue budget of ~1 micro-question per member per 30 days, ending in a generated annual report. Survey authoring is an explicit non-goal. Not yet written up as a decision record — needs a D-021 if it is being adopted, since it re-scopes four audit findings (IMP-03, IMP-05, IMP-06, IMP-07) and adds four dependencies (IMP-14…17: no scheduler, no ticketing, no expense model, no member profile page). Largest open risk: the PRD's timed touchpoints and report cadences need scheduled execution, and D-007 removed the only queue MaybeOS had.
- Q: **What is EventOS's scope?** Events exist and are seeded, but ticketing, capacity, waitlists and the public feed have never been specified or exercised. The landing page sells "run a waitlist" and no interface for it exists (EVT-02).
- Q: What are MaybeItsFate's specific branding inputs (logo, colors, membership tier names/prices) to configure OrgOS for launch?
- Q: `listProposals` doesn't compute vote tallies (only `_count.votes`), so the Commons proposal cards show 0% everywhere despite real votes existing — worth fixing before launch? (Found incidentally, not fixed.)
- Q: Now that OrgMembershipGuard exists, should new org-scoped controllers be required to use it by convention/lint rule, so this class of bug can't reappear silently?

## Known issues (not blocking)
- `GET /api/auth/profile` returns `magicLinkToken` and `magicLinkExpiry` in its payload. `passwordHash` is correctly excluded. Low severity — the endpoint already requires a valid JWT for that same user, so it exposes nothing an attacker couldn't already act on. Still worth fixing: a magic-link token is a bearer credential and shouldn't be echoed into responses that may be cached or logged. Fix is a field selection in `auth.service.ts`.

## Blockers
- B: No Docker/Homebrew on this dev machine — local Postgres/Redis unavailable. Postgres resolved via Supabase; Redis moot per D-007. (Resolved / not blocking.)

## Last Session
- See SESSIONS.md top entry (2026-08-09).
