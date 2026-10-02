import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Radar's three surfaces are actually rendered somewhere (RDR-01).
 *
 * Written for the same reason as `touchpoints-reachable`, and against a
 * failure Radar is unusually exposed to: **every one of these components
 * renders nothing most of the time, on purpose.** The interest prompt is
 * silent unless a member is due a question; the interests editor is silent
 * unless the co-op has a list; the settings panel only exists on Plus. A
 * component that was never mounted looks exactly like all three of those.
 *
 * Nothing would fail. The digest would simply go out matching on interests
 * nobody was ever asked for, and the first evidence would be a co-op saying
 * the emails are no good.
 */
describe('Radar is wired to something', () => {
  const WEB_ROOT = join(__dirname, '..');
  const files: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx|ts)$/.test(entry)) files.push(full);
    }
  };
  for (const root of ['app', 'components']) walk(join(WEB_ROOT, root));

  const renderersOf = (tag: string, definition: string) =>
    files.filter(
      (file) =>
        relative(WEB_ROOT, file) !== definition &&
        new RegExp(`<${tag}\\b`).test(readFileSync(file, 'utf8')),
    );

  it.each([
    ['InterestPrompt', join('components', 'member', 'interest-prompt.tsx')],
    ['MyInterests', join('components', 'member', 'my-interests.tsx')],
    ['Radar', join('components', 'settings', 'radar.tsx')],
  ])('%s is rendered by a page', (tag, definition) => {
    const renderers = renderersOf(tag, definition);

    if (renderers.length === 0) {
      throw new Error(
        `Nothing renders <${tag} />. Every Radar component renders nothing when ` +
          `it has nothing to say, so an unmounted one is invisible rather than broken.`,
      );
    }
    expect(renderers.length).toBeGreaterThan(0);
  });

  it('gives the member a way back to their interests from the digest', () => {
    // The email's "change your interests" link lands on this anchor. A
    // renamed section id breaks the link silently, in email already sent.
    const editor = readFileSync(
      join(WEB_ROOT, 'components', 'member', 'my-interests.tsx'),
      'utf8',
    );

    expect(editor).toMatch(/id="interests"/);
  });
});
