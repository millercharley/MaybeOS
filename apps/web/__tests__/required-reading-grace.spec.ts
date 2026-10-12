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

  /**
   * A refusal and the gate end in the same place (BEL-08).
   *
   * The API refuses a write past the window again, as a backstop rather than
   * the experience — BEL-07 had removed it, which left the acknowledgment
   * enforced only by the app doing the sending, so the record described
   * everyone whose browser had been through the shell rather than everyone
   * taking part.
   *
   * The risk that creates is the one Charley reported in the first place: a
   * refusal with no way forward. So the refusal now routes.
   */
  describe('a refusal that gets past the gate', () => {
    const client = readFileSync(join(__dirname, '..', 'lib', 'api.ts'), 'utf8');

    it('carries the API’s reason instead of throwing it away', () => {
      // `reason` was always in the body and always discarded, so a refusal
      // that knew exactly which article was owed could only be shown as a
      // sentence.
      expect(client).toMatch(/public reason\?: string,/);
      expect(client).toMatch(/new ApiError\(response\.status, error\.message \|\| 'Request failed', error\.reason\)/);
    });

    it('announces it rather than redirecting from the API client', () => {
      // That file knows nothing about routing or which co-op is on screen.
      expect(client).toMatch(/REQUIRED_READING_EVENT/);
      expect(client).not.toMatch(/router\.(replace|push)/);
    });

    it('only for this reason, not for every 403', () => {
      // A wrong password and a missing permission are not handbook problems.
      expect(client).toMatch(/response\.status === 403 && error\.reason === 'REQUIRED_READING'/);
    });

    it('lands on the same screen the gate sends people to', () => {
      const sends = gate.match(/router\.replace\(`\/portal\/\$\{orgSlug\}\/handbook\/start`\)/g) ?? [];
      expect(sends).toHaveLength(2);
    });

    it('answers a refusal even after the arrival check has run', () => {
      /*
        Not guarded by `sent`. The arrival check is a once-per-visit
        question; a refusal is a fresh fact about right now, and somebody who
        was let through at arrival and refused later must still be taken
        there.
      */
      // Anchored at the top of the effect, not at `addEventListener`: the
      // handler is defined above that line, so slicing from it let a guard
      // on the handler itself slip past.
      const at = gate.indexOf('if (!orgSlug) return;');
      expect(at).toBeGreaterThan(-1);

      expect(gate.slice(at)).not.toMatch(/sent/);
    });
  });
});
