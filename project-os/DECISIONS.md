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

### D-027 — No page names a specific co-op

- **Date:** 2026-08-18
- **Status:** Active
- **Area:** Frontend, Multi-tenancy, Testing
- **Trigger:** On 2026-08-18 a member signed in to maybeos.org, followed the events link from his own dashboard, and was told `Organization with slug "sunrise" not found`. Two public pages called the API with the literal `'sunrise'`, an org existing only in the dev database. Neither had ever been capable of working in production, and both were reachable from four places including the member dashboard and the RSVPs list.
- **Decision:** **No page, component or hook may contain an organization identifier as a literal** — neither slug nor uuid. An org identifier is always something a surface is *given*: by its route (`/portal/[orgSlug]`), by the signed-in member's selected org, or by the hostname once SCL-01's wildcard DNS exists. Enforced by `apps/web/__tests__/no-hardcoded-org.spec.ts`, which fails the build rather than relying on review.
- **Why this is worth a rule rather than a fix:** the defect was not a wrong slug, it was a **single-tenant assumption surviving into a multi-tenant app**. MaybeOS serves many co-ops; a page that knows which one it is about is wrong even when the literal happens to be right. That class of bug fails *only* in the environment nobody develops in, which is precisely why it survived from the day it was written until a real member hit it.
- **Why a test rather than a convention:** the same reasoning as OPS-11's connection limit. A rule that lives only in someone's memory is one that gets lost; this one now fails on the commit that introduces it. The test is validated in both directions — it catches the two real offenders taken from git history, and reintroducing the call makes it fail naming the exact file and line — so it cannot pass while enforcing nothing. A third case pins the known-bad samples and asserts the correct shapes do *not* match, so it cannot be "fixed" by weakening it until everything passes.
- **Known limit, recorded honestly:** it is a lexical check, not a type-level one. It catches the literal-argument and pasted-uuid shapes that actually occurred; it would not catch an org identifier assembled from a constant or read from a config file. That is an acceptable ceiling for a guard costing under a second, not a claim of completeness.
- **Alternatives rejected:** *Code review* — this shipped through review already. *A lint rule* — more precise, but needs a custom ESLint plugin for one pattern, and a test is readable by whoever hits it. *Branding org ids in the type system* — genuinely stronger and worth doing if this recurs, but a much larger change, and it would not have caught the slug case, which is a plain string by nature.
- **Supersedes:** none.

---

### D-026 — Two kinds of connected Stripe account, each asked its own question

