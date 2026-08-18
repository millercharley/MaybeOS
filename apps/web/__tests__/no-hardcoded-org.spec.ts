import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * No page may name a specific co-op.
 *
 * On 2026-08-18 a member signed in to maybeos.org, followed the events link
 * from their own dashboard, and was told `Organization with slug "sunrise" not
 * found`. Two public pages called the API with the literal string `'sunrise'`
 * — an org that exists only in the dev database — so neither had ever been
 * capable of working in production, and both were reachable from four places
 * including the member dashboard and the RSVPs list.
 *
 * The bug is not that the slug was wrong. It is that a page in a multi-tenant
 * product named a tenant at all: MaybeOS serves many co-ops, so an org
 * identifier is always something a page is *given* — by its route, by the
 * signed-in member's selected org, or by the hostname — never something it
 * knows. A literal is a single-tenant assumption surviving into a
 * multi-tenant app, and it fails silently in exactly the environment nobody
 * is testing in.
 *
 * Cheap to enforce, which is the point: this would have failed on the commit
 * that introduced it rather than months later in front of the first real
 * member. Verified against the real offenders — both are caught by
 * LITERAL_ORG_ARG, and the current tree is clean.
 */
describe('no page hardcodes an organization', () => {
  const WEB_ROOT = join(__dirname, '..');
  const ROOTS = ['app', 'components', 'lib'];

  /**
   * Every org-scoped call in `lib/api.ts` takes the organization first —
   * `orgId` or a slug. So a *string literal* in that position is a named
   * tenant. A literal in any later position (an event slug, a status) is
   * fine and deliberately not matched.
   */
  const LITERAL_ORG_ARG = /api\.[A-Za-z]+\.[A-Za-z]+\(\s*['"`]/;

  /** A pasted org id is the same mistake wearing a uuid. */
  const LITERAL_UUID =
    /['"][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}['"]/i;

  const sourceFiles = (dir: string): string[] => {
    let out: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next' || entry === '__tests__') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        out = out.concat(sourceFiles(full));
      } else if (/\.tsx?$/.test(entry) && !/\.spec\.tsx?$/.test(entry)) {
        out.push(full);
      }
    }
    return out;
  };

  const offences = (pattern: RegExp) => {
    const found: string[] = [];
    for (const root of ROOTS) {
      for (const file of sourceFiles(join(WEB_ROOT, root))) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (pattern.test(line)) {
              found.push(`${relative(WEB_ROOT, file)}:${i + 1}  ${line.trim()}`);
            }
          });
      }
    }
    return found;
  };

  it('passes no organization to the API as a string literal', () => {
    // Failure here means a page decided which co-op it is about. Take the
    // identifier from the route, the selected org, or the hostname instead.
    expect(offences(LITERAL_ORG_ARG)).toEqual([]);
  });

  it('contains no pasted organization uuid', () => {
    expect(offences(LITERAL_UUID)).toEqual([]);
  });

  it('would have caught the pages that caused this', () => {
    // Guards the guard. A regex that quietly stops matching anything is a
    // test that passes forever while enforcing nothing, so the two lines
    // actually deleted on 2026-08-18 are pinned here as known-bad samples.
    expect(LITERAL_ORG_ARG.test("    () => api.events.listPublicBySlug('sunrise'),")).toBe(true);
    expect(LITERAL_ORG_ARG.test("    () => api.events.getPublicBySlug('sunrise', slug),")).toBe(true);

    // And does not fire on the shapes that are correct, so it cannot be
    // "fixed" by weakening it until everything passes.
    expect(LITERAL_ORG_ARG.test('  api.events.listPublicBySlug(orgSlug),')).toBe(false);
    expect(LITERAL_ORG_ARG.test('  api.events.getPublicBySlug(orgSlug, "autumn-fair"),')).toBe(false);
    expect(LITERAL_UUID.test('  const orgId = useAuthStore((s) => s.currentOrgId);')).toBe(false);
  });
});
