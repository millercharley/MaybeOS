# DECISIONS.md — Immutable Decision Log

**Rules for the AI:**
- This file is **append-only**. Never edit or delete an existing entry.
- To reverse or change a past decision, add a **new** entry that references and supersedes the old one by its ID (e.g. "Supersedes D-004").
- Every entry requires my explicit approval before being committed.
- This is the project's permanent memory of *why* — read it before any change that touches an established decision.

**Entry format:** copy the block below for each new decision.

---

### D-000 — [Short decision title]

- **Date:** YYYY-MM-DD
- **Status:** Active | Superseded by D-XXX
- **Area:** (Frontend | Backend | Database | Auth | Hosting | CI/CD | Security | etc.)
- **Decision:** What we decided, stated plainly.
- **Alternatives rejected:** What we considered and chose not to do.
- **Rationale:** Why this choice, given the alternatives.
- **Supersedes:** (D-XXX, or "none")

---

<!-- New entries go ABOVE this line, newest at top. Do not modify entries above. -->

### D-010 — Production topology: single Netlify site, API as a Function, separate prod database

- **Date:** 2026-08-09
- **Status:** Active
- **Area:** Hosting, Database
- **Decision:** maybeos.org is one Netlify site serving both surfaces. The Next.js frontend deploys normally; the NestJS API is compiled ahead of time by a local build plugin and served from a single Netlify Function, with an edge redirect sending `/api/*` to it. Production uses its **own** Supabase project (`iugbkabdbgkofyaychjy`, ca-central-1), entirely separate from the dev project (`xuinggqdewoxiejkacio`, us-west-2).
- **Alternatives rejected:** Sharing one Supabase project between dev and prod (rejected — `db:seed` deletes every row, and the two connection strings differ by a few characters; one mistake destroys real member data). Splitting the API onto a separate host like Railway (rejected for now — a single Netlify site keeps the API same-origin, which sidesteps CORS entirely and needs no second deployment target).
- **Rationale:** Same-origin API means no CORS surface. Separate databases make the destructive-seed failure mode structurally impossible rather than merely discouraged.
- **Required environment variables** (all set on the Netlify site; four exist purely because of non-obvious platform behavior):
  - `DATABASE_URL` — prod Supabase **session pooler** (port 5432). Must be the pooler, *not* the `db.<ref>.supabase.co` direct host: that host is **IPv6-only**, and Netlify Functions run on IPv4-only Lambda, so the direct URL cannot connect from production at all. Password must be URL-encoded.
  - `JWT_SECRET` — generated fresh for prod; deliberately not the dev secret.
  - `NODE_ENV=production` — also disables the Swagger docs endpoint, which should not be public.
  - `NPM_FLAGS=--include=dev` — **required because of `NODE_ENV=production`**: npm otherwise skips devDependencies, which removes the NestJS CLI, TypeScript, and the Prisma CLI, and the API build silently fails. Setting `NODE_ENV` alone breaks the build.
  - `NEXT_PUBLIC_API_URL=https://maybeos.org` — baked in at build time and used by the *browser*. Without it the client falls back to `http://localhost:3001` and every request fails with "Failed to fetch", even while server-side rewrites and `curl` against the API both work perfectly. Changing it requires a rebuild, not just a redeploy.
- **Supersedes:** none (implements D-005)

### D-009 — Add OrgMembershipGuard as a baseline tenant-isolation check

- **Date:** 2026-08-08
- **Status:** Active
- **Area:** Security, Backend
- **Decision:** Introduced `OrgMembershipGuard` (`apps/api/src/common/guards/org-membership.guard.ts`): for any route with an `:orgId` param, the authenticated caller must have an entry in their JWT's `orgRoles` for that org, or be a platform admin. Applied at the controller level for Commons, Space, and Impact (every route in those controllers is genuinely org-member-only), and per-endpoint for the specific leaking routes in Member (`listMembers`, `getMember`), Events (admin `listEvents`, `findById`), and Calendar (`checkFreeBusy`). Deliberately not applied to: org creation and invite acceptance (no `:orgId` yet, by definition), public event feeds/RSVP/guest-RSVP, the public tier-listing endpoint, and Stripe checkout/billing-portal (billing-portal already self-scopes correctly via the caller's own `(userId, orgId)` lookup; checkout must stay open since it's the actual join-and-pay flow for people who aren't members yet).
- **Alternatives rejected:** Adding `@Roles('ADMIN','STAFF','MEMBER','GUEST')` to each individual leaking endpoint (rejected — same effect, but relies on every future endpoint remembering to add it; a shared guard makes the safe state the default for any new org-scoped controller that adopts the same `@UseGuards(...)` pattern).
- **Rationale:** `RolesGuard` was designed to check *specific* roles, and only when a route opts in via `@Roles(...)` — it returns `true` unconditionally when no roles are required, with no baseline check that the caller belongs to the org in the URL at all. Confirmed exploitable live (pre-fix): a user with no relationship to Sunrise Community Space could read its full member directory and post/comment/react/vote/book-a-room/submit-a-survey-response into its data, using nothing but their own valid login. Since `/register` is public and self-serve org creation exists, this was reachable by anyone, not just an insider — and became more urgent once the app went live at maybeos.org mid-session.
- **Supersedes:** none

