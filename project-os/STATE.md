# STATE.md — Current State

**Rules for the AI:**
- This is the **first file you read at session boot.**
- It reflects *right now*: what exists, what's in progress, what's blocked. Keep it current at session shutdown.
- Keep it short. Historical narrative belongs in session summaries; durable facts belong in ARCHITECTURE.md / DECISIONS.md.

---

## Active Workstream
Get MaybeOS Suite production-ready and launch MaybeItsFate LCA as the first live tenant this month, onboarding-ready for other co-ops to follow (D-003).

## Built (exists & working)
- [x] Auth (JWT + magic link + RBAC) — verified end-to-end 2026-08-08
- [x] OrgOS, MemberOS, EventsOS, SpaceOS, CommonsOS, ImpactOS, Stripe, Email, Calendar, Health modules — real business logic, compiles and runs against Supabase
- [x] Member invitations (invite/resend, pending-invites UI on admin members page) — pre-existing in the canonical repo (D-008), not built this session
- [x] Public multi-tenant member portal (`apps/web/app/portal/[orgSlug]/*`: commons, directory, events, impact, rooms) — pre-existing in the canonical repo (D-008), not yet exercised/verified this session
- [x] Org onboarding component (`components/setup/org-setup.tsx`), shown automatically when a logged-in user has no org — pre-existing, not yet verified this session
- [x] Test suites: auth service, roles guard, Stripe service, exception filter, auth e2e — pre-existing in the canonical repo, not run this session
- [x] CommonsOS parity additions (this session, D-004 onward): Collections/wiki (CRUD + pages), threaded comment replies, channel pinning, Direct Messages (list/send/read receipts), ⌘K search across members/channels/events/pages — built, merged into canonical repo, verified end-to-end in browser
- [x] Web admin dashboard (login → dashboard → members list) — verified live against seeded data
- [x] Legacy static demo (`maybeos-handoff`) — fully clickable single-tenant prototype; UX/feature reference only, not shipped (D-002)
- [x] Project operating system (this folder) — established 2026-08-08

## Planned (not yet built)
- [ ] AccessOS v1 — admin-issued numeric door codes tied to membership status (D-004, D-006) — fast-follow, not in launch critical path
- [ ] Netlify deploy pipeline: web site + NestJS-as-Functions adapter (D-005) — Netlify project already exists (`8519a168-9c05-4ca9-9374-297766913c7d`), building from this repo; adapter work not started
- [ ] Remove BullMQ/Redis dependency; synchronous Postmark email sends (D-007)
- [ ] Stripe live-mode config for MaybeItsFate
- [ ] Verify the pre-existing onboarding wizard (`org-setup.tsx`) and public portal actually work end-to-end — inherited from D-008's repo, not yet exercised
- [ ] Consolidate Prisma migration history — schema is currently synced via `prisma db push` (not `migrate dev`) because the canonical repo's committed migrations and the zip's committed migrations diverged against the same live Supabase DB; needs a clean migration squash before production cutover
- [ ] Wildcard subdomain tenant routing ([org].maybeos.com) — Stage 2, not needed for single-tenant launch

## In Progress
- [ ] None — awaiting direction on next task to pick up. CommonsOS parity commit (`e9f7640`) pushed to `claude/maybeOS-suite-foundation-1Wauk` 2026-08-08; Netlify deploy triggered, not yet confirmed green.

## Open Questions
- Q: What are MaybeItsFate's specific branding inputs (logo, colors, membership tier names/prices) to configure OrgOS for launch?
- Q: Sentry DSN / error tracking — set up before go-live, or acceptable to launch without?
- Q: `listProposals` doesn't compute vote tallies (only `_count.votes`), so the Commons proposal cards show 0% everywhere despite real votes existing — worth fixing before launch? (Not part of this session's Commons-parity scope, found incidentally while verifying.)

## Blockers
- B: No Docker/Homebrew on this dev machine — local Postgres/Redis unavailable. Postgres resolved via Supabase; Redis moot per D-007. (Resolved / not blocking.)

## Last Session
- See SESSIONS.md top entry (2026-08-08).
