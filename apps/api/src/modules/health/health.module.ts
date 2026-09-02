import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './prisma.health';
import { EmailHealthIndicator } from './email.health';
import { StorageHealthIndicator } from './storage.health';
import { CalendarHealthIndicator } from './calendar.health';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [
    PrismaHealthIndicator,
    EmailHealthIndicator,
    StorageHealthIndicator,
    CalendarHealthIndicator,
  ],
})
export class HealthModule {}
