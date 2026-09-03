# DESIGN.md — The rules every page follows

**Rules for the AI:**
- Read this before building or changing any screen.
- Every rule here is enforced by `apps/web/__tests__/design-guide.spec.ts`. If you
  need to break one, the exemption goes in the test with a reason, and adding one
  should feel like a decision.
- This describes what MaybeOS *is*, not what it should be one day. When a rule and
  the code disagree, one of them is a bug — say which.

Written 2026-09-03, after Charley put two screenshots side by side: "Events" set in
the display serif and "Member Directory" in bold sans, both page titles, one page
apart. **The goal is consistency, so that as a user switches pages within MaybeOS it
feels like the same app.**

---

## 1. The page

**One shell, 1280 wide, centred.** `.page-shell` in `globals.css` is applied once by
each app shell (`app/(dashboard)/layout.tsx`, `app/portal/[orgSlug]/layout.tsx`).
A page never sets its own outer width.

- Max width is `max-w-container` — **1280px**, the single token. Not `max-w-7xl`,
  not a literal.
- Padding steps down on small screens: `px-4 py-6` up to `lg:px-8 lg:py-8`.
- **Content fills the column.** A page's root element carries no `max-w-*`. Cards,
  tables and grids run the full 1216px inside the shell's gutters.

Three things may still be narrower, and only these:

| What | Why |
|---|---|
| Overlays — modals, command palette, article reader | A dialog at 1280 is not a dialog |
| Standalone cards outside the shell — login, invite, join, error, org setup | They centre in an empty viewport; there is no column to fill |
| Prose measures — a description under a heading | A line read across 1280px is one people lose their place in |

## 2. The page title

**Every page opens with `<PageHeader />`** from `@/components/layout/page-header`.
Never a hand-written `<h1>`.

```tsx
<PageHeader
  title="Member directory"
  description="Everyone who belongs here."
  actions={<button className="btn-primary">Invite a member</button>}
/>
```

- **Display serif, `text-2xl`, `leading-tight`, `text-ink`.** This is the brand's
  masthead note and page titles are the only place the app uses it at this size.
  Everything below a page title is sans — that is what keeps it a masthead rather
  than a theme.
- The description is one line, sentence case, and says what the page is *for*.
- `actions` wrap under the title on a phone rather than clipping.

Page-level buttons may go through `actions`, or a page may lay out its own row
beside the header — both are fine and render the same, because `PageHeader`
shrinks to its content inside a flex parent. What is **not** fine is a
hand-written `<h1>`: that is the drift the audit fails on. Most pages currently
use the sibling-row shape, inherited from before this component existed.

Headings *inside* a page are sans: `h2` is `text-lg font-semibold`, `h3` is
`text-sm font-semibold`. The serif does not cascade down the page.

## 3. Type

| Role | Class |
|---|---|
| Page title | `PageHeader` (display serif, `text-2xl`) |
| Section heading | `text-lg font-semibold` |
| Sub-heading | `text-sm font-semibold` |
| Body | inherited — do not set a size |
| Secondary / help text | `text-sm text-[var(--text-secondary)]` |
| Numbers, ids, times | `.data` (monospace, tabular) |

## 4. Colour

Use the tokens, never a raw hex and never a stray palette colour.

- Text: `text-ink`, `var(--text-secondary)`, `var(--text-tertiary)`
- Surfaces: `.card`, `var(--surface)`, `var(--surface-sunken)`
- Accent: `brand-600` — the punk red, for one primary action per view
- Meaning: `.badge-success`, `.badge-warning`, `.badge-danger`, `.badge-info`,
  `.badge-neutral`. Not green/amber/red utilities chosen by hand.

Gray utilities are rebased onto the paper/ink ramp in `tailwind.config.ts`, so
`text-gray-500` is on-brand. `text-ink` is preferred where you are writing new code.

## 5. Controls

- Buttons: `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-ghost`. The press
  interaction — the hard shadow collapsing — is the brand's signature and comes free.
- Inputs: `.input`. Always with a `<label>`; placeholder is not a label.
- One `.btn-primary` per view. If two things are equally primary, neither is.

## 6. Responsive

Every page works at **375px**. Verified by measuring, not by looking.

- The sidebar is a permanent column from `lg` up and a drawer below it. Both shells
  do this; a page never renders navigation.
- Rows that hold a title and actions carry `flex-wrap`, or they clip their own
  buttons off the screen.
- Tables live in `overflow-x-auto` with a `min-w-*`, so they scroll rather than
  crush or clip.
- Multi-column layouts stack: `flex-col lg:flex-row`, and the main pane gets
  `min-w-0` so long words can shrink it.
- Nothing causes horizontal page scroll. Ever.

## 7. Empty, loading, error

Every page that loads data handles all three, and says something specific:

- **Loading** — a spinner or skeleton, never a blank page.
- **Empty** — say what would fill it and how to start. Not "No data".
- **Error** — say what failed. A silent `catch` that renders the empty state is a
  bug: "nothing here" and "we could not ask" are different, and the difference is
  the one thing the reader needs.

## 8. Words

- Sentence case for headings and buttons. Not Title Case.
- British-ish plain English, addressed to a person: "Nobody yet", "You're on this",
  "Hand it back".
- Say what a control does, not what it is: "Add it to the rota", not "Submit".
- Never blame the reader. "That date has already passed", not "Invalid date".
