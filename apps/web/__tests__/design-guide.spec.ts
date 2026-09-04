import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * The design guide, enforced (UI-02).
 *
 * `project-os/DESIGN.md` is the prose; this is the part that fails a build.
 * It exists because the guide's own rules were already written down informally
 * and there were still **seventeen different page headings** — "Events" in the
 * display serif and "Member Directory" in bold sans, one page apart. A rule
 * nothing checks is a preference.
 *
 * Deliberately structural rather than visual: it cannot tell whether a screen
 * looks right, only whether it was built from the shared pieces. That is the
 * class of drift that actually happened.
 */

/**
 * Screens that are not pages *in the shell*: they centre a card in an empty
 * viewport, so they have no 1280 column to fill and no breadcrumb above them.
 * DESIGN.md §1 names this exemption.
 */
/**
 * Public pages a member actually navigates to — a co-op's own page, the
 * calendar, the legal pages. They live outside the app shell but they are
 * *pages*, and the whole point of UI-02 is that "Enter Member Portal" must not
 * change the typeface. Found on production: they were Archivo at 36, 48 and
 * 64px while every app page was Young Serif at 36.
 *
 * The landing page is the one exception in this group: it is a marketing hero,
 * already set in the display serif, and its size is part of that design.
 */
const PUBLIC_PAGES_WITH_TITLES = [
  'app/(public)/calendar/page.tsx',
  'app/(public)/orgs/[slug]/page.tsx',
];

const OUTSIDE_THE_SHELL = [
  'app/(auth)/',
  'app/(public)/',
  'app/page.tsx',
  'app/error.tsx',
  'app/global-error.tsx',
  'app/invite/',
  'app/join/',
  'app/billing/thanks/',
  'app/buddy/',
];

/**
 * Pages whose title is a piece of data — an event, a report, a person, a
 * co-op — rendered inside a larger hero or a two-column head. They use the
 * heading *style* directly, and the test checks that they do.
 */
const DATA_TITLED = [
  'app/(app)/(dashboard)/admin/[orgSlug]/impact/reports/page.tsx',
  'app/(app)/(dashboard)/admin/[orgSlug]/handbook/page.tsx',
  'app/(app)/(dashboard)/member/[orgSlug]/page.tsx',
  'app/(app)/portal/[orgSlug]/page.tsx',
  'app/(app)/portal/[orgSlug]/events/[eventSlug]/page.tsx',
  'app/(app)/portal/[orgSlug]/messages/[userId]/page.tsx',
  'app/(app)/portal/[orgSlug]/reports/[reportSlug]/page.tsx',
  'app/(app)/portal/[orgSlug]/handbook/start/page.tsx',
];

const HEADING_STYLE = 'font-display text-2xl leading-tight text-ink';

const ROOT = join(__dirname, '..');

function pages(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) pages(rel, acc);
    else if (entry === 'page.tsx') acc.push(rel);
  }
  return acc;
}