- **Date:** 2026-08-18
- **Status:** Active
- **Area:** Billing, Backend, Database
- **Trigger:** PAY-04. MaybeItsFate linked its existing Stripe account on 2026-08-18. The OAuth handshake, the token exchange and the stored account id all succeeded; the setup screen then reported `v1 Accounts cannot be used in v2 Account APIs`. The account was live and able to take money throughout — only the question was wrong.
- **Decision:** A connected account's **API generation is recorded** on `organizations.stripeAccountApi` (`V1` | `V2`) at the moment the account is connected, and its status is read through the API that matches. Accounts MaybeOS **creates** are v2 (`/v2/core/accounts`), read via the merchant capability. Accounts a co-op **links over Connect OAuth** are always **v1 Standard**, because they existed before MaybeOS did, and are read via `charges_enabled`. Anything not explicitly `V2` is read as v1.
- **Why recorded rather than inferred:** nothing in an `acct_…` id distinguishes the two. Inferring by attempting v2 and falling back when it fails would key product behaviour on matching an error string, and would cost every OAuth-linked co-op two API calls on every status read. OPS-11's lesson applies directly: a protection that lives only where nothing references it is one that gets lost.
- **Why not wait for propagation:** Stripe's guidance is that a linked v1 account becomes v2-compatible within ten minutes, signalled by `v2.core.account.created`. It had not after twenty. A setup screen cannot depend on an unbounded wait. Asking the matching API removes the race rather than timing it, and stays correct whenever v2 does catch up.
- **Measured before deciding, not reasoned:** `acct_1MhgKwDaRqv0hdwb` reports `type: "standard"`, `charges_enabled: true`, `details_submitted: true` and zero outstanding requirements, while `/v2/core/accounts` returns empty. **No account has ever been created through the v2 path in production** — the path the code treated as primary is the one that has never run, and the path every real co-op uses was the one being read incorrectly.
- **Consequence for onboarding:** `createOnboardingLink` now refuses for a v1 account instead of forwarding Stripe's internal error to an organiser. A co-op that onboarded with Stripe directly, years ago, has no MaybeOS setup left to finish.
- **What does not change:** the money paths. Checkout sessions and refunds are v1 APIs carrying the `stripeAccount` header and were compatible with a linked account throughout — D-013's direct-charge-with-application-fee model is untouched, and ticket sales were never actually blocked by this.
- **Alternatives rejected:**
  - *Wait for the `v2.core.account.created` webhook* (Stripe's option 1) — correct in principle and still worth adding, but not a fix on its own: twenty minutes in it had produced no usable v2 account, and the admin looks at a red banner meanwhile.
  - *Use v1 endpoints for everything* — works today, but abandons v2 for accounts MaybeOS creates and reverses the reasoning recorded in `connect.service.ts`: v1 account types are deprecated, and an account's configuration is fixed at creation, so a co-op onboarded on v1 could never be restructured without re-verifying identity and bank details.
  - *Create accounts with v2 rather than linking* (Stripe's option 3) — rejected outright. It is precisely the second-Stripe-account mistake PAY-05 exists to prevent.
  - *Enable Accounts v1 support in the Dashboard* (option 4) — held in reserve. It addresses v1 account *creation*, which is not this scenario, and it is a platform-wide setting not worth flipping on a guess.
- **Supersedes:** none. Extends **D-013** and the connection paths built for PAY-05.

---

### D-025 — The session-pooler constraint in D-014 and D-018 no longer holds

- **Date:** 2026-08-18
- **Status:** Active
- **Area:** Database, Backend, Reliability
- **Decision:** `DATABASE_URL` is the Supabase **transaction** pooler (port 6543, `pgbouncer=true`) and stays there. Prisma interactive transactions — specifically D-014's claim-and-dispatch of Stripe webhooks — work over it. The constraint recorded in **D-014** and repeated in **D-018**, that session mode (5432) is required or webhook processing breaks, is **withdrawn**.
- **Evidence, measured rather than argued:** webhook event `evt_1U48zSD14bhghVE2djZUee8A` is written inside that interactive transaction and nowhere else, and it committed at **00:29 UTC on 2026-08-14** — eighteen minutes after the redeploy (`59f6da1`) that moved `DATABASE_URL` to 6543. The row could not exist if the transaction had failed. Supavisor pins one server connection for the whole of a transaction, so `BEGIN…COMMIT` holds together across round trips; the classic PgBouncer problem was prepared statements, which `pgbouncer=true` already addresses.
- **Why this needed an entry rather than a code comment:** the stale half was the dangerous half. Port 5432's 15-client ceiling is what took production down three times on 2026-08-13 (OPS-11), and moving to the transaction pooler was the fix. A reader following D-018's instruction would undo the remedy in order to honour a constraint that no longer binds. `stripe.service.ts` carried exactly that instruction until it was corrected on 2026-08-18 (`cba6a7d`), and DECISIONS.md is what this project reads before touching an established decision.
- **What remains true from D-014:** everything else. The `WebhookEvent` row as both idempotency record and lock, `P2002` treated as another delivery winning the race, the handler running inside the same transaction so a throwing handler rolls back the claim, and the controller deliberately not catching so `GlobalExceptionFilter` still reports 5xx. Only the connection-mode constraint is withdrawn.
- **Alternatives rejected:**
  - *Leave the entries and rely on the corrected code comment* — rejected: the comment was the thing that was wrong, and a decision log that contradicts production is worse than none, because it looks authoritative.
  - *Revert `DATABASE_URL` to 5432 so D-014 stays true as written* — rejected: it reinstates the outage the move was made to end.
- **Caveat worth recording:** one committed transaction proves the mechanism works, not that it is immune under concurrency. The first ticket-sale webhook will be the first to exercise `dispatchEvent` on this path in production; if a charge succeeds and no ticket appears, this is where to look, and Stripe retries on its own schedule rather than losing the event.
- **Supersedes:** the connection-mode constraint in **D-014**, and **D-018**'s dependent claim that moving to the transaction pooler "is not an available fix". Both entries otherwise stand in full.

---

### D-024 — A minimal expense record, amending D-021's bookkeeping non-goal

- **Date:** 2026-08-13
- **Status:** Active
- **Area:** ImpactOS, Database, Product
- **Trigger:** IMP-16 sat open because it could not be built without contradicting D-021, whose non-goals list **bookkeeping** alongside CRM and grant management. The PRD's §7 composites — cost-per-outcome, mission-alignment-of-spend — have no denominator without expenses, and it is the PRD's own open question 7 whether significant expenses live inside the platform at all. Charley was offered three ways forward (close it as a non-goal; a deliberately minimal record; defer to the first report cycle) and chose the minimal record on 2026-08-13.
- **Decision:** MaybeOS records expenses, at the smallest size that makes the P1 composites computable: an **amount in integer cents**, the **date it was incurred**, a **category the co-op names itself** (free text, not an enum — a co-op naming its own categories is the point), and **optionally the goal it served**. Nothing else. The `expenses` table is organiser-only end to end, with no member-facing surface: members see aggregate impact, not what the co-op spends.
- **What this deliberately does not become:** there are no vendors, no invoice numbers, no payment status, no reconciliation, no attachments, no recurring schedules, no approval workflow and no double entry. **D-021's bookkeeping non-goal is narrowed, not withdrawn** — a co-op's books stay in its accounting software, and this exists only so that "what did that outcome cost" and "how much of our spending served our goals" have a denominator. The test of whether a future addition belongs is written on the model itself: *if a field here needs a second table to make sense, this has outgrown its decision and should be reconsidered rather than extended.*
- **Two consequences worth recording because they decide whether the numbers mean anything:**
  - **Unattributed spend is recorded, not omitted.** Mission-alignment-of-spend is computed over *all* recorded spend, so a co-op that attributes half its spending sees 50%. Computing it over attributed rows alone would return 100% forever and be worthless.
  - **The alignment share is `null` when nothing has been recorded, never `0`.** "None of our spend serves our goals" and "we have not recorded any spend" are different claims, and a generated report must not let the second read as the first.
- **The summary returns spend broken down and stops there.** No cost-per-outcome is computed at this layer: dividing money by survey responses would produce a figure that looks like a finding and is not one. The composites are P1 and belong with the outcomes they divide.
- **Alternatives rejected:** **Closing IMP-16 as a non-goal** — defensible, and the cheapest option, but it permanently forecloses two of the PRD's §7 composites and leaves ImpactOS able to describe what a co-op achieved and never what it cost. **Deferring to the first report cycle** — attractive because a real co-op would answer open question 7 better than we can, rejected because the denominator has to exist *before* the year it describes; a co-op that starts recording spend in month twelve has no year to report on. **A full accounting model** — never seriously considered; it is what D-021 ruled out, and the non-goal exists because bookkeeping is a product in its own right that MaybeOS would do badly.
- **Supersedes:** none. **Amends D-021** by narrowing its bookkeeping non-goal to exclude this specific record; every other part of that decision stands, including the fatigue budget, the survey-builder non-goal, and §10's rule that individual responses are never exposed to admins.

### D-023 — Postmark is the transactional email provider, and a verified sender is part of the decision

- **Date:** 2026-08-13
- **Status:** Active
- **Area:** Backend, Hosting
- **Decision:** Postmark is the transactional email provider for MaybeOS — every invitation, booking notification, magic link, welcome and dunning email goes through it via `EmailService`. This ratifies an assumption rather than introducing one: the `postmark` dependency arrived in the foundation commit (2026-02-16) as scaffolding, no decision record ever chose it, and no account had ever been created. Two things are now part of the decision rather than deployment trivia. First, **`EMAIL_FROM` must be an address Postmark has verified**, on a domain MaybeOS controls; the codebase previously carried three different defaults — `noreply@maybeos.app` in the config schema, `noreply@maybeos.com` in `EmailService`, and the site itself runs on `maybeos.org` — so the default sender could never have been verified under any of them. There is now one default, `noreply@maybeos.org`, defined once. Second, **`/api/health` reports whether email is configured** (`configured`, `transport`, `from` — never the token), because the failure mode below is otherwise invisible from outside.
- **Alternatives rejected:** **Resend** — likely free at MaybeItsFate's volume where Postmark is not, and the swap is about an hour's work; rejected because Postmark is already integrated, exercised by tests, and a migration buys a lower bill in exchange for re-verifying a domain and re-testing every email path at the exact moment the product needs email to start working. **Amazon SES** — cheapest by a wide margin at scale; rejected as the wrong shape for now, since leaving the sandbox requires a support request and the volume that would justify it does not exist yet. Both remain open later: the provider is isolated behind `EmailService`, and this decision is cheap to supersede.
- **Rationale:** The choice matters less than making it explicit, because the way this provider fails is silent by construction. `EmailService` falls back to logging when `POSTMARK_API_TOKEN` is unset, and it catches send failures rather than throwing them so that a Postmark outage cannot fail a member's registration. Both behaviours are correct alone. Together they mean a deployment that cannot send a single email is indistinguishable from a healthy one — which is exactly what happened: **every email in MaybeOS's production history had been a log line**, discovered on 2026-08-13 only because a magic link was requested and did not arrive (OPS-19, AUTH-02). A verified sender is written into this entry because it fails the same quiet way: Postmark refuses an unverified From address by logging the refusal, so "token set but sender unverified" and "no token at all" look identical from outside. Recording the provider also removes the standing risk that the next person treats a six-month-old scaffolding dependency as a considered choice, which is how this one survived unexamined.
- **Supersedes:** none. Refines D-007, which removed the BullMQ/Redis queue and made email send synchronously in the request path, and which mentioned the Postmark API call in passing as an inherited assumption while deciding something else.

### D-022 — Scheduled execution: adopt Netlify Scheduled Functions

- **Date:** 2026-08-11
- **Status:** Active — **not yet built**
- **Area:** Hosting, Backend, ImpactOS
- **Trigger:** D-021 adopts a PRD in which half the data collection is timed — post-use booking questions 2h after a session ends, host follow-up 72h after an event, attendee follow-up 24h after, plus scheduled report cadences and a per-member question queue that has to select at the moment its window opens. MaybeOS cannot run anything on a delay. `netlify.toml` registers exactly one function (`api.js`) and no `schedule`, and D-007 removed BullMQ/Redis because a serverless deploy had no worker to drain the queue. Every timed touchpoint in the PRD is currently unimplementable, and only the two synchronous ones (booking confirm, ticket purchase) can fire at all.
- **Decision:** Add **Netlify Scheduled Functions** as the platform's scheduling primitive. A scheduled function runs on a cron expression, invokes the existing Nest application code, and processes due work from the database. Timing state lives in Postgres — a due-at column on the queued item — not in an in-memory queue, so a missed or retried invocation is idempotent and recoverable rather than lost.
- **Alternatives rejected:**
  - *Bring back BullMQ/Redis* — rejected for the same reason D-007 removed it: a serverless function is not a worker, and adding managed Redis reintroduces a dependency and a cost line for what is, at MaybeItsFate's size, a few hundred rows a month.
  - *An external cron service pinging an API route* (GitHub Actions, cron-job.org) — rejected as a second place to hold production configuration, outside the Netlify deploy and invisible to anyone reading this repo.
  - *Fire timed questions lazily on the member's next page load* — genuinely tempting, needs no scheduler, and rejected because it silently biases the sample toward members who open the app. Response rate and its representativeness are the constraint the whole PRD is built around; skewing them to save infrastructure would corrupt the data the reports rest on.
- **Rationale:** It is the smallest thing that works, it lives in the repo next to the deploy it belongs to, and putting due-at state in Postgres means the scheduler is a trigger rather than a system of record. This does not reverse D-007 — no queue infrastructure comes back — it supplies the one capability D-007's removal left absent.
- **Consequences to watch:** the scheduled invocation shares the Lambda connection-limit problem from D-018 (Prisma opens a pool per container against a 15-connection cap), so it must reuse the same pooled client rather than opening its own. Netlify's minimum granularity is one minute, which is far finer than anything ImpactOS needs.
- **Supersedes:** none. Complements D-007 (which removed the queue) and D-005 (Netlify hosting).

### D-021 — Adopt Impact OS PRD v0.1 as the scope of ImpactOS

- **Date:** 2026-08-11
- **Status:** Active — **not yet built**
- **Area:** ImpactOS, Product
- **Trigger:** ImpactOS was audited on 2026-08-11 (AUDIT-BRIEF.md) — the first time the module had ever been run — producing thirteen findings, IMP-01…IMP-13. The audit could say what was broken but not what "working" would mean: the module had no decision record, no roadmap items, and no stated purpose. Charley answered it the same day with *Impact OS — Product Requirements Document*, Draft v0.1.
- **Decision:** The PRD is the scope of ImpactOS. Its shape: an admin writes a mission and three to five goals in plain language; AI drafts indicators and questions and presents a measurement plan for approval; questions attach to moments that already exist in MaybeOS (booking, ticket purchase, post-event, Commons) under a hard fatigue budget; the year ends in a generated, editable, publishable report. The admin's entire task list is five items, four of which happen once.
- **The load-bearing constraint is the fatigue budget**, not the AI: one micro-question per member per 30 days across all touchpoints, ~12 a year, with dismissal extending a member's window and three dismissals moving them to annual-check-in-only with no admin override. Response rate is the binding constraint on the whole product; a plan that burns member goodwill in month two has no report in month twelve.
- **What this makes a non-goal:** a general-purpose survey builder, academic evaluation (no causal claims), CRM/grant management, cross-community benchmarking, and bookkeeping.
- **Effect on the audit findings** — four of the thirteen are answered by this decision rather than fixed:
  - **IMP-06** (no survey authoring in the product) — authoring is an explicit non-goal. Remove the dead "Create Survey" and "New Survey" buttons; do not build the screen behind them.
  - **IMP-07** (responses and CSV export unreachable from the UI) — **inverts**. §10 says individual responses are never exposed to admins, and the export returns respondent names and email addresses beside their answers. Delete both endpoints instead of wiring them up.
  - **IMP-02 / IMP-03** (the dashboard crashes; every figure on it is zero) — the goal-organised Signals view replaces that page. Stop shipping the crashing route rather than repairing the chart.
  - **IMP-05** (the aggregation averages keys nothing ever writes) — stops being a bug and becomes the central schema question. A response must bind to an indicator, a **question version** and a **collection window**, or G5 ("every figure traces to a response count and collection window") is unenforceable, and so is the Ask guardrail against merging incompatible windows.
- **What the PRD assumes MaybeOS has and it does not** (verified in the codebase 2026-08-11, tracked as IMP-14…17):
  1. **No scheduler.** Half the touchpoints are timed. See D-022.
  2. **No ticketing.** Ticket purchase is one of four P0 touchpoints; `Event` has no price field, `Room.hourlyRate` is stored and never charged, and membership dues are the only thing MaybeOS charges for. Either ticketing gets built or that touchpoint leaves P0.
  3. **No expense model.** There is no expense, budget or invoice table, so cost-per-outcome and mission-alignment-of-spend have no denominator. This is the PRD's own open question 7 and it should gate §7 rather than trail it — subsidy and in-kind value are computable today (PWYC already exists on tiers), the composites are not.
  4. **No member profile page.** `/member/profile` is linked from the member dashboard and 404s (MEM-01), so the screen that owns member-owned, member-deletable demographic data does not exist.
- **Two amendments proposed against the PRD, not yet accepted by Charley:**
  - **Declare reportable segment cuts at plan-approval time.** At the PRD's own targets a 300-member community produces roughly 1,500 answers a year across the plan. Single-dimension cuts report fine; intersections of six activity dimensions and eight demographic fields will hit mandatory n<5 suppression almost everywhere, and the admin finds out at report time. §6.3 already prevents this failure for indicators ("this one won't have enough responses until year two") — segmentation deserves the same warning on the same screen.
  - **Demote G4** ("admin edits <25% of report blocks"). It is equally consistent with a good draft and with an admin who skimmed and published. The better signal already exists under Value: reports used in a grant application or board meeting.
- **Alternatives rejected:** a single fixed instrument shipped with the product, identical for every co-op, with per-org authoring disallowed (proposed by the AI earlier the same day) — rejected because it buys computability at the cost of every community measuring the same thing, and the PRD achieves the same discipline through the survey-builder non-goal while getting breadth from behavioural data that costs no fatigue budget.
- **Supersedes:** none. First decision record for ImpactOS.

### D-020 — Joining a co-op: public sign-up, or invitation-only with a prefilled payment link

- **Date:** 2026-08-11
- **Status:** Active — **not yet built**
- **Area:** MemberOS, Billing, Onboarding
- **Trigger:** Charley registered `charley.miller@gmail.com` in production, clicked "Join as Sustainer", and was taken to *create a new organization* instead of joining MaybeItsFate. No membership was created and no payment was ever offered.
- **Why it happened (all three layers):** the "Join as X" button is a plain `<Link href="/register">` that discards which org and tier were chosen; registering creates a `User` and never a `UserOrg` because **no self-join endpoint exists anywhere**; and the dashboard, seeing a user with no organizations, correctly-for-its-own-logic concludes they must be founding one. The button has always been decorative, like "Add Room" was before SPC-01.
- **Decision (Charley's, 2026-08-11):**
  1. **Public join** — a stranger joining through the public page lands as **`MEMBER`**. The `UserOrg` is created **immediately** with `subscriptionStatus: NONE`, and **payment status is reported** rather than hidden, so an admin can see who has joined but not yet paid. An abandoned checkout leaves a resumable record instead of a dead end.
  2. **Invitation-only mode** — admins can **hide the public payment/sign-up page**. The org is then joinable only by invitation.
  3. **Invite links carry identity** — an invite opens a **hashed (tokenised) URL** to the payment page with the invited person's known details **prefilled**.
- **Build on the existing invitation system, don't duplicate it.** `Invitation` already has `token`, `email`, `role` and `expiresAt` (INV-01), `/invite?token=` already exists, and `api.invites.get(token)` already returns the invitee's email, role and org for prefill. What is missing is **tier selection and checkout on that path** — not the invite infrastructure.
- **Shape:** one boolean on `Organization` (suggested `allowPublicJoin`, default **false** so every future co-op stays invitation-only until it opts in — a housing co-op or members' club must not be joinable by anyone who pays); an admin toggle; a self-join endpoint that creates the `UserOrg` and returns a checkout session; the public CTA rewired to carry org + tier through registration; and post-register routing that checks for a pending join before assuming org creation.
- **Security note for the tokenised link:** `/invite?token=` and `/magic-link?token=` are already the two routes whose URLs carry a working credential, and D-011's Sentry scrubbing exists specifically to stop those tokens reaching a third party. Any new tokenised payment URL must be added to `SENSITIVE_QUERY_KEYS` in `sentry.shared.ts` if it uses a different parameter name.
- **Supersedes:** none

### D-019 — SpaceOS audit: the booking engine is sound, everything around it is missing

- **Date:** 2026-08-11
- **Status:** Active — findings, work not yet started
- **Area:** SpaceOS, Frontend, Integrations
- **Trigger:** Charley reported that "Add Room" on `/admin/rooms` does nothing in production.
- **Correction of an earlier claim:** on 2026-08-11 I described SpaceOS as having "real two-way Google Calendar sync." That was wrong in the way that matters. `CalendarService` implements `createCalendarEvent`, `updateCalendarEvent`, `deleteCalendarEvent`, `checkFreeBusy` and `syncRoomCalendar` — and **every one has zero callers outside the calendar module**. `SpaceModule` does not import `CalendarModule`. The code exists and is never invoked. I read the implementations and reported them as working without checking for call sites, which is the same error that produced the Stripe defects.
- **What is genuinely built and correct:**
  - Room CRUD, capacity, amenities, per-room `requiresApproval` and `memberOnly` flags, multi-site via `Location`.
  - `AvailabilityRule`: day-of-week windows, blackout rules, effective date ranges, buffer minutes. Rooms with no rules default to always available.
  - Booking lifecycle `PENDING → APPROVED / REJECTED / CANCELED`, recording reviewer and timestamp, retaining `canceledAt` rather than deleting.
  - **Conflict detection is correct**: `startTime < newEnd AND endTime > newStart` — the proper interval-overlap predicate, not the naive containment check. Counts PENDING as conflicting, supports `excludeBookingId`, and the schema has a matching `[roomId, startTime, endTime]` index.
- **What is missing:**
  - **Admin room creation UI.** The "Add Room" button has no `onClick`; `api.rooms.create` exists and is never called. A developer TODO is also rendered into the user-facing page (`admin/rooms/page.tsx:105`).
  - **Calendar sync is never invoked** from the booking flow, and `Room.googleCalendarId` / `googleTokens` are never populated — there is no per-room OAuth connection flow.
  - **No booking emails of any kind.** `EmailService` works (D-007) and SpaceOS never calls it.
  - **No reschedule endpoint.** Only approve/reject/cancel. `checkConflicts` already accepts `excludeBookingId` for exactly this and it is unused.
  - **`hourlyRate` is stored and never charged** — no Stripe path for paid room hire. Same shape as pay-what-you-can before OPS-03b.
  - **Never exercised against production** (OPS-09). Availability-rule validation in particular has timezone and HH:mm parsing that has never run.
- **Open question for Charley before building sync:** the schema puts `googleCalendarId` and OAuth tokens on the **Room**, so each room connects its own calendar. That suits a co-op where different spaces have different stewards, but means an OAuth flow per room. Confirm before building.
- **Supersedes:** none

### D-018 — `DATABASE_URL` must carry a connection limit, or production falls over

- **Date:** 2026-08-11
- **Status:** Active
- **Area:** Database, Hosting, Reliability
- **Decision:** Every `DATABASE_URL` for this project must include an explicit `connection_limit`. **Production: `connection_limit=1&pool_timeout=20`. Local development: `connection_limit=5&pool_timeout=20`.**
- **What happened:** a routine application-code deploy on 2026-08-10 took the production API down. Every request returned a Prisma error: `FATAL: (EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15`. The site's frontend stayed up while the entire API 502'd.
- **Cause:** Prisma opens a connection pool **per process**, defaulting to `cpus × 2 + 1`. In serverless that means a pool *per warm Lambda container*, and Supabase's session pooler caps the project at **15 connections total**. A few warm containers exhaust it. A deploy is the worst moment, because new containers start while the old ones are still holding their connections.
- **Why the two values differ:** production is a fleet of short-lived Lambda containers, so each must hold exactly **one** connection — that allows ~15 concurrent containers instead of ~3. Local development is a single long-lived server, where `connection_limit=1` would serialize every query; **5** gives it room while staying well inside the cap. Local logs showed Prisma opening **17** connections against a 15-connection pooler, so a single developer could exhaust dev on their own.
- **This interacts with D-010 and D-014.** D-010 requires the **session** pooler (port 5432) because the direct host is IPv6-only and Netlify is IPv4-only. D-014 requires session mode because Prisma interactive transactions don't work over PgBouncer in transaction mode. So switching to the transaction pooler (6543), which would have far more headroom, is **not** an available fix — it would break Stripe webhook processing. The connection limit is the fix.
- **Latent, not introduced.** This misconfiguration existed from DEP-01 onward and would have fired on the first real traffic spike, or the first time two members used the site simultaneously. It only surfaced because a deploy forced container churn. Nothing in the deployed code changed to cause it.
- **Where it lives:** the value is a Netlify environment variable, so it is invisible to anyone reading this repository and trivially lost in a future edit. That is exactly why it is recorded here alongside D-010's other non-obvious environment requirements.
- **Supersedes:** none (extends D-010)

---

### D-017 — Org logos go in Supabase Storage, not a pasted URL

- **Date:** 2026-08-10
- **Status:** Active — **not yet implemented**
- **Area:** Frontend, Backend, Infrastructure
- **Decision (Charley's, 2026-08-10):** Co-op logos are uploaded to **Supabase Storage**. Rejected: a plain `logoUrl` text field, which is ten minutes of work but pushes image hosting onto every co-op — unreasonable for organizations that mostly aren't technical, and it breaks the moment someone's hosting lapses.
- **Nothing exists yet.** No `@supabase/supabase-js` dependency, no multipart/`FileInterceptor` handling anywhere in the API, no storage bucket, and no `SUPABASE_*` environment variables — the only Supabase config present is the Postgres connection string. `Organization.logoUrl` exists in the schema and nothing has ever written to it.
- **Required before implementation:**
  - A **public** bucket (suggested name `org-logos`) in both the dev and prod Supabase projects. Public is right here: logos render on unauthenticated join pages, so signed URLs would add expiry handling for no benefit.
  - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set for both environments. **The service role key bypasses Row Level Security and grants full database and storage access** — it is more dangerous than the Stripe key and must be a Netlify *secret* value, never committed, never pasted into chat.
- **Planned shape:** upload keyed `org-logos/<orgId>/<uuid>.<ext>`, overwriting nothing so a failed upload can't destroy the current logo; server-side validation of MIME type and size (images only, small cap) rather than trusting the client; `Organization.logoUrl` updated only after the upload succeeds.
- **Supersedes:** none (this is `OPS-03c`)

---

### D-016 — Changing a tier price: grandfather by default, opt in to raise

- **Date:** 2026-08-10
- **Status:** Active
- **Area:** Billing, Product, Admin UX
- **Background:** `updateTier` wrote the new amount to the database and never told Stripe. Stripe Prices are **immutable**, so there was no path by which an admin could change what a member is charged — MaybeOS would show $20 while Stripe billed $15 forever, to existing *and* new members. Fixed in OPS-03b: repricing creates a replacement Price on the same Product, deactivates the old one (never deletes — historical invoices and grandfathered subscriptions must keep resolving), and repoints the tier.
- **Decision (Charley's, 2026-08-10):** When a price change affects tiers with **active subscriptions**, the admin sees an option, **checked by default, to keep existing members at their current price**. Unchecking it raises them to the new price.
  - Default (checked) → `applyToExistingMembers: false`. Only new sign-ups pay the new amount.
  - Unchecked → `applyToExistingMembers: true`. Everyone moves **at their next renewal**, using `proration_behavior: 'none'` so nobody is charged mid-cycle for a change they didn't initiate.
- **The option only appears when it means something.** With no active subscribers there is no decision to make and the question shouldn't be asked. `GET /orgs/:orgId/tiers/manage` returns `activeSubscribers` per tier for exactly this.
- **Why that endpoint is separate:** `GET /orgs/:orgId/tiers` is **public and unauthenticated** so the join page can render. Adding subscriber counts there would publish every co-op's per-tier membership numbers to anyone. The admin variant is guarded (`JwtAuthGuard`, `RolesGuard`, ADMIN) and additionally returns deactivated tiers, which admins need and the public must not see.
- **Pay-what-you-can tiers are exempt** from repricing entirely — their Price is built per member at checkout from the amount that member chose, so there is no shared Price to replace. Editing `minPrice` affects future checkouts only.
- **Repricing invalidates the org's Billing Portal configuration** (`Organization.stripePortalConfigId` is cleared), because the configuration pins specific price ids and would otherwise keep offering the Price just archived. It rebuilds on the next portal visit.
- **The update response reports what happened to people's money** — `repriced`, `migratedSubscribers`, `grandfathered` — so the admin UI can say "12 members move to the new price at their next renewal" instead of "Saved".
- **Supersedes:** none (extends D-015)

---

### D-015 — Plan changes go through the Stripe Billing Portal, never through checkout

- **Date:** 2026-08-10
- **Status:** Active
- **Area:** Billing, Product
- **Decision (Charley's, 2026-08-10):** A **member** changing tier, updating a card, or cancelling is forced through the **member billing portal**. An **organization** changing its MaybeOS plan is forced through the **admin billing portal**. Checkout is only ever for *starting* a subscription.
- **Why it matters:** checkout always creates a *new* subscription. Observed in sandbox testing before this rule existed — one member ended up with concurrent $12 and $18 subscriptions and would have been billed for both every month. The portal instead modifies the existing subscription and prorates the difference.
- **Enforced server-side, not just in the UI.** `createCheckoutSession` throws `409 Conflict` when the member's `stripeSubscriptionId` is set and their status is ACTIVE, TRIALING, or PAST_DUE. Hiding the button would leave the API open. PAST_DUE deliberately counts — a lapsed member needs to fix a card, which is a portal action. CANCELED and NONE do not, so those members can check out again.
- **The portal must be configured or the rule is unenforceable.** Stripe's default Billing Portal permits card updates and cancellation but **not plan switching** — that only appears when the configuration is given an explicit product list. Forcing members to the portal without configuring it would leave them with no way to change tier at all. `ensurePortalConfiguration` creates one **per org** (the product list is that org's own tiers; one shared configuration would show every co-op's tiers to every member) and caches the id on `Organization.stripePortalConfigId`.
- **Pay-what-you-can tiers are excluded from portal switching.** Their price is created per member at checkout via inline `price_data`, so there is no shared Price for the portal to offer. A member moving *to* a PWYC tier must cancel and check out again. Verified: 3 of 4 seeded tiers are switchable, PWYC correctly omitted.
- **Not yet built for organizations.** MaybeOS's own Free/Plus/Unlimited plans (D-013) don't exist yet and need Connect first. This rule applies to them when they are built: the admin billing portal, same enforcement, same reasoning.
- **Also fixed here:** `createBillingPortalSession` returned `{ error }` with HTTP 200 when no billing account existed, which our own API client would have read as success and redirected to `undefined`. It now throws 404.
- **Supersedes:** none (extends D-013)

---

### D-013 — MaybeOS pricing model, and what it forces architecturally

- **Date:** 2026-08-10
- **Status:** Active
- **Area:** Billing, Product, Licensing
- **Decision (Charley's pricing, recorded verbatim in intent):**
  - **Self-host:** free under **Apache License 2.0**. The website offers a **gift** option for anyone wanting to sustain MaybeOS. MaybeItsFate LCA is a **for-profit**, so gifts are **not tax deductible** and must never be described as such.
  - **MaybeOS Free:** $0/mo, **+$0.55 per transaction**.
  - **MaybeOS Plus:** **$100 one-time initiation fee**; **$3.65 per user per year**, billed monthly, **minimum 10 users**; **+$0.30 per transaction**. Accounts must be **archived (frozen) or deleted** by an admin to stop counting.
  - **MaybeOS Unlimited:** **$299/mo billed annually** or **$349/mo billed monthly**; unlimited members; **+$0.10 per transaction**.
- **Proration semantics (Charley's call, 2026-08-10):** an account **registered at any time during the month counts as a full user for that month** — no reduction for joining late or being archived mid-month. Bill peak headcount, proration disabled. Chosen over day-based proration (fairer but harder to explain) and invoice-date snapshot (gameable by archiving the day before billing).
- **This forces Stripe Connect.** Every tier takes a per-transaction fee, and taking a cut of another party's charge *is* `application_fee_amount`, which only exists under Connect. There is no version of this that works by routing other co-ops' dues through MaybeOS's own Stripe account — that is money transmission, not billing. **Connect is therefore a hard prerequisite for SCL-02 (self-serve signup)**, not a Stage 2 nicety. It does *not* block this month's launch: MaybeItsFate is tenant #1 and owes itself no fee.
- **Two separate billing systems.** Co-op → member dues (today's `StripeService`) and MaybeOS → co-op platform fees are different Stripe accounts, products, webhooks, and failure modes. Platform billing belongs in its own module, not bolted onto `StripeService`.
- **Implementation notes that are easy to get wrong:**
  - $3.65/user/year billed monthly is **$0.30416666…**, not a whole number of cents. Use `unit_amount_decimal`; `unit_amount: 30` loses money and `31` overcharges.
  - Free / Plus / Unlimited are distinct plans, so **three separate Products**. Unlimited's monthly and annual prices are two **Prices on one Product** — the legitimate "billing variant" case.
  - `UserOrg` has **no archived state today**. Plus billing cannot be implemented until one exists; `subscriptionStatus` is about dues, not account lifecycle.
- **Supersedes:** none

---

### D-014 — Stripe webhooks: claim and dispatch in one transaction

- **Date:** 2026-08-10
- **Status:** Active
- **Area:** Backend, Billing, Reliability
- **Decision:** `handleWebhook` creates the `WebhookEvent` row and runs the event handler inside a single Prisma interactive transaction. The row's primary key (the Stripe event id) is both the idempotency record and the lock. A `P2002` means another delivery won the race and is treated as success; any other error propagates so the endpoint answers non-2xx and Stripe retries.
- **What was wrong before:** (1) idempotency was a `findUnique` followed later by a `create`, which two concurrent deliveries could both pass; (2) a throwing handler was logged, swallowed, and the event still recorded as processed with a 200 response — so Stripe never retried and a member could pay while their membership was silently never activated. A unit test asserted this second behavior as correct; it has been inverted.
- **The controller no longer catches.** It previously turned every failure into a 400, which both misreported a database error as a malformed Stripe request and prevented `GlobalExceptionFilter` from reporting the 5xx to Sentry.
- **Constraint:** requires a **session-mode** database connection. Prisma interactive transactions do not work over PgBouncer in transaction mode. `DATABASE_URL` is deliberately the Supabase session pooler (5432) per D-010 — moving it to 6543 would break webhook processing.
- **Supersedes:** none

---

### D-012 — Source maps: upload widened beyond the plugin default, and never served publicly

- **Date:** 2026-08-10
- **Status:** Active
- **Area:** Frontend, Observability, Security
- **Decision:** Upload browser source maps to Sentry from the Netlify build, gated on all three of `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` being present. Set `widenClientFileUpload: true` and `deleteSourcemapsAfterUpload: true`.
- **Why `widenClientFileUpload` is load-bearing, not a nicety:** `@sentry/nextjs` defaults to uploading maps for `.next/static/chunks/app/**` and `chunks/pages/**` only. But `lib/api.ts` and `lib/auth-store.ts` are shared across routes, so webpack emits them into the **top-level numbered chunks** (`107-*.js`, `509-*.js`, …), which those globs miss entirely. Those are precisely the files that raise the errors D-011 instruments. **Confirmed in production:** a real `ApiNetworkError` reported stack frames in `chunks/107-*.js` and `chunks/509-*.js` — without this option that trace would have been unreadable. Do not remove it to shorten build times without checking what lands in the shared chunks first.
- **Why `deleteSourcemapsAfterUpload`:** otherwise `.map` files ship in the deploy and are served publicly next to the bundle, letting anyone reconstruct the full unminified source. Verified: every deployed chunk's `.map` returns 404 while debug IDs remain present in the JS, which is what lets Sentry match a trace to its uploaded map.
- **Alternatives rejected:** *Gating on the auth token alone* — rejected: two of three variables set looks configured and silently uploads nothing, so the build now warns loudly and names the missing variable. *Failing the build when credentials are absent* — rejected: maybeos.org deploys from this config on every push, and readable stack traces are not worth taking the site down for.
- **`SENTRY_AUTH_TOKEN` is stored as a Netlify secret value** (Charley's choice, on Netlify's recommendation — correct). Consequences to remember: its value cannot be read back via the UI or API, so it can only be replaced, not inspected; it is scrubbed from build logs; and Netlify's secrets scanning will fail a build if the value ever appears in deploy output. Its scopes are `builds,functions,runtime` — `builds` is the one that matters.
- **Supersedes:** none (extends D-011)

---

### D-011 — Frontend error tracking via @sentry/nextjs, with URL scrubbing as a hard requirement

- **Date:** 2026-08-10
- **Status:** Active
- **Area:** Frontend, Security, Observability
- **Decision:** Adopt `@sentry/nextjs` (pinned to 8.55.2, matching `@sentry/nestjs` in the API) for browser, SSR, and edge/middleware error reporting. Reporting is gated on `NEXT_PUBLIC_SENTRY_DSN`; with no DSN the SDK is never initialized. Two **separate** Sentry projects are used — one for the API, one for the web app.
- **Alternatives rejected:**
  - *A lightweight hand-rolled `window.onerror` reporter* — rejected: it misses React render errors entirely (Next.js catches those itself, so they never reach `window.onerror`), and misses SSR and middleware failures.
  - *Sentry Session Replay* — rejected: it records the DOM of a member-management app (names, emails, addresses, payment status) and ships it to a third party. That is a decision for the co-op to make knowingly, not a default enabled for our debugging convenience.
  - *Dropping `browserTracingIntegration` to save bundle weight* — rejected after measuring: it saves only 2 kB, because the SDK bundles the tracing code either way. Keeping it buys distributed tracing that links a browser error to the API request that caused it.
- **Rationale:** The failure this exists to catch is the silent one — a form that does nothing, a page that renders blank — which produces no server log at all. Anything less than a real SDK misses the most common shape of it.
- **Non-negotiable constraint — URL scrubbing:** Two live routes carry a working bearer credential in the URL: `/magic-link?token=…` and `/invite?token=…`. Sentry attaches the current page URL to every event and to navigation and fetch breadcrumbs, so without redaction an error on either page would ship a usable login credential to a third-party dashboard — and an expired or already-consumed token is *precisely* what makes those pages throw. `sentry.shared.ts` redacts sensitive query parameters from event URLs, query strings, and breadcrumbs before anything leaves the browser. **Verified** by grepping raw captured payloads for the secret: zero occurrences. Do not remove this, and extend `SENSITIVE_QUERY_KEYS` when adding any route that accepts a credential in a query parameter.
- **Noise-filtering trap to preserve:** `ignoreErrors` filters the bare browser strings for a failed fetch (`Failed to fetch`, `Load failed`, …) because they flood a project with users switching tabs and losing wifi. But "the API is unreachable" is exactly the failure we care about, and it produces the *same* message. `ApiClient` therefore re-wraps network failures as `ApiNetworkError` with a message shaped `API unreachable: POST /auth/login`, which matches nothing in the ignore list. **Never add a generic `/fetch/i` pattern to `ignoreErrors`** — it would silently swallow that signal and leave error tracking looking healthy while reporting nothing.
- **Cost:** First Load JS shared across all routes goes from 102 kB to 175 kB (+73 kB uncompressed), and the edge middleware bundle from 32.7 kB to 91.8 kB. This is essentially fixed regardless of configuration.
- **Behavior change beyond telemetry:** `auth-store.loadProfile` previously had a bare `catch {}` that discarded the session on *any* failure. A 500 or a dropped connection silently signed the user out and was indistinguishable from a normal logout. It now ends the session only on a genuine 401/403 and reports anything else.
- **Supersedes:** none (extends D-005 and the API-side work in OPS-06)

---

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
