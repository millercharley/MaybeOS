import { Module } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { ForumService } from './forum.service';

/**
 * Its own module, and that is the whole point of it.
 *
 * `ForumService` is needed by `OrgModule` (to auto-join a founder) and by
 * `PlatformModule` (to create the forum) — and `OrgModule` already imports
 * `PlatformModule`. Putting the service in `OrgModule` and importing that
 * from `PlatformModule` closed a ring, which Nest only reports at boot: every
 * endpoint answers 500, not just the forum ones.
 *
 * A module depending on nothing but Prisma cannot be part of a cycle.
 */
@Module({
  providers: [PrismaService, ForumService],
  exports: [ForumService],
})
export class ForumModule {}
