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
- [x] Project operating system (this folder) — established 2026-08-08

## Planned (not yet built)
- [ ] AccessOS v1 — admin-issued numeric door codes tied to membership status (D-004, D-006) — fast-follow, not in launch critical path
- [ ] Production hardening — the deploy works, but has never been exercised beyond auth. Worth a pass over the other modules (events, rooms, commons, impact) against prod before real members arrive
- [ ] Stripe live-mode config for MaybeItsFate
- [ ] Port CommonsOS parity (Collections/threading/pinning) into the public portal's separate Commons page, or decide the admin hub is the only place it needs to live
- [ ] Consolidate Prisma migration history — schema is currently synced via `prisma db push` (not `migrate dev`) because the canonical repo's committed migrations and the zip's committed migrations diverged against the same live Supabase DB; needs a clean migration squash before production cutover
- [ ] Wildcard subdomain tenant routing ([org].maybeos.com) — Stage 2, not needed for single-tenant launch
- [ ] Landing page redesign/rebrand for marketing — **waiting on Charley for design direction before starting** (his request, do not start unprompted)
- [ ] Supabase Auth integration — Google OAuth, passwordless email, and phone sign-in options, replacing or augmenting the current custom JWT/bcrypt auth. Not scoped yet: needs a decision on whether this replaces `auth.service.ts` entirely or runs alongside it, and how Supabase Auth's own user records map to the existing Prisma `User`/`UserOrg` model
- [ ] Stripe product catalog — real Products/Prices configured so self-serve checkout works end to end, not just live API keys
- [ ] Global "product forum" org — every MaybeOS org owner auto-joins a free, global org; Stage 2 concept (needs multiple real org owners to be meaningful)
- [ ] Prepare github.com/millercharley/MaybeOS for open-source release — license, README, contributing guide, history scrub for secrets

## In Progress
- [ ] None — awaiting direction. Everything through OPS-07 is pushed to `claude/maybeOS-suite-foundation-1Wauk`.

## Blocked on Charley
- **Revoke the Netlify PAT** issued during DEP-01 — it was used to set the Sentry env vars and trigger the deploy on 2026-08-10 and is no longer needed.

## Open Questions
- Q: What are MaybeItsFate's specific branding inputs (logo, colors, membership tier names/prices) to configure OrgOS for launch?
- Q: `listProposals` doesn't compute vote tallies (only `_count.votes`), so the Commons proposal cards show 0% everywhere despite real votes existing — worth fixing before launch? (Found incidentally, not fixed.)
- Q: Now that OrgMembershipGuard exists, should new org-scoped controllers be required to use it by convention/lint rule, so this class of bug can't reappear silently?

## Known issues (not blocking)
- `GET /api/auth/profile` returns `magicLinkToken` and `magicLinkExpiry` in its payload. `passwordHash` is correctly excluded. Low severity — the endpoint already requires a valid JWT for that same user, so it exposes nothing an attacker couldn't already act on. Still worth fixing: a magic-link token is a bearer credential and shouldn't be echoed into responses that may be cached or logged. Fix is a field selection in `auth.service.ts`.

## Blockers
- B: No Docker/Homebrew on this dev machine — local Postgres/Redis unavailable. Postgres resolved via Supabase; Redis moot per D-007. (Resolved / not blocking.)

## Last Session
- See SESSIONS.md top entry (2026-08-09).
