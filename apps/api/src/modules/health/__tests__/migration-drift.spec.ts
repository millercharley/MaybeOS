import {
  BASELINE_MIGRATIONS,
  describeDrift,
  isClean,
  migrationDrift,
} from '../migration-drift';

/**
 * Whether the database has the migrations this code was built against
 * (OPS-42).
 *
 * `20261106120000_org_currency` was committed on 6 November and applied to
 * the development database only. Production ran for five days against a
 * schema without `organizations.currency`, failing every query that touched
 * an organisation — 43 ticket checkouts among them.
 */

describe('what counts as drift', () => {
  it('finds nothing when the two agree', () => {
    const drift = migrationDrift(['a', 'b'], ['a', 'b']);

    expect(drift).toEqual({ missing: [], unknown: [] });
    expect(isClean(drift)).toBe(true);
  });

  it('names a migration the database has not had — the outage', () => {
    const drift = migrationDrift(
      ['20261103130000_spc37', '20261106120000_org_currency'],
      ['20261103130000_spc37'],
    );

    expect(drift.missing).toEqual(['20261106120000_org_currency']);
    expect(isClean(drift)).toBe(false);
  });

  it('names one the repository does not have', () => {
    // Usually a migration applied by hand and not yet committed.
    expect(migrationDrift(['a'], ['a', 'b']).unknown).toEqual(['b']);
  });

  it('ignores the Supabase baseline, which has no file and never will', () => {
    const drift = migrationDrift(['a'], ['0_init', 'a']);

    expect(drift.unknown).toEqual([]);
    expect(isClean(drift)).toBe(true);
    expect(BASELINE_MIGRATIONS).toContain('0_init');
  });

  it('does not mistake the baseline for something missing', () => {
    expect(migrationDrift([], ['0_init']).missing).toEqual([]);
  });

  it('reports both directions at once', () => {
    const drift = migrationDrift(['a', 'b'], ['a', 'c']);

    expect(drift).toEqual({ missing: ['b'], unknown: ['c'] });
  });

  it('sorts, so the same drift reads the same way twice', () => {
    expect(migrationDrift(['z', 'm', 'a'], []).missing).toEqual(['a', 'm', 'z']);
  });

  it('is not confused by duplicates on either side', () => {
    // A `_prisma_migrations` table can hold two rows for one name; a repo
    // cannot, but the rule should not care.
    expect(migrationDrift(['a'], ['a', 'a'])).toEqual({ missing: [], unknown: [] });
  });

  it('calls an empty database entirely behind', () => {
    expect(migrationDrift(['a', 'b'], []).missing).toEqual(['a', 'b']);
  });
});

describe('what it says about it', () => {
  it('names the migration, not a count', () => {
    /*
      The fix is to apply a specific file. "1 migration missing" sends
      whoever reads it back to the database to find out which one.
    */
    const text = describeDrift(migrationDrift(['a', 'org_currency'], ['a']));

    expect(text).toContain('org_currency');
  });

  it('says what it means, so the reader does not have to know', () => {
    const text = describeDrift(migrationDrift(['a'], []));

    expect(text).toMatch(/schema older than it was built for/);
    expect(text).toMatch(/every query touching the new columns will fail/);
  });

  it('agrees with itself about singular and plural', () => {
    expect(describeDrift(migrationDrift(['a'], []))).toMatch(/1 migration in the repository has/);
    expect(describeDrift(migrationDrift(['a', 'b'], []))).toMatch(
      /2 migrations in the repository have/,
    );
  });

  it('describes the harmless direction more calmly', () => {
    const text = describeDrift(migrationDrift([], ['b']));

    expect(text).toMatch(/not in the repository/);
    expect(text).not.toMatch(/will fail/);
  });

  it('says both when both are true', () => {
    const text = describeDrift(migrationDrift(['a'], ['b']));

    expect(text).toContain('a');
    expect(text).toContain('b');
  });

  it('says nothing when there is nothing to say', () => {
    expect(describeDrift(migrationDrift(['a'], ['a']))).toBe('');
  });
});
