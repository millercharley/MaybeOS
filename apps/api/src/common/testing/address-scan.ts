/**
 * Where an email address in this repo's source is allowed to live (OPS-38).
 *
 * Twice now a real member's address has been committed. Both times it was in
 * a comment, written to explain a bug that member had hit, and both times the
 * sweep meant to remove it did not:
 *
 *   - The AUTH-07 migration quoted both spellings of the address that caused
 *     the duplicate-account bug. It was left out of the first sweep on
 *     purpose, because editing an applied migration means rewriting its
 *     `_prisma_migrations` checksum by hand — and then not come back to.
 *   - `email-address.ts` and its spec were swept, but only the domains were.
 *     The local part kept the member's name, so an address at `example.net`
 *     passed a scrub whose own stated rule is that no name in this repo
 *     belongs to a real person. One fixture still carried the full real name
 *     at a real provider.
 *
 * Both are the same mistake: a person reading for addresses among six hundred
 * of them, twice. Hence a test.
 *
 * **This scan reads comments.** Every other source scan here blanks them
 * first, because these files explain the rules they keep and a scan that
 * matches its own prose proves nothing — that is what `stripComments` is for.
 * This one is the exception, and the history above is the reason: the
 * comments are where the leaks were. Stripping them would make this test pass
 * on both of the commits it exists to prevent.
 *
 * **It guards addresses, not names.** A name is not decidable from source:
 * `Ruth` is a fixture here and also somebody's first name. Names stay a
 * judgement call, checked against the member table when they are written. An
 * address has a domain, and a domain can be ruled on.
 */

/**
 * Reserved for documentation and never deliverable (RFC 2606). Subdomains
 * count, so a connection string at `db.example.com` is fine.
 */
export const DOCUMENTATION_DOMAINS = ['example.com', 'example.org', 'example.net'];

/** Reserved suffixes (RFC 2606, RFC 6761). `ruth@forum.example` reaches nobody. */
export const DOCUMENTATION_SUFFIXES = ['.example', '.test', '.invalid', '.localhost'];

/**
 * Ours. Role addresses — `noreply@`, `hello@`, `support@` — and the co-op's
 * own contact address, which is published on the privacy and terms pages. A
 * member's address is never at one of these; members sign up with their own.
 */
export const OUR_DOMAINS = [
  'maybeos.org',
  'maybeos.app',
  'maybeitsfate.com',
  'maybeitsfate.community',
  'maybe-its-fate.com',
  'mail.maybeitsfate.com',
];

/**
 * Minimal placeholders that predate this rule: `a@b.com`, `c@d.com`. None is
 * an address anybody could have pasted out of the member table, and for some
 * of them the shape is the point — `from-header.spec.ts` wants the shortest
 * legal address there is.
 *
 * Deliberately a list and not a pattern. A two-letter domain is not safer for
 * being short; these are safe because somebody looked at each one. Adding to
 * this list should feel like a decision.
 */
export const FIXTURE_PLACEHOLDERS = [
  'a.org',
  'b.co',
  'b.com',
  'b.org',
  'c.com',
  'd.com',
  'other.org',
  'x.co',
  'x.org',
  'flex.com',
  'neighbor.com',
  'sunrise.coop',
];

/**
 * Not addresses at all: a Google Calendar id has the same shape as one. These
 * are the co-op's own calendars, and a calendar id is not a mailbox.
 */
export const CALENDAR_ID_SUFFIXES = [
  'group.calendar.google.com',
  'group.v.calendar.google.com',
];

export interface FoundAddress {
  address: string;
  domain: string;
  /** Repo-relative, so a failure names a path somebody can open. */
  file: string;
  line: number;
}

/** `example.com` itself, or anything under it — but never `notexample.com`. */
const isAtOrUnder = (domain: string, allowed: string) =>
  domain === allowed || domain.endsWith(`.${allowed}`);

export function isAllowedDomain(domain: string): boolean {
  const d = domain.toLowerCase();

  if (CALENDAR_ID_SUFFIXES.some((suffix) => isAtOrUnder(d, suffix))) return true;
  if (DOCUMENTATION_SUFFIXES.some((suffix) => d.endsWith(suffix))) return true;
  if (DOCUMENTATION_DOMAINS.some((allowed) => isAtOrUnder(d, allowed))) return true;
  if (OUR_DOMAINS.some((allowed) => isAtOrUnder(d, allowed))) return true;
  if (FIXTURE_PLACEHOLDERS.includes(d)) return true;

  return false;
}

/*
  Deliberately loose about the local part. Missing an address that should have
  been flagged is the failure that matters here; flagging a string that only
  looks like an address costs somebody a minute.
*/
const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Every address-shaped string in `source`, comments included. */
export function addressesIn(source: string, file = ''): FoundAddress[] {
  const found: FoundAddress[] = [];

  source.split('\n').forEach((text, index) => {
    for (const address of text.match(ADDRESS) ?? []) {
      found.push({
        address,
        domain: address.slice(address.lastIndexOf('@') + 1),
        file,
        line: index + 1,
      });
    }
  });

  return found;
}

/*
  The spec file is the one exemption, and it needs to be: its fixtures are
  addresses at the providers this rule refuses, which is what they are for.

  Written as `['Member@', 'bellsouth.net'].join('')` they would pass with no
  exemption at all — but teaching a file to hide addresses from a scan, that
  file in particular, is a worse habit than naming the exception out loud.

  It is a list of exact paths rather than a prefix on purpose. An exemption
  that covered a directory would quietly cover every file added to it later,
  and the first version of this rule escaped a mutation that did exactly
  that.
*/
export const EXEMPT_FILES = ['apps/api/src/common/__tests__/no-real-addresses.spec.ts'];

/**
 * The addresses that break the rule.
 *
 * The exemption lives in here with the rule rather than in the sweep, so that
 * widening it is a change to a function with tests on it.
 */
export function offendersIn(found: FoundAddress[]): FoundAddress[] {
  return found.filter(
    (f) => !EXEMPT_FILES.includes(f.file) && !isAllowedDomain(f.domain),
  );
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.sql', '.prisma'];
const SKIP_DIRECTORIES = ['node_modules', 'dist', '.next', '.git', 'coverage'];

/** Every source file under `root`, recursively. */
export function sourceFiles(root: string): string[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readdirSync } = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join, extname } = require('node:path') as typeof import('node:path');

  const out: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.includes(entry.name)) walk(join(directory, entry.name));
      } else if (SOURCE_EXTENSIONS.includes(extname(entry.name))) {
        out.push(join(directory, entry.name));
      }
    }
  };
  walk(root);

  return out;
}
