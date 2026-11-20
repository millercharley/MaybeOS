import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from './helpers/source-scan';

const read = (...p: string[]) =>
  stripComments(readFileSync(join(__dirname, '..', ...p), 'utf8'));

/**
 * The chrome asks once, not four times (OPS-47).
 *
 * OPS-46 took the member dashboard from sixteen requests to six and left five
 * of those six alone, because they are not the dashboard's — they belong to
 * the shell every signed-in page renders, and are therefore paid on every
 * page rather than one.
 *
 * Four of the five were org-scoped and fired together from four providers
 * mounted side by side, each with its own effect on the same two values. In
 * production `/api/*` is same-origin, so four requests are four Netlify
 * Function invocations on Micro compute, per page, per member.
 *
 * `auth/profile` is the fifth and stays: it establishes *which* co-op, so it
 * cannot live inside a route scoped to one. Five to two.
 */
describe('the app shell asks once', () => {
  const layout = read('app', '(app)', 'layout.tsx');
  const shellCtx = read('contexts', 'shell-context.tsx');

  it('mounts the bundle above the providers that read from it', () => {
    expect(layout).toMatch(/<ShellProvider>/);

    // Order matters: a consumer can only seed itself from a provider above it.
    const shellAt = layout.indexOf('<ShellProvider>');
    const unreadAt = layout.indexOf('<UnreadProvider>');
    const onboardingAt = layout.indexOf('<OnboardingProvider>');
    expect(shellAt).toBeGreaterThan(-1);
    expect(shellAt).toBeLessThan(unreadAt);
    expect(shellAt).toBeLessThan(onboardingAt);
  });

  it('asks the bundle, not the four routes', () => {
    expect(shellCtx).toMatch(/api\.orgs\.shell\(orgId, token\)/);
  });

  /*
    Each of the four keeps its own context and its own public shape — nothing
    in the product changed call site. What changed is where the first answer
    comes from. These assertions are about that first answer only.
  */
  describe('each consumer seeds itself from the bundle', () => {
    it.each([
      ['the unread badge', ['contexts', 'unread-context.tsx'], /shell\?\.unread/],
      ['the checklist', ['contexts', 'onboarding-context.tsx'], /shell\?\.onboarding/],
      ['the sidebar links', ['components', 'layout', 'org-links.tsx'], /shell\?\.links/],
      ['the reading gate', ['components', 'belonging', 'required-reading-gate.tsx'], /shell\?\.reading/],
    ])('%s', (_label, path, pattern) => {
      const src = read(...(path as string[]));
      expect(src).toMatch(/useShell\(\)/);
      expect(src).toMatch(pattern as RegExp);
    });
  });

  /*
    The one genuinely live thing in the chrome. CMN-29 cut it from 417 polls
    in ninety minutes to a backing-off timer that stops for a hidden tab, and
    none of that may be traded away for one request saved at mount.
  */
  describe('the unread poll survives intact', () => {
    const unread = read('contexts', 'unread-context.tsx');

    it('still backs off and still stops for a hidden tab', () => {
      expect(unread).toMatch(/nextPollDelay\(/);
      expect(unread).toMatch(/visibilitychange/);
      expect(unread).toMatch(/document\.visibilityState !== 'hidden'/);
    });

    it('still asks for itself when the bundle has no answer for this co-op', () => {
      // The fallback is what makes the seed an optimisation rather than a
      // dependency: a failed bundle must not leave the badge permanently blank.
      expect(unread).toMatch(/void load\(\)\.then\(\(first\) => \{/);
    });

    it('waits for the bundle rather than racing it', () => {
      // Without this the provider makes the very request the bundle exists to
      // remove, and is then seeded a moment later having asked twice.
      expect(unread).toMatch(/if \(!shellReady\) return;/);
    });
  });

  /*
    Seeding from another co-op's bundle would show the wrong badge; in the
    reading gate it would redirect somebody to a handbook they do not owe.
    Every consumer compares the org the bundle belongs to.
  */
  it('never seeds a consumer from another co-op’s bundle', () => {
    for (const path of [
      ['contexts', 'unread-context.tsx'],
      ['contexts', 'onboarding-context.tsx'],
      ['components', 'layout', 'org-links.tsx'],
      ['components', 'belonging', 'required-reading-gate.tsx'],
    ]) {
      expect(read(...path)).toMatch(/shellOrgId/);
    }
  });

  it('carries every section the API says it sends', () => {
    /*
      Read across the workspace boundary on purpose. The API's section list is
      the contract; a section added there and forgotten here is a field that
      silently never reaches the chrome.
    */
    const api = readFileSync(
      join(__dirname, '..', '..', 'api', 'src', 'modules', 'shell', 'app-shell.ts'),
      'utf8',
    );
    const declared = api
      .slice(api.indexOf('export const SHELL_SECTIONS'))
      .match(/\[([^\]]*)\]/)![1]
      .match(/'([a-z]+)'/g)!
      .map((s) => s.replace(/'/g, ''));

    const web = readFileSync(join(__dirname, '..', 'lib', 'api.ts'), 'utf8');
    const body = web.match(/export interface AppShell \{([^}]*)\}/)!;
    const fields = [...body[1].matchAll(/^\s{2}([A-Za-z]+):/gm)].map((m) => m[1]);

    expect(fields.sort()).toEqual([...declared].sort());
  });
});
