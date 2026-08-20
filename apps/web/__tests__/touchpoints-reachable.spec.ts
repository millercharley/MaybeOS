import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Every touchpoint is actually rendered somewhere (IMP-19).
 *
 * `TouchpointAsk` was built, tested and shipped — and then had **zero
 * importers in the entire web app**. It rendered on the post-checkout screen
 * that lived on `/events/[slug]`, the page deleted in OPS-22 for naming a dev
 * org. The confirmation screen was rebuilt elsewhere and the question was not
 * carried across, so IMP-15 read as shipped for two days while asking nobody
 * anything.
 *
 * Nothing failed. That is the whole problem: an unrendered ask looks exactly
 * like a member inside their fatigue window, which is the *correct* and
 * common outcome. There is no error, no empty state and no log line — the
 * feature simply stops existing, and the first evidence would be an empty
 * report a year later.
 *
 * So the wiring is asserted rather than trusted. This is cheap, and it fails
 * on the commit that deletes a page rather than at the end of a collection
 * year.
 */
describe('every touchpoint has somewhere to render', () => {
  const WEB_ROOT = join(__dirname, '..');
  const ROOTS = ['app', 'components'];
  const COMPONENT = join('components', 'impact', 'touchpoint-ask.tsx');

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx|ts)$/.test(entry)) files.push(full);
    }
  };
  for (const root of ROOTS) walk(join(WEB_ROOT, root));

  /** Files that render the ask, excluding the component's own definition. */
  const renderers = files.filter(
    (f) =>
      relative(WEB_ROOT, f) !== COMPONENT &&
      /<TouchpointAsk\b/.test(readFileSync(f, 'utf8')),
  );

  it('is rendered by at least one page', () => {
    expect(renderers.length).toBeGreaterThan(0);
  });

  it.each(['TICKET_PURCHASE', 'BOOKING', 'POST_EVENT', 'COMMONS'])(
    'renders the %s touchpoint somewhere',
    (touchpoint) => {
      const found = renderers.filter((f) =>
        new RegExp(`touchpoint=["']${touchpoint}["']`).test(readFileSync(f, 'utf8')),
      );

      // Thrown rather than asserted so the message names the touchpoint:
      // "some touchpoint is missing" is not something anybody can act on.
      if (found.length === 0) {
        throw new Error(
          `No page renders <TouchpointAsk touchpoint="${touchpoint}" />. ` +
            `A touchpoint nobody renders collects nothing, silently.`,
        );
      }
      expect(found.length).toBeGreaterThan(0);
    },
  );

  it('passes an org it was given rather than one it assumed', () => {
    for (const file of renderers) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/<TouchpointAsk[^>]*orgId=\{([^}]+)\}/g)) {
        // The budget is per membership. A literal here would spend the wrong
        // co-op's, which is the multi-tenant bug OPS-22 was about.
        expect(match[1]).not.toMatch(/^['"]/);
      }
    }
  });
});
