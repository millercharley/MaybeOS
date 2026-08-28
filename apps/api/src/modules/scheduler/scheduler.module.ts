import { Module } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { CommonsModule } from '../commons/commons.module';
import { ImpactModule } from '../impact/impact.module';
import { BelongingModule } from '../belonging/belonging.module';
import { SchedulerService } from './scheduler.service';

/**
 * Deliberately has no controller. Scheduled work is reached through the
 * Netlify Scheduled Function (`apps/api/src/scheduled.ts`), not over HTTP —
 * an endpoint that runs due work would be an unauthenticated way for anyone
 * to close every open proposal in the system.
 */
@Module({
  imports: [CommonsModule, ImpactModule, BelongingModule],
  providers: [PrismaService, SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
