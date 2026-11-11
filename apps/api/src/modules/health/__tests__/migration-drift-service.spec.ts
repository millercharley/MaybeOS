import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MigrationDriftService } from '../migration-drift.service';

/*
  Only `existsSync` is mocked, and only where a test says so: the rest of the
  suite reads the repository's real migrations on purpose, because a fixture
  would not notice the directory moving.
*/
jest.mock('node:fs', () => {
  const real = jest.requireActual('node:fs');
  return { ...real, existsSync: jest.fn(real.existsSync) };
});

beforeEach(() => {
  const fs = jest.requireMock('node:fs') as { existsSync: jest.Mock };
  const real = jest.requireActual('node:fs') as { existsSync: (p: string) => boolean };
  fs.existsSync.mockImplementation(real.existsSync);
});

/**
 * Reading both sides of the migration question (OPS-42).
 *
 * The rule is tested in `migration-drift.spec.ts`. This is about the part
 * that has to find the files and the rows — and in particular about what
 * happens when it cannot.
 */

const REPO = join(__dirname, '..', '..', '..', '..', '..', '..');

const build = (rows: { migration_name: string }[] = []) => {
  const prisma = { $queryRaw: jest.fn().mockResolvedValue(rows) };
  return { service: new MigrationDriftService(prisma as never), prisma };
};

describe('reading the repository side', () => {
  it('finds the real migrations directory from here', async () => {
    const { service } = build();

    // Not a fixture: if the layout moves, this test is how we find out.
    expect(service.expected().length).toBeGreaterThan(80);
  });

  it('matches what is actually on disk', () => {
    const { service } = build();
    const onDisk = readdirSync(join(REPO, 'apps', 'api', 'prisma', 'migrations'), {
      withFileTypes: true,
    })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    expect(service.expected().sort()).toEqual(onDisk.sort());
  });

  it('counts directories, not the lock file or the readme', () => {
    const { service } = build();

    expect(service.expected()).not.toContain('migration_lock.toml');
    expect(service.expected()).not.toContain('README.md');
  });
});

describe('reading the database side', () => {
  it('ignores a migration that was rolled back', async () => {
    const { service, prisma } = build([{ migration_name: 'a' }]);

    await service.applied();

    const sql = prisma.$queryRaw.mock.calls[0][0].join('?');
    expect(sql).toMatch(/rolled_back_at IS NULL/);
    expect(sql).toMatch(/_prisma_migrations/);
  });
});

describe('what it does when it cannot answer', () => {
  it('throws rather than reporting nothing missing', async () => {
    /*
      The property that matters most. An unreadable directory yields an
      empty list, and an empty list compares equal to "nothing missing" —
      so the check would go quietly green forever, which is worse than no
      check: it is a reason to stop looking.
    */
    const { service } = build();
    jest.spyOn(service as never, 'migrationsDirectory').mockImplementation(() => {
      throw new Error('Cannot find the migrations directory');
    });

    await expect(service.check()).rejects.toThrow(/Cannot find the migrations directory/);
  });

  it('says where it looked, and what probably broke', () => {
    // Every candidate forced to miss, so the message is actually produced
    // rather than asserted conditionally.
    const fs = jest.requireMock('node:fs') as { existsSync: jest.Mock };
    fs.existsSync.mockReturnValue(false);

    const { service } = build();

    expect(() => service.expected()).toThrow(/Looked in:/);
    expect(() => service.expected()).toThrow(/included_files/);
    expect(() => service.expected()).toThrow(/migration drift cannot be checked/);
  });
});

describe('the whole check', () => {
  it('is clean when the database has everything', async () => {
    const { service } = build();
    const rows = service.expected().map((migration_name) => ({ migration_name }));
    const { service: ready } = build(rows);

    expect(await ready.check()).toEqual({ missing: [], unknown: [] });
  });

  it('names the one that is missing', async () => {
    const { service } = build();
    const all = service.expected();
    const rows = all.slice(0, -1).map((migration_name) => ({ migration_name }));
    const { service: behind } = build(rows);

    const drift = await behind.check();
    expect(drift.missing).toEqual([all[all.length - 1]]);
  });

  it('forgives the Supabase baseline', async () => {
    const { service } = build();
    const rows = [
      { migration_name: '0_init' },
      ...service.expected().map((migration_name) => ({ migration_name })),
    ];
    const { service: live } = build(rows);

    expect(await live.check()).toEqual({ missing: [], unknown: [] });
  });
});

describe('the bundle it depends on', () => {
  it('ships the migrations to the function that reads them', () => {
    /*
      The check reads a directory at runtime, and the Netlify function only
      contains what `included_files` names. Without this entry the check
      would throw on every run — loudly, by design, but it should not have
      to.
    */
    const toml = readFileSync(join(REPO, 'netlify.toml'), 'utf8');

    expect(toml).toMatch(/apps\/api\/prisma\/migrations\/\*\*/);
  });
});
