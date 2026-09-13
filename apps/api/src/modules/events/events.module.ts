import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { HostPayoutService } from './host-payout.service';
import { EventsController } from './events.controller';
import { StripeModule } from '../stripe/stripe.module';
import { EmailModule } from '../email/email.module';
import { StorageModule } from '../storage/storage.module';
import { UnsplashService } from './unsplash.service';

@Module({
  // Cancelling an event refunds its tickets, which lives in ConnectService.
  // An event's picture lands in a public bucket (EVT-22), so this needs the
  // same storage service the org logo uses.
  imports: [StripeModule, EmailModule, StorageModule],
  controllers: [EventsController],
  providers: [EventsService, HostPayoutService, UnsplashService],
  exports: [EventsService],
})
export class EventsModule {}
