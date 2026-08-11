# Sub-OS audit brief

One agent per sub-OS. Each verifies its module is **efficient, intuitive, on brand,
and fully functional** across the happy path, then reports findings as roadmap items.

## Why this exists

Roughly a dozen defects were found on 2026-08-10/11. Almost every one was code that
existed and was **never called** — Stripe provisioning, `@SkipThrottle()`, pay-what-
you-can, the entire Google Calendar service, the "Add Room" button, the public join
button. Reading the implementation missed all of them. Running the path caught them.

**So: no audit finding counts unless the path was executed.** "I read the service and
it looks correct" is what produced this list in the first place.

## Hard constraints

- The API (`:3001`) and web app (`:3020`) are **single shared resources**. Agents run
  **sequentially**, or in isolated worktrees with assigned ports.
- Use the **dev** database only (`xuinggqdewoxiejkacio`). Never point local work at
  production. `db:seed` deletes every row and is guarded (D-010, SEC-02).
- Clean up test data. Reset any org flags toggled during testing.
- Never commit credentials. `.env` is gitignored; keep it that way.

## What each agent does

1. **Read first:** `project-os/STATE.md`, then `DECISIONS.md` (D-001–D-020).
2. **Boot** the API and web app, log in against seeded data
   (`maya@sunrise.coop` admin / `alex@example.com` member, password `password123`).
3. **Walk the happy path** in the browser for its sub-OS — admin side and member side.
4. **For every interactive control, confirm something actually happens.** Dead
   buttons with no handler are this codebase's signature defect.
5. **Check on-brand:** MaybeOS design tokens in `styles/globals.css`, not raw Tailwind
   greys. Several older pages still use `text-gray-900` and `bg-gray-50`.
6. **Check honesty:** does the UI claim anything the backend doesn't do? A "$20" label
   on a $19.50 tier and a "Pay what you can" badge with no PWYC charging were both real.
7. **Report** findings as roadmap rows: ID, one-line title, what breaks, how it was
   observed. Prefix by tool (`ORG` `MEM` `EVT` `SPC` `CMN` `IMP`).

## Per-agent scope

| Agent | Surface |
|---|---|
| Organization | org settings, branding, slug, locations, `/orgs/[slug]` public page |
| Members | tiers, dues, invitations, join flow, member directory, billing |
| Events | events admin, public feed, RSVP, `/events`, calendar feeds |
| Space | rooms, availability rules, bookings, approvals, `/member/bookings` |
| Community | channels, posts, threading, pinning, DMs, wiki, proposals, ⌘K |
| Impact | surveys, metrics, dashboard |

## Known-weak areas to probe hardest

- **Impact and Events have never been exercised at all** (OPS-09). Assume nothing works.
- `/member/rsvps` and `/member/profile` are linked from the member dashboard and 404.
- Older admin pages predate the rebrand and use raw Tailwind greys.
- Timezone handling: booking emails send raw UTC (SPC-08); no org timezone exists.
- `apps/web` has **no test harness at all** (OPS-10), so nothing here is regression-proofed.

## Definition of done for an audit

- Every happy-path step executed in a real browser against a real API.
- Every finding reproducible, with the observation stated (not inferred).
- Findings added to the roadmap with IDs.
- No test data or toggled flags left behind.
