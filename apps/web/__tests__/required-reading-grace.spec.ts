import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Remind first, and meet them at the door after (BEL-07).
 *
 * Charley: "make this really easy for them by just reminding them to review
 * these documents within 30 days instead of forcing them out of creating the
 * event or booking their room. Allow them to proceed with their booking or
 * reservation. After 30 days, force them to the Handbook after login."
 *
 * Then, while this was being built: "I noticed a member who migrated (an
 * existing member) was blocked from posting an event because they hadn't
 * reviewed the required articles." They were not alone — 402 of
 * MaybeItsFate's 439 members were refused every write, their shared window
 * having closed on the same morning.
 */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const read = (...p: string[]) => strip(readFileSync(join(__dirname, '..', ...p), 'utf8'));

const gate = read('components', 'belonging', 'required-reading-gate.tsx');
const shell = read('app', '(app)', 'layout.tsx');

describe('the handbook gate', () => {
  it('sends somebody there only once their window has closed', () => {
    // `blocking` is what is past grace; `inGrace` is what is merely owed,
    // and that one gets a banner rather than a redirect.
    expect(gate).toMatch(/outstanding\.blocking\.length === 0\) return;/);
    expect(gate).toMatch(/router\.replace\(`\/portal\/\$\{orgSlug\}\/handbook\/start`\)/);
  });

  it('does not trap them on the handbook itself', () => {
    // Reading is never gated, and redirecting the handbook to the handbook
    // is a loop.
    expect(gate).toMatch(/const onHandbook = pathname\.includes\('\/handbook'\)/);
    expect(gate).toMatch(/onHandbook \|\| sent\) return;/);
  });

  it('redirects once, not on every render', () => {
    expect(gate).toMatch(/setSent\(true\)/);
  });

  it('leaves them where they are if the check fails', () => {
    // A network blip must not strand somebody on a page they asked for.
    expect(gate).toMatch(/\.catch\(\(\) => \{\}\)/);
  });

  it('covers the pages the refusals were actually happening on', () => {
    /*
      The banner lives in the portal shell and reads `usePortal()`, which only
      loads an org under `/portal`. Events and bookings are under `/member`,
      so the one surface where members were being refused had no banner at
      all. The gate goes in the app shell, which is every signed-in page.
    */
    expect(shell).toMatch(/<RequiredReadingGate/);

    const banner = readFileSync(
      join(__dirname, '..', 'components', 'belonging', 'required-reading-banner.tsx'),
      'utf8',
    );
    expect(banner).toMatch(/usePortal\(\)/);
    expect(gate).not.toMatch(/usePortal/);
  });
});
