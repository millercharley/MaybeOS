import { Module } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { CommonsModule } from '../commons/commons.module';
import { ImpactModule } from '../impact/impact.module';
import { BelongingModule } from '../belonging/belonging.module';
import { ServiceModule } from '../service/service.module';
import { DoorModule } from '../door/door.module';
import { StripeModule } from '../stripe/stripe.module';
import { RadarModule } from '../radar/radar.module';
import { RecapModule } from '../recap/recap.module';
import { CalendarModule } from '../calendar/calendar.module';
import { TicketPassModule } from '../events/ticket-pass.module';
import { SchedulerService } from './scheduler.service';
import { MigrationDriftService } from '../health/migration-drift.service';

/**
 * Deliberately has no controller. Scheduled work is reached through the
 * Netlify Scheduled Function (`apps/api/src/scheduled.ts`), not over HTTP —
 * an endpoint that runs due work would be an unauthenticated way for anyone
 * to close every open proposal in the system.
 */
@Module({
  imports: [
    CommonsModule,
    ImpactModule,
    BelongingModule,
    ServiceModule,
    DoorModule,
    StripeModule,
    RadarModule,
    RecapModule,
    // Keeping the imported calendars true, unattended (CAL-13).
    CalendarModule,
    // The safety net under ticket confirmations (EVT-46): whatever the
    // webhook could not send, this sweeps up.
    TicketPassModule,
  ],
  // Not the whole HealthModule: this needs the one service, and importing
  // a module of health indicators into the scheduler would couple them.
  providers: [PrismaService, SchedulerService, MigrationDriftService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
