import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { stripComments } from '../testing/source-scan';
import {
  COUNTED_MEMBER_ROLES,
  activeMemberWhere,
  countedMemberWhere,
  countsAsMember,
} from '../counted-members';

/**
 * One answer to "how many members" (MEM-27).
 *
 * The card said two counts disagreed. There were five spellings of the same
 * intent and one real bug: `impact.service.ts` counted `{ where: { orgId } }`
 * twice, with no role filter, so a guest counted as a member in published
 * impact reports and in the denominator of every survey response rate —
 * and nowhere else in the product.
 *
 * Latent at MaybeItsFate, which has no guests, and wrong from the first one
 * added. Nobody decided guests should count there; somebody wrote the
 * shorter query and it read fine.
 */
describe('who counts as a member', () => {
  it('is admins, staff and members', () => {
    expect([...COUNTED_MEMBER_ROLES]).toEqual(['ADMIN', 'STAFF', 'MEMBER']);
  });

  it('is not a guest', () => {
    expect(countsAsMember('GUEST')).toBe(false);
  });

  it('counts the three', () => {
    for (const role of ['ADMIN', 'STAFF', 'MEMBER']) {
      expect(countsAsMember(role)).toBe(true);
    }
  });

  it('reads an absent role as a plain member', () => {
    // What an unspecified membership has always meant here.
    expect(countsAsMember(null)).toBe(true);
    expect(countsAsMember(undefined)).toBe(true);
  });

  it('does not count something that is not a role at all', () => {
    expect(countsAsMember('BANANA')).toBe(false);
    expect(countsAsMember('')).toBe(false);
  });
});

describe('the two questions, kept apart', () => {
  it('counts members of one co-op', () => {
    expect(countedMemberWhere('org-1')).toEqual({
      orgId: 'org-1',
      role: { in: ['ADMIN', 'STAFF', 'MEMBER'] },
    });
  });

  it('drops a cancelled membership when the number is public', () => {
    // A former member is not a member, and counting them inflates the one
    // number a stranger uses to judge whether a place is alive.
    expect(activeMemberWhere('org-1')).toEqual({
      orgId: 'org-1',
      role: { in: ['ADMIN', 'STAFF', 'MEMBER'] },
      subscriptionStatus: { not: 'CANCELED' },
    });
  });

  it('keeps somebody who never had a subscription', () => {
    // `not: 'CANCELED'` matches null, so a co-op where nobody pays still
    // has members. `equals: null` or a positive list would have emptied it.
    expect(activeMemberWhere('org-1').subscriptionStatus).toEqual({ not: 'CANCELED' });
  });
});

/**
 * Nobody writes a sixth spelling.
 *
 * This is the guard the fix exists for. Four correct copies of a value are
 * four chances for a fifth to be written differently, and that is exactly
 * what happened. A count of a co-op's members has to go through the shared
 * `where`, so "did you remember the role filter?" stops being a question
 * anyone has to get right.
 */
describe('every member count goes through one place', () => {
  const API = join(__dirname, '..', '..');
  const SKIP = ['node_modules', 'dist', '__tests__'];

  const sources = (() => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!SKIP.includes(entry.name)) walk(join(dir, entry.name));
        } else if (extname(entry.name) === '.ts') {
          out.push(relative(API, join(dir, entry.name)));
        }
      }
    };
    walk(API);
    return out.sort();
  })();

  /** The file that is allowed to say what the roles are. */
  const HOME = 'common/counted-members.ts';

  it('spells the role list in exactly one file', () => {
    const offenders = sources.filter((file) => {
      if (file === HOME) return false;
      const code = stripComments(readFileSync(join(API, file), 'utf8'));
      return /\[\s*'ADMIN'\s*,\s*'STAFF'\s*,\s*'MEMBER'\s*\]/.test(code);
    });

    expect(offenders).toEqual([]);
  });

  it('never counts a co-op’s memberships without saying which roles', () => {
    /*
      `userOrg.count({ where: { orgId } })` with nothing else — the impact
      bug exactly. Written as a pattern rather than a list of known sites,
      because the point is the one nobody has written yet.

      `platform.service.ts` counts every membership on the platform with no
      orgId at all, which is a different question and does not match.
    */
    const offenders = sources.filter((file) => {
      if (file === HOME) return false;
      const code = stripComments(readFileSync(join(API, file), 'utf8'));
      return /userOrg\.count\(\{\s*where:\s*\{\s*orgId\s*\}\s*\}\)/.test(code);
    });

    expect(offenders).toEqual([]);
  });

  it('still has the impact report asking the shared question', () => {
    // The two lines the card was actually about.
    const impact = stripComments(
      readFileSync(join(API, 'modules/impact/impact.service.ts'), 'utf8'),
    );

    expect(impact.match(/countedMemberWhere\(orgId\)/g) ?? []).toHaveLength(2);
  });
});
