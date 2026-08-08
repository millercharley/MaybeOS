# STATE.md — Current State

**Rules for the AI:**
- This is the **first file you read at session boot.**
- It reflects *right now*: what exists, what's in progress, what's blocked. Keep it current at session shutdown.
- Keep it short. Historical narrative belongs in session summaries; durable facts belong in ARCHITECTURE.md / DECISIONS.md.

---

## Active Workstream
Get MaybeOS Suite production-ready and launch MaybeItsFate LCA as the first live tenant this month, onboarding-ready for other co-ops to follow (D-003). **Live at https://maybeos.org as of 2026-08-08.**

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
- [x] Project operating system (this folder) — established 2026-08-08

## Planned (not yet built)
- [ ] AccessOS v1 — admin-issued numeric door codes tied to membership status (D-004, D-006) — fast-follow, not in launch critical path
- [ ] Netlify deploy pipeline hardening — site is live at maybeos.org (Netlify project `8519a168-9c05-4ca9-9374-297766913c7d`), but confirm the NestJS-as-Functions adapter handles the full API surface, not just what's been manually exercised (D-005)
- [ ] Remove BullMQ/Redis dependency; synchronous Postmark email sends (D-007)
- [ ] Stripe live-mode config for MaybeItsFate
- [ ] Port CommonsOS parity (Collections/threading/pinning) into the public portal's separate Commons page, or decide the admin hub is the only place it needs to live
- [ ] Consolidate Prisma migration history — schema is currently synced via `prisma db push` (not `migrate dev`) because the canonical repo's committed migrations and the zip's committed migrations diverged against the same live Supabase DB; needs a clean migration squash before production cutover
- [ ] Wildcard subdomain tenant routing ([org].maybeos.com) — Stage 2, not needed for single-tenant launch

## In Progress
- [ ] None — awaiting direction on next task to pick up. Two commits pushed to `claude/maybeOS-suite-foundation-1Wauk` 2026-08-08: CommonsOS parity (`e9f7640`) and the OrgMembershipGuard security fix (`c8bc18c`). Both should be live at maybeos.org; not yet independently reconfirmed against the production URL (only against local dev pointed at the same Supabase DB).

## Open Questions
- Q: What are MaybeItsFate's specific branding inputs (logo, colors, membership tier names/prices) to configure OrgOS for launch?
- Q: Sentry DSN / error tracking — set up before go-live, or acceptable to launch without?
- Q: `listProposals` doesn't compute vote tallies (only `_count.votes`), so the Commons proposal cards show 0% everywhere despite real votes existing — worth fixing before launch? (Found incidentally, not fixed.)
- Q: Now that OrgMembershipGuard exists, should new org-scoped controllers be required to use it by convention/lint rule, so this class of bug can't reappear silently?

## Blockers
- B: No Docker/Homebrew on this dev machine — local Postgres/Redis unavailable. Postgres resolved via Supabase; Redis moot per D-007. (Resolved / not blocking.)

## Last Session
- See SESSIONS.md top entry (2026-08-08).
