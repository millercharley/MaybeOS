/**
 * Whether the database has the migrations this code was built against
 * (OPS-42).
 *
 * Nothing checked, and it cost five days of broken checkout. `d842b5d` added
 * `Organization.currency` to the Prisma schema on 6 November along with its
 * migration; the migration ran against the development database and never
 * against production. Netlify deploys do not run migrations — they are
 * applied by hand through the Supabase connector — so the code shipped
 * expecting a column that was not there.
 *
 * Every query that touched an organisation then failed, which is most of
 * them: 43 ticket checkouts, 42 public event pages, the membership embed,
 * `OrgService.findById`. Charley found it by pressing Buy ticket and getting
 * "Internal server error"; Sentry had been saying `The column
 * organizations.currency does not exist` since 23:56 on the 6th.
 *
 * The failure mode is what makes this worth a scheduled check rather than a
 * comment in a runbook: a missing migration does not break the deploy, or the
 * health check, or anything an organiser clicks on the day it ships. It
 * breaks whichever page first reads the new column, as a 500, to a member.
 *
 * **Missing is the dangerous direction.** The code is ahead of the database,
 * which is the shape of every outage this prevents. Unknown — the database
 * holding something the repo does not — is worth saying out loud but is not
 * an emergency: it usually means a migration was applied by hand and the file
 * has not been committed yet, and the code is not relying on it.
 */

/**
 * Applied names that are not repo migrations and never will be.
 *
 * Supabase writes a baseline row when a project is first linked. It describes
 * the schema the repo's chain starts from, so it has no directory and its
 * absence from the repo is not drift.
 */
export const BASELINE_MIGRATIONS = ['0_init'];

export interface Drift {
  /** In the repo, not in the database. The code is ahead of the schema. */
  missing: string[];
  /** In the database, not in the repo. Applied by hand, or uncommitted. */
  unknown: string[];
}

export function migrationDrift(expected: string[], applied: string[]): Drift {
  const inDatabase = new Set(applied);
  const inRepo = new Set(expected);

  return {
    missing: [...inRepo].filter((name) => !inDatabase.has(name)).sort(),
    unknown: [...inDatabase]
      .filter((name) => !inRepo.has(name) && !BASELINE_MIGRATIONS.includes(name))
      .sort(),
  };
}

export const isClean = (drift: Drift): boolean =>
  drift.missing.length === 0 && drift.unknown.length === 0;

/**
 * What to say about it, in the terms somebody acting on it needs.
 *
 * Names every migration rather than counting them: the fix is to apply a
 * specific file, and a message saying "1 migration missing" sends whoever
 * reads it back to the database to find out which.
 */
export function describeDrift(drift: Drift): string {
  const parts: string[] = [];

  if (drift.missing.length > 0) {
    parts.push(
      `${drift.missing.length} migration${drift.missing.length === 1 ? '' : 's'} ` +
        `in the repository ${drift.missing.length === 1 ? 'has' : 'have'} not been ` +
        `applied to this database: ${drift.missing.join(', ')}. ` +
        'The code is running against a schema older than it was built for, and ' +
        'every query touching the new columns will fail.',
    );
  }

  if (drift.unknown.length > 0) {
    parts.push(
      `${drift.unknown.length} migration${drift.unknown.length === 1 ? '' : 's'} ` +
        `applied to this database ${drift.unknown.length === 1 ? 'is' : 'are'} not in ` +
        `the repository: ${drift.unknown.join(', ')}. ` +
        'Probably applied by hand and not yet committed.',
    );
  }

  return parts.join(' ');
}
