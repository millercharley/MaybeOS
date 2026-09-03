import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * A structural guard against the bug this codebase keeps producing.
 *
 * Four separate fixes have now applied the same patch by hand — SPC-02,
 * IMP-01, CMN-07 (twenty methods) and SEC-04 (fifteen more across EventOS,
 * SpaceOS and Calendar). Every one had the same shape: a route under
 * `orgs/:orgId`, a guard that proves only that the caller belongs to the org
 * *named in the URL*, and a service that then resolves the entity by its id
 * alone. Each was found by somebody happening to look.
 *
 * This test is the "happening to look" part, automated. It fails when a
 * tenant-owned record is fetched by bare `id`, and points at the scoped
 * alternative.
 *
 * It is a lint rule in spirit. It lives in the test suite because
 * `npm run lint` has never worked in this repo — eslint is not installed —
 * and the jest suite is the quality gate that actually runs.
 *
 * Deliberately not proof: a `where` built in a variable, or a raw query,
 * slips past. It catches the specific mistake that has been made four times.
 */

// Models owned by an organization, directly or through a parent. Fetching one
// of these by id alone is what the bug looks like. Models NOT listed here are
// either global (User, Organization) or reached only through a scoped parent.
const TENANT_OWNED = [
  'event',
  'rsvp',
  'attendance',
  'room',
  'booking',
  'availabilityRule',
  'channel',
  'post',
  'comment',
  'reaction',
  'proposal',
  'vote',
  'collection',
  'collectionPage',
  'survey',
  'surveyResponse',
  'membershipTier',
  'invitation',
  'location',
  'duty',
  'dutyClaim',
  'dutyAdoption',
  'hostDuty',
  'hostBriefing',
];

const ALLOW_COMMENT = 'tenant-scoping-exempt';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      out.push(...sourceFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('tenant scoping', () => {
  const root = join(__dirname, '..', '..');
  const files = sourceFiles(root);

  it('has source files to inspect', () => {
    // Guards against the whole test silently passing because the walk broke.
    expect(files.length).toBeGreaterThan(20);
  });

  it('never fetches a tenant-owned record by bare id', () => {
    const models = TENANT_OWNED.join('|');
    // `prisma.<model>.findUnique(` followed, within the call, by a `where`
    // whose first key is `id`. Composite keys (`orgId_slug`, `userId_orgId`,
    // `eventId_userId`) do not match, and are the correct way to do this.
    const pattern = new RegExp(
      String.raw`prisma\.(${models})\.findUnique\(\s*\{[^}]*?where:\s*\{\s*id\s*:`,
      'gs',
    );

    const violations: string[] = [];

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const lines = src.split('\n');

      for (const match of src.matchAll(pattern)) {
        const line = src.slice(0, match.index).split('\n').length;
        // An explicit, reviewed exemption on the preceding line.
        const preceding = lines.slice(Math.max(0, line - 3), line).join('\n');
        if (preceding.includes(ALLOW_COMMENT)) continue;

        violations.push(
          `${file.replace(root, 'src')}:${line}  ${match[0].replace(/\s+/g, ' ').slice(0, 80)}`,
        );
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Tenant-owned records fetched by bare id:\n\n  ${violations.join('\n  ')}\n\n` +
          `A route under orgs/:orgId proves only that the caller belongs to the org they\n` +
          `named in the URL — the caller writes the URL. Resolve the record through its org\n` +
          `instead, and raise NotFound (not Forbidden) when it belongs to another:\n\n` +
          `    this.prisma.post.findFirst({ where: { id: postId, channel: { orgId } } })\n\n` +
          `See findSurveyInOrg / findProposalInOrg / findEventInOrg / findRoomInOrg for the\n` +
          `established pattern. If a lookup is genuinely global, put a\n` +
          `"${ALLOW_COMMENT}: <reason>" comment on the line above it.`,
      );
    }
  });
});
