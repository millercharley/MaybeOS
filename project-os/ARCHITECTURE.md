# ARCHITECTURE.md — Living Map

**Rules for the AI:**
- This is the **current-truth** blueprint. Keep it in sync with the code; if code and this file disagree, the code is truth and this file must be corrected (with approval).
- The **Module Index** below is the primary navigation tool. Use it to find *where to look*, then read the actual code in that slice for ground truth. **Do not read the whole codebase.**
- Update the relevant Module Index row whenever a module's files, interface, or dependencies change.

---

## 1. System Overview

MaybeOS is a membership/community platform for co-ops and member-owned organizations: OrgOS (tenant setup), MemberOS (tiers + Stripe billing), EventsOS (events/RSVP), SpaceOS (room booking), CommonsOS (channels/posts/governance), ImpactOS (surveys/metrics), plus a planned AccessOS (door codes). Backend is a NestJS "modular monolith" behind a Next.js App Router frontend, talking to Postgres via Prisma. A request from the browser hits Next.js (SSR/client), which calls the NestJS API (`/api/*`) with a JWT bearer token; the API resolves tenant via `orgId`/subdomain, checks RBAC guards, and reads/writes Postgres through Prisma. Stage 1 (current) is a single-tenant deployment for MaybeItsFate LCA; Stage 2 generalizes to self-serve multi-tenant onboarding (see DECISIONS D-003).

A separate, legacy static-HTML prototype (`maybeos-handoff`, outside this repo) exists purely as a UX/feature reference for what a fully-realized member portal + community hub should feel like — it is not part of the production path (D-002).

