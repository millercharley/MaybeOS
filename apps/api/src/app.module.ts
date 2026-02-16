import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './config/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { OrgModule } from './modules/org/org.module';
import { MemberModule } from './modules/member/member.module';
import { EventsModule } from './modules/events/events.module';
import { SpaceModule } from './modules/space/space.module';
import { CommonsModule } from './modules/commons/commons.module';
import { ImpactModule } from './modules/impact/impact.module';
import { StripeModule } from './modules/stripe/stripe.module';
import { EmailModule } from './modules/email/email.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    PrismaModule,
    AuthModule,
    OrgModule,
    MemberModule,
    EventsModule,
    SpaceModule,
    CommonsModule,
    ImpactModule,
    StripeModule,
    EmailModule,
    CalendarModule,
  ],
})
export class AppModule {}
