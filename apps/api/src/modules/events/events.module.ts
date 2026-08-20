import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { HostPayoutService } from './host-payout.service';
import { EventsController } from './events.controller';
import { StripeModule } from '../stripe/stripe.module';
import { EmailModule } from '../email/email.module';

@Module({
  // Cancelling an event refunds its tickets, which lives in ConnectService.
  imports: [StripeModule, EmailModule],
  controllers: [EventsController],
  providers: [EventsService, HostPayoutService],
  exports: [EventsService],
})
export class EventsModule {}
