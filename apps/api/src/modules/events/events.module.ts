import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { StripeModule } from '../stripe/stripe.module';

@Module({
  // Cancelling an event refunds its tickets, which lives in ConnectService.
  imports: [StripeModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
