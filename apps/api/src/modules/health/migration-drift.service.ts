import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaService } from '../../config/prisma.service';
import { describeDrift, isClean, migrationDrift, type Drift } from './migration-drift';

/**
 * Reads both sides of the question "does this database have the migrations
 * this code was built against?" (OPS-42).
 *
 * The rule itself is in `migration-drift.ts`; this is the part that has to
 * find the files and the rows.
 *
 * **It fails rather than reporting clean.** If the migration directory cannot
 * be found — which is exactly what happens if a bundler stops shipping it —
 * an empty list would compare equal to nothing missing and the check would go
 * quietly green forever. A check that cannot answer has to say so, or it is
 * worse than no check: it is a reason to stop looking.
 */
@Injectable()
export class MigrationDriftService {
  private readonly logger = new Logger(MigrationDriftService.name);

  constructor(private readonly prisma: PrismaService) {}

  /*
    Where the migrations are, depending on who is running.

    `/var/task/apps/api/prisma/migrations` on Netlify, because
    `included_files` preserves the path from the repository root; the second
    is `npm run start` from `apps/api`; the third is the monorepo root. Tried
    in order, and none found is an error rather than an empty answer.
  */
  private migrationsDirectory(): string {
    const candidates = [
      join(process.cwd(), 'apps', 'api', 'prisma', 'migrations'),
      join(process.cwd(), 'prisma', 'migrations'),
      resolve(__dirname, '..', '..', '..', 'prisma', 'migrations'),
    ];

    const found = candidates.find((path) => existsSync(path));
    if (!found) {
      throw new Error(
        'Cannot find the migrations directory, so migration drift cannot be ' +
          `checked. Looked in: ${candidates.join(', ')}. On Netlify this means ` +
          'the `included_files` entry for apps/api/prisma/migrations has been ' +
          'dropped from netlify.toml.',
      );
    }

    return found;
  }

  /** The migrations in the repository, by directory name. */
  expected(): string[] {
    return readdirSync(this.migrationsDirectory(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  }

  /** The migrations this database says it has run. */
  async applied(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM "_prisma_migrations" WHERE rolled_back_at IS NULL
    `;

    return rows.map((row) => row.migration_name);
  }

  async check(): Promise<Drift> {
    const [expected, applied] = [this.expected(), await this.applied()];
    const drift = migrationDrift(expected, applied);

    if (isClean(drift)) {
      this.logger.log(`Migration check: ${expected.length} migrations, database in step`);
    } else {
      // `error`, not `warn`: the missing direction means members are seeing
      // 500s right now, and this is the line somebody greps for.
      this.logger.error(`Migration drift: ${describeDrift(drift)}`);
    }

    return drift;
  }
}
