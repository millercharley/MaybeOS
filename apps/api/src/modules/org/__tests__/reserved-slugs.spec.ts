import * as fs from 'fs';
import * as path from 'path';
import { RESERVED_ORG_SLUGS } from '../reserved-slugs';

/**
 * The API's reserved-slug list must match the shared one (SCL-02).
 *
 * An org's slug is also its subdomain (SCL-01). Two lists decide what a co-op
 * may call itself: this one, which refuses the name at creation, and
 * `apps/web/lib/tenant-host.ts`, which refuses to route it. If they drift, a
 * co-op can register a name the router will not resolve — an account the
 * product breaks at the moment it creates it, silently.
 *
 * The API keeps a copy rather than importing the shared package because its
 * build cannot reach outside `src/`. This test is the price of that copy: it
 * reads the canonical file off disk and fails the moment the two disagree.
 */
describe('reserved org slugs', () => {
  const sharedPath = path.resolve(
    __dirname,
    '../../../../../../packages/shared/src/constants.ts',
  );

  it('has a canonical file to compare against', () => {
    // If this fails the shared package moved, and the guard below is checking
    // nothing — which is worse than having no guard, because it looks green.
    expect(fs.existsSync(sharedPath)).toBe(true);
  });

  it('matches the canonical list exactly', () => {
    const source = fs.readFileSync(sharedPath, 'utf8');
    const block = source.match(
      /export const RESERVED_ORG_SLUGS = \[([\s\S]*?)\] as const;/,
    );

    expect(block).not.toBeNull();

    const shared = [...(block as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map(
      (m) => m[1],
    );

    expect([...RESERVED_ORG_SLUGS].sort()).toEqual([...shared].sort());
  });

  it('reserves the subdomains the platform actually uses', () => {
    // These are the ones with a concrete consequence today: the router treats
    // them as platform hostnames, so an org holding one is unreachable.
    for (const slug of ['www', 'api', 'app', 'admin', 'staging', 'preview']) {
      expect(RESERVED_ORG_SLUGS).toContain(slug);
    }
  });

  it('is lowercase and slug-shaped, matching what CreateOrgDto accepts', () => {
    // A reserved entry that could never be submitted reserves nothing.
    for (const slug of RESERVED_ORG_SLUGS) {
      expect(slug).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