**Canonical repo location:** `~/Documents/Claude/Projects/maybeos-suite`, git-tracked, remote `github.com/millercharley/MaybeOS` (D-008). Netlify project `8519a168-9c05-4ca9-9374-297766913c7d` already builds from this repo. There are two distinct frontend surfaces: `apps/web/app/(dashboard)` (the internal admin/member app used by org staff — where this session's Commons work lives) and `apps/web/app/portal/[orgSlug]/*` (a separate public-facing, multi-tenant member portal keyed by org slug — pre-existing, not yet exercised by this session).

## 2. Tech Stack (summary; rationale lives in DECISIONS.md)

| Layer | Choice | Decision ref |
|---|---|---|
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind CSS, Zustand | D-002 |
| Backend / API | NestJS 10, TypeScript, Prisma ORM | D-002 |
| Database | PostgreSQL, hosted on Supabase (pooled `DATABASE_URL` :6543 + direct `DIRECT_DATABASE_URL` :5432) | D-002 |
| Auth | JWT (bearer) + magic links, RBAC (ADMIN/STAFF/MEMBER/GUEST per org) | D-002 |
| Hosting | Netlify (web) + Netlify Functions (API, via serverless adapter) | D-005 |
| Background jobs | None in MVP — email sends synchronously; BullMQ/Redis deferred | D-007 |
| CI/CD | GitHub Actions (`\.github/workflows/ci.yml`) — build/lint/test only; deploy step not yet added | — |

## 3. Module Index

> The ramp-in mechanism. For any task, locate the module(s) here, load only those files, read their interface, note dependencies. Used for both feature work and mapping production errors (via the `module` field in the production log).

| Module | Responsibility | Owns these files/paths | Public interface / contract | Depends on |
|---|---|---|---|---|
| `auth` | Login, magic links, JWT issuance, RBAC guards | `apps/api/src/modules/auth/*`, `apps/api/src/common/guards/*` | `POST /api/auth/{register,login,magic-link}`, `GET /api/auth/profile`, `JwtAuthGuard`, `RolesGuard` | `db` (User, UserOrg) |
| `org` | Tenant/org CRUD, locations, branding, settings | `apps/api/src/modules/org/*` | `POST /api/orgs`, `GET /api/orgs/:orgId`, `GET /api/orgs/by-slug/:slug`, `PATCH /api/orgs/:orgId` | `auth` |
| `member` | Membership tiers, member directory, CSV import, invitations (invite/resend, `Invitation` model) | `apps/api/src/modules/member/*` (incl. `invite.controller.ts`) | `GET/POST /api/orgs/:orgId/{members,tiers}`, `POST .../members/invite`, `.../invitations/:id/resend` | `org`, `stripe` |
| `events` | Event CRUD, RSVP + waitlist, public feeds (JSON/ICS) | `apps/api/src/modules/events/*` | `POST /api/orgs/:orgId/events`, `GET .../events/public`, `.../events/feed.{json,ics}`, `.../events/:id/rsvp` | `org`, `member` |
| `space` | Rooms, availability rules, booking + conflict detection | `apps/api/src/modules/space/*` | `POST /api/orgs/:orgId/rooms`, `.../rooms/:id/bookings`, `.../bookings/:id/approve` | `org`, `calendar` (optional sync) |
| `commons` | Channels (incl. pinning), posts/comments (incl. threaded replies)/reactions, governance proposals + voting, Direct Messages, Collections (wiki), cross-entity search | `apps/api/src/modules/commons/*` | `POST /api/orgs/:orgId/channels`, `.../channels/:id/pin`, `.../channels/:id/posts`, `.../posts/:id/comments` (accepts `parentId`), `.../channels/:id/proposals`, `.../proposals/:id/vote`, `GET/POST .../dms[/:userId]`, `GET/POST .../collections[/:id/pages]`, `GET .../search?q=` | `org`, `member` |
| `impact` | Surveys, response aggregation, dashboard export | `apps/api/src/modules/impact/*` | `POST /api/orgs/:orgId/surveys`, `.../surveys/:id/respond`, `GET .../impact/dashboard` | `org`, `member` |
| `stripe` | Checkout, billing portal, webhook-driven subscription lifecycle | `apps/api/src/modules/stripe/*` | `POST /api/orgs/:orgId/checkout`, `.../billing-portal`, `POST /api/stripe/webhooks` | `member`, `org` |
| `email` | Transactional email via Postmark; console-log fallback in dev | `apps/api/src/modules/email/*` | Internal service, called by other modules (e.g. dunning, invites) | none (leaf) |
| `calendar` | Google Calendar OAuth + bidirectional sync for room bookings | `apps/api/src/modules/calendar/*` | OAuth flow at `/api/calendar/oauth/*` | `space` |
| `health` | Liveness/readiness check | `apps/api/src/modules/health/*` | `GET /api/health` | `db` |
| `access` (planned) | Door codes for members, tied to membership status; NFC/vendor integration deferred (D-006) | not yet created — will live at `apps/api/src/modules/access/*` | TBD: `POST /api/orgs/:orgId/doors`, `.../members/:id/door-code` | `member`, `org` |

**Frontend route groups** (`apps/web/app/`): `(public)` — marketing/public event pages, calendar embed; `(auth)` — login/register/magic-link; `(dashboard)` — `admin/*` and `member/*`, gated by `useAuthStore`, shows `OrgSetup` onboarding when the user has no org yet; `portal/[orgSlug]/*` — separate public multi-tenant member portal (pre-existing, unverified this session); `invite/*` — invitation-acceptance flow. API client lives at `apps/web/lib/api.ts`; data-fetching hook is `apps/web/hooks/use-api.ts` (`useApi`/`usePublicApi`); global ⌘K search is `components/layout/command-palette.tsx`, mounted in the `(dashboard)` layout.

## 4. Cross-Cutting Concerns

- **Security & RLS:** Tenant isolation enforced in application code (all queries scoped by `orgId`), not Postgres row-level security. `TenantMiddleware` resolves org context; `RolesGuard` + `@Roles()` decorators enforce RBAC per-endpoint (D-002 completeness review confirmed this is real, not scaffolded).
- **Caching & CDN:** None yet — to be addressed with Netlify hosting setup (D-005).
- **Rate limiting:** `@nestjs/throttler` (`ThrottlerGuard`) applied globally via `app.module.ts`.
- **Error tracking & logging:** `nestjs-pino` for structured logs. Sentry wired but disabled (`SENTRY_DSN` empty) — needs a DSN before production.
- **Accessibility (ADA):** Not yet audited.
- **Background jobs:** None in MVP (D-007) — previously BullMQ/Redis, removed as a hard dependency because Netlify Functions can't host a persistent worker.

## 5. Data Models (canonical)

Source of truth: `apps/api/prisma/schema.prisma` (as of 2026-08-08: Organization, Location, User, UserOrg, MembershipTier, Event, Rsvp, Attendance, Room, AvailabilityRule, Booking, Channel, Post, Comment [self-referential `parentId` for threading], Reaction, DirectMessage, Proposal, Vote, Survey, SurveyResponse, WebhookEvent, AuditLog, EmailTemplate, Invitation, Collection, CollectionPage). Every tenant-scoped table carries an `orgId` foreign key. Schema is currently synced to the shared Supabase dev DB via `prisma db push` rather than `migrate dev` (see STATE.md planned item on consolidating migration history).

Planned additions for AccessOS (D-004/D-006): `Door` (per-location), `DoorCode` (member-scoped, code + validity window + revoked flag), `AccessEvent` (audit log of code issuance/revocation — not physical unlock events, since v1 has no hardware integration).

## 6. Deployment & Environments

- **Environments:** `dev` only today — local Next/Nest dev servers against a shared Supabase Postgres dev database. No staging/prod environment exists yet.
- **`.env` gotcha:** NestJS's `ConfigModule` and the Prisma CLI resolve `.env` relative to the process's cwd, which is `apps/api/` when launched via `npm run dev --workspace=apps/api` — not the repo root, despite the top-level README's `cp .env.example .env` instruction. Keep `.env` in both places until this is cleaned up. `apps/web` needs its own `apps/web/.env.local` for `NEXT_PUBLIC_API_URL`.
- **Deploy process:** Not yet built. Target: Netlify site for `apps/web`; NestJS API adapted to Netlify Functions (D-005) — adapter work not started.
- **Recovery:** Not yet defined — Supabase provides automatic backups on paid tiers; confirm plan/retention before go-live.