const inShell = (p: string) => !OUTSIDE_THE_SHELL.some((e) => p.startsWith(e));
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('the design guide', () => {
  const all = pages('app');
  const shellPages = all.filter(inShell);

  it('has pages to inspect', () => {
    // Guards the guard: a moved directory must fail here, not silently pass
    // every rule below by finding nothing.
    expect(all.length).toBeGreaterThan(40);
    expect(shellPages.length).toBeGreaterThan(30);
  });

  describe('§2 — one page title', () => {
    it('no page writes its own heading style', () => {
      const offenders: string[] = [];

      for (const page of shellPages) {
        const src = read(page);
        for (const m of src.matchAll(/<h1 className="([^"]*)"/g)) {
          if (m[1] === HEADING_STYLE || m[1] === `mt-1 ${HEADING_STYLE}`) continue;
          offenders.push(`${page}  <h1 className="${m[1]}">`);
        }
      }

      if (offenders.length) {
        throw new Error(
          `Page titles must come from <PageHeader />, or use the exact heading style\n` +
            `when the title is a piece of data (see DATA_TITLED above):\n\n  ` +
            offenders.join('\n  ') +
            `\n\nThe style is: ${HEADING_STYLE}\nSee project-os/DESIGN.md §2.`,
        );
      }
    });

    it('public pages a member navigates to use the same heading', () => {
      // Not the landing hero, which is a different job — but a co-op's public
      // page, the calendar and the legal pages are pages, and clicking into
      // the portal must not change the typeface.
      for (const page of PUBLIC_PAGES_WITH_TITLES) {
        expect(read(page)).toContain('font-display text-2xl leading-tight text-ink');
      }
      const legal = readFileSync(
        join(ROOT, 'components/legal/legal-page.tsx'),
        'utf8',
      );
      expect(legal).toContain('font-display text-2xl leading-tight text-ink');
    });

    it('every data-titled page uses the heading style verbatim', () => {
      for (const page of DATA_TITLED) {
        expect(read(page)).toContain(HEADING_STYLE);
      }
    });

    it('uses PageHeader on the pages whose title is a fixed string', () => {
      const missing = shellPages
        .filter((p) => !DATA_TITLED.includes(p))
        .filter((p) => {
          const src = read(p);
          // A page with no title at all is a different problem; this rule is
          // only about pages that render one.
          return /<h1/.test(src) && !src.includes('PageHeader');
        });

      expect(missing).toEqual([]);
    });
  });

  describe('§1 — the 1280 column', () => {
    it('no page caps its own outer width, in any branch', () => {
      const offenders: string[] = [];

      for (const page of shellPages) {
        // Every `return (` in the file, not just the first — the first is
        // usually the loading state, so checking only that inspected a
        // spinner and passed every page regardless of its real root. Found by
        // planting a capped root and watching this rule not fire.
        for (const m of read(page).matchAll(/return \(\s*\n\s*<div className="([^"]*)"/g)) {
          if (/max-w-(?!container)/.test(m[1])) {
            offenders.push(`${page}  "${m[1]}"`);
          }
        }
      }

      if (offenders.length) {
        throw new Error(
          `A page inside the shell does not set its own width — the 1280 column is\n` +
            `the shell's job and the content fills it:\n\n  ` +
            offenders.join('\n  ') +
            `\n\nSee project-os/DESIGN.md §1.`,
        );
      }
    });

    it('nothing reaches for a width token other than the standard one', () => {
      // `max-w-7xl` is 1280 today by coincidence of Tailwind's scale. Two
      // names for one measure is how they drift apart later.
      const offenders = all.filter((p) => read(p).includes('max-w-7xl'));
      expect(offenders).toEqual([]);
    });

    it('the shell is applied by the layouts and by nothing else', () => {
      const users = all.filter((p) => read(p).includes('page-shell'));
      expect(users).toEqual([]);
    });
  });

  describe('§6 — it works on a phone', () => {
    it('every table can scroll instead of clipping', () => {
      const offenders: string[] = [];

      for (const page of all) {
        const src = read(page);
        if (!src.includes('<table')) continue;
        if (!src.includes('overflow-x-auto')) offenders.push(page);
      }

      expect(offenders).toEqual([]);
    });

    it('a row holding a title and its actions can wrap', () => {
      const offenders: string[] = [];

      for (const page of all) {
        const src = read(page);
        for (const m of src.matchAll(/className="([^"]*justify-between[^"]*)"/g)) {
          const cls = m[1];
          if (!cls.includes('flex')) continue;
          if (cls.includes('flex-wrap') || cls.includes('flex-col')) continue;
          offenders.push(`${page}  "${cls.slice(0, 60)}"`);
        }
      }

      if (offenders.length) {
        throw new Error(
          `These rows clip their own contents on a narrow screen. Add flex-wrap:\n\n  ` +
            offenders.join('\n  ') +
            `\n\nSee project-os/DESIGN.md §6.`,
        );
      }
    });
  });

  describe('§4 — colour comes from tokens', () => {
    it('no page hard-codes a hex colour in markup', () => {
      const offenders: string[] = [];

      for (const page of all) {
        for (const m of read(page).matchAll(/className="[^"]*\[#[0-9a-fA-F]{3,8}\]/g)) {
          offenders.push(`${page}  ${m[0].slice(-40)}`);
        }
      }

      expect(offenders).toEqual([]);
    });
  });
});
