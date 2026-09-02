import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { EventsModule } from '../events/events.module';
import { StripeModule } from '../stripe/stripe.module';
import { CalendarModule } from '../calendar/calendar.module';
import { StorageModule } from '../storage/storage.module';
import { SpaceService } from './space.service';
import { SpaceController } from './space.controller';

@Module({
  imports: [EmailModule, EventsModule, StripeModule, CalendarModule, StorageModule],
  controllers: [SpaceController],
  providers: [SpaceService],
  exports: [SpaceService],
})
export class SpaceModule {}