### D-008 — Adopt github.com/millercharley/MaybeOS as the canonical repo, superseding the unversioned zip working copy

- **Date:** 2026-08-08
- **Status:** Active
- **Area:** Process, Backend, Frontend
- **Decision:** The canonical MaybeOS Suite codebase is now the git-tracked clone at `~/Documents/Claude/Projects/maybeos-suite`, sourced from `github.com/millercharley/MaybeOS` (already wired to Netlify project `8519a168-9c05-4ca9-9374-297766913c7d`). This repo turned out to contain a substantially more advanced, actively-developed line of work than the zip this session started from — 25 commits deep (branch `claude/maybeOS-suite-foundation-1Wauk`) covering a member invitations flow, a public multi-tenant member portal at `apps/web/app/portal/[orgSlug]/*` with subdomain routing, an org-creation/onboarding flow, JWT refresh, security hardening, a 36-test test suite, and multiple rounds of production-deploy bugfixes (a prior Railway deploy target, per commit history and `DEPLOY.md`) — none of which existed in the zip this session started from. (Initial investigation via a shallow `git clone --depth 1` misleadingly showed only the single tip commit and led to an incorrect "one commit total" read of the repo's history; a full clone corrected this.) The old working directory (`MaybeOS-claude-maybeOS-suite-foundation-1Wauk`, ungitted) is retired; this session's Commons-parity work (D-004 onward: DMs, Collections/wiki, threaded replies, channel pinning, ⌘K search) was ported onto this repo via careful file-by-file diffing rather than overwriting it, preserving all of the above. Two of this session's earlier fixes were reverted after discovering the real repo already addressed them, better: the `loadProfile()`-after-login fix (already handled reactively in `auth-provider.tsx` via commit `74eea9c`) and re-adding Prisma's `directUrl` (deliberately removed in commit `861ebef` after it crashed the Railway deploy when the env var was unset — resolved instead by pointing `DATABASE_URL` at Supabase's session-mode pooler, which supports migrations without a separate direct URL).
- **Alternatives rejected:** Pushing the zip-based working tree over the GitHub repo (rejected — would have destroyed the invitations flow, public portal, and test suites, none of which this session had seen before discovering the repo); keeping both trees alive in parallel (rejected — guarantees future drift and confusion about which is canonical).
- **Rationale:** The GitHub-linked repo is what's actually wired to the live Netlify deploy target; building anywhere else means the deploy step would need a separate reconciliation later anyway. Reconciling now, while the delta is well-understood, is far cheaper than reconciling after more divergent work piles up on both sides.
- **Supersedes:** none (refines D-002's "sole production codebase" to a specific, git-tracked location)

### D-007 — Drop BullMQ/Redis as a hard dependency for MVP; send email synchronously

- **Date:** 2026-08-08
- **Status:** Active
- **Area:** Backend
- **Decision:** For the initial production launch, remove the requirement for a persistent Redis-backed job queue. Email sends (the only current BullMQ consumer, `modules/email`) go out synchronously in the request path via the Postmark API call, with the existing dev-mode console-log fallback preserved when `POSTMARK_API_TOKEN` is unset. BullMQ/Redis can be reintroduced later for genuinely async work (calendar sync, digest emails, dunning retries) once the platform runs somewhere that supports a persistent worker process.
- **Alternatives rejected:** Standing up a hosted Redis (e.g. Upstash) just to keep BullMQ — rejected because Netlify Functions (D-005) don't support a long-running worker process to consume the queue anyway, so a queue without a consumer doesn't help.
- **Rationale:** Forced by D-005 (serverless hosting target). Removing the dependency also resolves the local dev blocker (no Redis available on this machine) without needing a workaround.
- **Supersedes:** none

### D-006 — Scope AccessOS v1 to admin-issued numeric door codes only

- **Date:** 2026-08-08
- **Status:** Active
- **Area:** Backend (new module)
- **Decision:** The first version of AccessOS (see D-004) supports only admin-provisioned numeric door codes tied to membership status (auto-revoke on lapse/cancellation), for use with keypad hardware already at the physical space. NFC virtual keys and third-party smart-lock/vendor integration (e.g. Seam, Kisi, Latch) are deferred to a later version. AccessOS ships as a fast-follow after the core platform launch, not as part of this month's MaybeItsFate go-live.
- **Alternatives rejected:** Building against a specific smart-lock vendor now (rejected — no hardware decision made yet, would block on a vendor evaluation); building a hardware-agnostic abstraction layer up front (rejected — premature, no second hardware target exists yet to abstract against).
- **Rationale:** Product owner confirmed no smart-lock hardware is in place yet, and door access is not required for launch. Numeric codes are usable immediately with existing keypad hardware and require no external integration.
- **Supersedes:** none

### D-005 — Host MaybeOS on Netlify (web) + Netlify Functions (API)

- **Date:** 2026-08-08
- **Status:** Active
- **Area:** Hosting
- **Decision:** Production hosting target is Netlify: the Next.js web app deploys as a standard Netlify site; the NestJS API is adapted to run as Netlify Functions (wrapping the compiled Nest/Express app via a serverless adapter, e.g. `serverless-http`), routed under `/api/*`. Database stays on Supabase Postgres (pooled connection, suited to serverless connection bursts).
- **Alternatives rejected:** Vercel (web) + Railway/Render (API) — a more conventional pairing for this exact stack (long-running Nest server, no serverless adapter needed) — rejected in favor of consistency with the product owner's existing Netlify account/workflow used across other projects.
- **Rationale:** Product owner already operates on Netlify elsewhere and prefers to keep infrastructure consolidated on one provider.
- **Supersedes:** none

### D-004 — Add AccessOS: door code / NFC virtual key provisioning module to roadmap

- **Date:** 2026-08-08
- **Status:** Active
- **Area:** Backend (new module)
- **Decision:** Add a new "AccessOS" module to the roadmap: admins can manually provision or automatically issue door codes and/or NFC virtual keys to members for unlocking property doors, tied to membership status (auto-revoke on lapse/cancellation). See D-006 for v1 scope.
- **Alternatives rejected:** none — new requirement, no prior approach existed.
- **Rationale:** New requirement from product owner (Charley), needed for the physical co-op space use case.
- **Supersedes:** none

### D-003 — Staged rollout: single-tenant launch, then multi-tenant SaaS

- **Date:** 2026-08-08
- **Status:** Active
- **Area:** Process
- **Decision:** Stage 1 (this month): deploy MaybeOS Suite as a single-tenant production instance for MaybeItsFate LCA. Stage 2: generalize onboarding so any co-op can self-serve sign up, matching the original multi-tenant vision described in the Suite README.
- **Alternatives rejected:** Building full multi-tenant self-serve onboarding first, before any real tenant — rejected because it delays MaybeItsFate's launch and multi-tenant polish is easier to validate against one real, demanding customer first.
- **Rationale:** Ship value to the first real customer fast; use their actual usage to harden the platform before opening self-serve signup to strangers.
- **Supersedes:** none

### D-002 — Adopt MaybeOS Suite (NestJS/Next/Prisma) as the sole production codebase

- **Date:** 2026-08-08
- **Status:** Active
- **Area:** Backend, Frontend
- **Decision:** The generalized "MaybeOS Suite" monorepo (NestJS API + Next.js web + Prisma/Postgres) is the production codebase going forward. The static HTML/localStorage demo (`maybeos-handoff`, the MaybeItsFate-specific prototype) is retired to reference-only status — used to check UX/feature parity while porting, but not shipped or extended further.
- **Alternatives rejected:** Continuing to build out the static demo into production (rejected — no real backend, auth, persistence, or multi-tenancy; not viable for a real co-op handling payments and member data); rewriting the backend from scratch (rejected — an independent completeness review found the Suite foundation already has real, working business logic across all 11 modules, not scaffolding).
- **Rationale:** Suite foundation passed an honest completeness review and now runs end-to-end against a real Supabase Postgres database (login → dashboard → live data, verified 2026-08-08). Fastest path to a real, shippable product.
- **Supersedes:** none

### D-001 — Adopt the three-layer canonical model + session protocol

- **Date:** YYYY-MM-DD
- **Status:** Active
- **Area:** Process
- **Decision:** Project memory is maintained across DECISIONS.md (immutable), ARCHITECTURE.md (living map + Module Index), and STATE.md (current state), governed by a boot/shutdown session protocol. The AI maintains all three with human approval.
- **Alternatives rejected:** Single monolithic canonical doc (grows past context window, causes drift); no persistent docs (memory lost between sessions).
- **Rationale:** Layered, selectively-loaded docs prevent both forgetting and token waste over many short sessions.
- **Supersedes:** none
